//go:build windows

package devworkspace

import (
	"encoding/hex"
	"errors"
	"os"
	"runtime"
	"strconv"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Match appstate's FILE_ID_INFO layout. The legacy 64-bit file index is not
// sufficient on ReFS and must never substitute for the complete identifier.
type feedbackWindowsFileIDInfo struct {
	Volume uint64
	File   [16]byte
}

func createFeedbackFile(path string) (*os.File, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, err
	}
	security, err := windows.SecurityDescriptorFromString("O:" + user.User.Sid.String() + "D:P(A;;FA;;;" + user.User.Sid.String() + ")")
	if err != nil {
		return nil, err
	}
	attributes := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: security}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE|windows.READ_CONTROL, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, &attributes, windows.CREATE_NEW, windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	runtime.KeepAlive(security)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(handle), path), nil
}

func openFeedbackAuthorityFile(path string) (*os.File, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ|windows.READ_CONTROL, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(handle), path), nil
}

func feedbackFileIdentity(file *os.File) (viteFeedbackFileIdentity, error) {
	defer runtime.KeepAlive(file)
	handle := windows.Handle(file.Fd())
	var basic windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &basic); err != nil {
		return viteFeedbackFileIdentity{}, err
	}
	if basic.FileAttributes&(windows.FILE_ATTRIBUTE_REPARSE_POINT|windows.FILE_ATTRIBUTE_DIRECTORY) != 0 {
		return viteFeedbackFileIdentity{}, feedbackConflict("feedback handle is redirected or not a regular file")
	}
	security, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return viteFeedbackFileIdentity{}, err
	}
	if security == nil {
		return viteFeedbackFileIdentity{}, feedbackConflict("feedback Windows security descriptor is unavailable")
	}
	owner, _, err := security.Owner()
	if err != nil {
		return viteFeedbackFileIdentity{}, err
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return viteFeedbackFileIdentity{}, err
	}
	if owner == nil || user.User.Sid == nil || !owner.Equals(user.User.Sid) {
		return viteFeedbackFileIdentity{}, feedbackConflict("feedback handle has a foreign Windows owner")
	}
	control, _, err := security.Control()
	if err != nil {
		return viteFeedbackFileIdentity{}, err
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		return viteFeedbackFileIdentity{}, feedbackConflict("feedback Windows DACL is not protected")
	}
	dacl, _, err := security.DACL()
	if err != nil {
		return viteFeedbackFileIdentity{}, err
	}
	if dacl == nil {
		return viteFeedbackFileIdentity{}, feedbackConflict("feedback Windows DACL is unrestricted")
	}
	var ace *windows.ACCESS_ALLOWED_ACE
	if err := windows.GetAce(dacl, 0, &ace); err != nil {
		return viteFeedbackFileIdentity{}, err
	}
	if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || !(*windows.SID)(unsafe.Pointer(&ace.SidStart)).Equals(user.User.Sid) {
		return viteFeedbackFileIdentity{}, feedbackConflict("feedback Windows DACL permits a foreign principal")
	}
	if err := windows.GetAce(dacl, 1, &ace); !errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
		return viteFeedbackFileIdentity{}, feedbackConflict("feedback Windows DACL has additional or unreadable entries")
	}
	var identity feedbackWindowsFileIDInfo
	if err := windows.GetFileInformationByHandleEx(handle, windows.FileIdInfo, (*byte)(unsafe.Pointer(&identity)), uint32(unsafe.Sizeof(identity))); err != nil {
		return viteFeedbackFileIdentity{}, err
	}
	return viteFeedbackFileIdentity{Volume: strconv.FormatUint(identity.Volume, 10), FileID: hex.EncodeToString(identity.File[:])}, nil
}

// Windows has no supported directory FlushFileBuffers operation. As with
// devsession's private metadata, the retained file itself is flushed durably;
// loss of its directory entry causes readers to hold, never to release.
func syncFeedbackParent(string) error { return nil }
