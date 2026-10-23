package appstate

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

// windowsFileIDInfo is FILE_ID_INFO. The full identifier is required on ReFS;
// the older BY_HANDLE_FILE_INFORMATION identifier is only 64 bits.
type windowsFileIDInfo struct {
	VolumeSerialNumber uint64
	FileID             [16]byte
}

func filesystemIdentity(file *os.File) (FilesystemIdentity, error) {
	handle := windows.Handle(file.Fd())
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION)
	runtime.KeepAlive(file)
	if err != nil {
		return FilesystemIdentity{}, fmt.Errorf("appstate: read filesystem owner: %w", err)
	}
	if descriptor == nil {
		return FilesystemIdentity{}, fmt.Errorf("appstate: filesystem owner is unavailable: %w", os.ErrPermission)
	}
	owner, _, err := descriptor.Owner()
	if err != nil {
		return FilesystemIdentity{}, fmt.Errorf("appstate: read filesystem owner SID: %w", err)
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return FilesystemIdentity{}, fmt.Errorf("appstate: read current user SID: %w", err)
	}
	if owner == nil || user.User.Sid == nil || !owner.Equals(user.User.Sid) {
		return FilesystemIdentity{}, fmt.Errorf("appstate: filesystem entry is not owned by the current user: %w", os.ErrPermission)
	}

	var info windowsFileIDInfo
	err = windows.GetFileInformationByHandleEx(handle, windows.FileIdInfo, (*byte)(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)))
	runtime.KeepAlive(file)
	if err != nil {
		// Do not fall back to the truncated legacy ID on unsupported kernels or
		// filesystems: it cannot satisfy the durable recovery identity contract.
		return FilesystemIdentity{}, fmt.Errorf("appstate: read durable filesystem identity: %w", err)
	}
	return FilesystemIdentity{Volume: info.VolumeSerialNumber, File: info.FileID}, nil
}

// windowsDirectoryRenameInfo is FILE_RENAME_INFORMATION, not its Ex variant.
// ReplaceIfExists remains false, including when the destination is empty.
type windowsDirectoryRenameInfo struct {
	ReplaceIfExists byte
	RootDirectory   windows.Handle
	FileNameLength  uint32
	FileName        [1]uint16
}

func renameDirectoryNoReplace(root *os.Root, oldpath, newpath string) error {
	oldpath, newpath = filepath.Clean(oldpath), filepath.Clean(newpath)
	oldname, newname := filepath.Base(oldpath), filepath.Base(newpath)
	if oldname == "." || oldname == ".." || newname == "." || newname == ".." ||
		strings.ContainsAny(oldname, ":\x00") || strings.ContainsAny(newname, ":\x00") {
		return os.ErrInvalid
	}

	oldparent, err := openWindowsDirectoryParent(root, filepath.Dir(oldpath))
	if err != nil {
		return err
	}
	defer oldparent.Close()
	newparent, err := openWindowsDirectoryParent(root, filepath.Dir(newpath))
	if err != nil {
		return err
	}
	defer newparent.Close()

	objectName, err := windows.NewNTUnicodeString(oldname)
	if err != nil {
		return err
	}
	attributes := windows.OBJECT_ATTRIBUTES{
		RootDirectory: windows.Handle(oldparent.Fd()),
		ObjectName:    objectName,
		// A substituted source reparse point must not redirect this operation.
		Attributes: windows.OBJ_CASE_INSENSITIVE | windows.OBJ_DONT_REPARSE,
	}
	attributes.Length = uint32(unsafe.Sizeof(attributes))
	var source windows.Handle
	err = windows.NtCreateFile(&source, windows.DELETE|windows.SYNCHRONIZE, &attributes,
		&windows.IO_STATUS_BLOCK{}, nil, 0,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		windows.FILE_OPEN, windows.FILE_DIRECTORY_FILE|windows.FILE_SYNCHRONOUS_IO_NONALERT, 0, 0)
	runtime.KeepAlive(oldparent)
	if status, ok := err.(windows.NTStatus); ok {
		return status.Errno()
	}
	if err != nil {
		return err
	}
	defer windows.CloseHandle(source)

	// Encode directly into the variable-length native buffer, avoiding a
	// separate UTF-16 allocation and copy. UTF-8 byte length bounds UTF-16 units.
	const nameOffset = int(unsafe.Offsetof(windowsDirectoryRenameInfo{}.FileName)) / 2
	const minimumSize = int(unsafe.Sizeof(windowsDirectoryRenameInfo{})) / 2
	buffer := make([]uint16, nameOffset, nameOffset+len(newname)+minimumSize)
	for _, r := range newname {
		buffer = utf16.AppendRune(buffer, r)
	}
	nameLength := uint32((len(buffer) - nameOffset) * 2)
	if len(buffer) < minimumSize {
		buffer = buffer[:minimumSize]
	}
	info := (*windowsDirectoryRenameInfo)(unsafe.Pointer(&buffer[0]))
	info.RootDirectory = windows.Handle(newparent.Fd())
	info.FileNameLength = nameLength
	err = windows.NtSetInformationFile(source, &windows.IO_STATUS_BLOCK{}, (*byte)(unsafe.Pointer(&buffer[0])), uint32(len(buffer)*2), windows.FileRenameInformation)
	runtime.KeepAlive(newparent)
	if status, ok := err.(windows.NTStatus); ok {
		return status.Errno()
	}
	// Unsupported native rename operations fail here; never retry using an
	// overwrite-capable rename or a copy/delete sequence.
	return err
}

func openWindowsDirectoryParent(root *os.Root, name string) (*os.File, error) {
	parent, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := parent.Stat()
	if err != nil {
		parent.Close()
		return nil, err
	}
	if !info.IsDir() {
		parent.Close()
		return nil, windows.ERROR_DIRECTORY
	}
	return parent, nil
}
