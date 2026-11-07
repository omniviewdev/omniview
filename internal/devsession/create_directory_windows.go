package devsession

import (
	"os"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

func createPrivateDirectoryAt(parent *os.File, name string) (*os.File, error) {
	_, sd, err := privateSecurityDescriptor(true)
	if err != nil {
		return nil, err
	}
	objectName, err := windows.NewNTUnicodeString(name)
	if err != nil {
		return nil, err
	}
	attributes := windows.OBJECT_ATTRIBUTES{
		RootDirectory: windows.Handle(parent.Fd()), ObjectName: objectName,
		Attributes: windows.OBJ_CASE_INSENSITIVE | windows.OBJ_DONT_REPARSE, SecurityDescriptor: sd,
	}
	attributes.Length = uint32(unsafe.Sizeof(attributes))
	var child windows.Handle
	err = windows.NtCreateFile(&child, windows.FILE_READ_ATTRIBUTES|windows.SYNCHRONIZE, &attributes, &windows.IO_STATUS_BLOCK{}, nil, 0,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, windows.FILE_CREATE,
		windows.FILE_DIRECTORY_FILE|windows.FILE_OPEN_REPARSE_POINT|windows.FILE_SYNCHRONOUS_IO_NONALERT, 0, 0)
	runtime.KeepAlive(parent)
	runtime.KeepAlive(sd)
	if status, ok := err.(windows.NTStatus); ok {
		err = status.Errno()
	}
	if err != nil {
		return nil, &os.PathError{Op: "mkdir", Path: name, Err: err}
	}
	return os.NewFile(uintptr(child), name), nil
}
