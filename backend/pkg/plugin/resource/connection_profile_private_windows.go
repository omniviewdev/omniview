//go:build windows

package resource

import (
	"errors"
	"os"
	"runtime"
	"unsafe"

	"github.com/omniviewdev/omniview/internal/appstate"
	"golang.org/x/sys/windows"
)

var reopenProfileFile = windows.NewLazySystemDLL("kernel32.dll").NewProc("ReOpenFile")

func openProfileCredentialFile(root *appstate.ScopedRoot, name string) (*os.File, error) {
	return root.OpenFile(name, os.O_RDONLY, 0)
}

func restrictProfileCredentialFile(file *os.File) error {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return err
	}
	descriptor, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;" + user.User.Sid.String() + ")")
	if err != nil {
		return err
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	// Reopen the already-contained file object, never its mutable path. The
	// original Go handle does not request WRITE_DAC, even for the file owner.
	handle, _, callErr := reopenProfileFile.Call(file.Fd(), uintptr(windows.WRITE_DAC), uintptr(windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE), 0)
	runtime.KeepAlive(file)
	if windows.Handle(handle) == windows.InvalidHandle {
		return callErr
	}
	defer windows.CloseHandle(windows.Handle(handle))
	return windows.SetSecurityInfo(windows.Handle(handle), windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
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
