//go:build windows

package resource

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"strings"
	"unsafe"

	"github.com/omniviewdev/omniview/internal/appstate"
	"golang.org/x/sys/windows"
)

func openProfileCredentialFile(root *appstate.ScopedRoot, name string) (*os.File, error) {
	return root.OpenFile(name, os.O_RDONLY, 0)
}

func createProfileCredentialFile(root *appstate.ScopedRoot, name string) (*os.File, error) {
	// This API accepts a single fresh basename only. Every native lookup is
	// relative to the already-contained directory handle, never an absolute path.
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\:\x00") {
		return nil, os.ErrInvalid
	}
	directory, err := root.OpenFile(".", os.O_RDONLY, 0)
	if err != nil {
		return nil, fmt.Errorf("open credential parent: %w", err)
	}
	defer directory.Close()
	if err := validateProfileCredentialACL(directory, true); err != nil {
		return nil, fmt.Errorf("validate credential parent: %w", err)
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, fmt.Errorf("read credential user: %w", err)
	}
	descriptor, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;" + user.User.Sid.String() + ")")
	if err != nil {
		return nil, fmt.Errorf("build credential security descriptor: %w", err)
	}
	objectName, err := windows.NewNTUnicodeString(name)
	if err != nil {
		return nil, fmt.Errorf("encode credential name: %w", err)
	}
	attributes := windows.OBJECT_ATTRIBUTES{
		RootDirectory:      windows.Handle(directory.Fd()),
		ObjectName:         objectName,
		Attributes:         windows.OBJ_CASE_INSENSITIVE | windows.OBJ_DONT_REPARSE,
		SecurityDescriptor: descriptor,
	}
	attributes.Length = uint32(unsafe.Sizeof(attributes))
	var handle windows.Handle
	err = windows.NtCreateFile(&handle, windows.GENERIC_READ|windows.GENERIC_WRITE|windows.SYNCHRONIZE,
		&attributes, &windows.IO_STATUS_BLOCK{}, nil, windows.FILE_ATTRIBUTE_NORMAL,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		windows.FILE_CREATE, windows.FILE_NON_DIRECTORY_FILE|windows.FILE_SYNCHRONOUS_IO_NONALERT, 0, 0)
	runtime.KeepAlive(directory)
	runtime.KeepAlive(descriptor)
	runtime.KeepAlive(objectName)
	if status, ok := err.(windows.NTStatus); ok {
		err = status.Errno()
	}
	if err != nil {
		return nil, fmt.Errorf("create protected credential handle: %w", err)
	}
	return os.NewFile(uintptr(handle), name), nil
}

func validateProfileCredentialDirectory(root *appstate.ScopedRoot) error {
	directory, err := root.OpenFile(".", os.O_RDONLY, 0)
	if err != nil {
		return err
	}
	defer directory.Close()
	info, err := directory.Stat()
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("connection profiles: private credential parent is not a directory")
	}
	return validateProfileCredentialACL(directory, true)
}

func validateProfileCredentialFile(file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("connection profiles: private credentials are not a regular file")
	}
	return validateProfileCredentialACL(file, false)
}

func validateProfileCredentialACL(file *os.File, directory bool) error {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return err
	}
	descriptor, err := windows.GetSecurityInfo(windows.Handle(file.Fd()), windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	runtime.KeepAlive(file)
	if err != nil {
		return err
	}
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil || (!owner.Equals(user.User.Sid) && owner.String() != "S-1-5-18" && owner.String() != "S-1-5-32-544") {
		return errors.New("connection profiles: private credential owner is not trusted")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil || dacl.AceCount == 0 {
		return errors.New("connection profiles: private credential DACL is unavailable")
	}
	for i := uint32(0); i < uint32(dacl.AceCount); i++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, i, &ace); err != nil {
			return err
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || (!directory && ace.Header.AceFlags != 0) || (directory && ace.Header.AceFlags & ^uint8(0x1f) != 0) {
			return errors.New("connection profiles: private credential DACL has unsupported entries")
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		if !sid.Equals(user.User.Sid) && sid.String() != "S-1-5-18" && sid.String() != "S-1-5-32-544" {
			return errors.New("connection profiles: private credential DACL permits another principal")
		}
	}
	return nil
}

func validatePublicConnectionProfileFile(file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("connection profiles: public profile is not a regular file")
	}
	return validateProfileCredentialACL(file, true)
}
