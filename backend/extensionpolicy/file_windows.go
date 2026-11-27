package extensionpolicy

import (
	"os"
	"path/filepath"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

const privateReadFlags = os.O_RDONLY

func inspectPermissions(f *os.File, _ os.FileInfo, kind role) (int64, error) {
	h := windows.Handle(f.Fd())
	defer runtime.KeepAlive(f)
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(h, &info); err != nil {
		return 0, err
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || kind == policyFile && info.NumberOfLinks != 1 {
		return 0, errUnsafe
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return 0, err
	}
	sd, err := windows.GetSecurityInfo(h, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return 0, err
	}
	owner, _, err := sd.Owner()
	if err != nil || owner == nil || !owner.Equals(user.User.Sid) {
		return 0, errUnsafe
	}
	dacl, _, err := sd.DACL()
	if err != nil || dacl == nil || dacl.AceCount == 0 {
		return 0, errUnsafe
	}
	for i := range uint32(dacl.AceCount) {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, i, &ace); err != nil {
			return 0, err
		}
		if ace.Header.AceType == windows.ACCESS_DENIED_ACE_TYPE {
			continue
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
			return 0, errUnsafe
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		if sid.Equals(user.User.Sid) {
			continue
		}
		if kind == profileDirectory {
			// Profile parents may grant ordinary reads. System and administrators
			// already control the host; no other principal may change the namespace.
			const fileDeleteChild = 0x40
			const write = windows.GENERIC_WRITE | windows.GENERIC_ALL | windows.DELETE | windows.WRITE_DAC | windows.WRITE_OWNER | windows.FILE_WRITE_DATA | windows.FILE_APPEND_DATA | windows.FILE_WRITE_EA | windows.FILE_WRITE_ATTRIBUTES | fileDeleteChild
			if sid.IsWellKnown(windows.WinLocalSystemSid) || sid.IsWellKnown(windows.WinBuiltinAdministratorsSid) || ace.Header.AceFlags&windows.INHERIT_ONLY_ACE != 0 || ace.Mask&write == 0 {
				continue
			}
		}
		return 0, errUnsafe
	}
	// FILE_BASIC_INFO includes a change time even when the writer restores mtime.
	var basic struct {
		creation, access, write, change int64
		attributes, padding             uint32
	}
	if err := windows.GetFileInformationByHandleEx(h, windows.FileBasicInfo, (*byte)(unsafe.Pointer(&basic)), uint32(unsafe.Sizeof(basic))); err != nil {
		return 0, err
	}
	return basic.change, nil
}

// fsnotify's Windows filter does not watch FILE_NOTIFY_CHANGE_SECURITY. The
// native watcher explicitly includes ACL changes. Its events carry no grants.
type policyWatcher struct {
	stop    windows.Handle
	handles []windows.Handle
}

func newPolicyWatcher(root, dir, _ string) (*policyWatcher, error) {
	volume, err := windows.UTF16PtrFromString(filepath.VolumeName(dir) + `\`)
	if err != nil {
		return nil, err
	}
	if t := windows.GetDriveType(volume); t != windows.DRIVE_FIXED && t != windows.DRIVE_REMOVABLE {
		return nil, errUnsafe
	}
	stop, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		return nil, err
	}
	w := &policyWatcher{stop: stop, handles: []windows.Handle{stop}}
	const boundary = windows.FILE_NOTIFY_CHANGE_SECURITY | windows.FILE_NOTIFY_CHANGE_DIR_NAME | windows.FILE_NOTIFY_CHANGE_ATTRIBUTES
	for _, watch := range [...]struct {
		path string
		mask uint32
	}{
		{filepath.Dir(root), boundary}, {root, boundary},
		{dir, boundary | windows.FILE_NOTIFY_CHANGE_FILE_NAME | windows.FILE_NOTIFY_CHANGE_LAST_WRITE | windows.FILE_NOTIFY_CHANGE_SIZE},
	} {
		h, err := windows.FindFirstChangeNotification(watch.path, false, watch.mask)
		if err != nil {
			w.close()
			return nil, err
		}
		w.handles = append(w.handles, h)
	}
	return w, nil
}

func (w *policyWatcher) next() error {
	event, err := windows.WaitForMultipleObjects(w.handles, false, windows.INFINITE)
	if err != nil {
		return err
	}
	i := event - windows.WAIT_OBJECT_0
	if i == 0 || i >= uint32(len(w.handles)) {
		return errUnsafe
	}
	// Rearm before rereading; later writes and ACL changes cannot fall between.
	return windows.FindNextChangeNotification(w.handles[i])
}

func (w *policyWatcher) interrupt() { windows.SetEvent(w.stop) }
func (w *policyWatcher) close() {
	for _, h := range w.handles[1:] {
		windows.FindCloseChangeNotification(h)
	}
	windows.CloseHandle(w.stop)
}

var replaceFile = windows.NewLazySystemDLL("kernel32.dll").NewProc("ReplaceFileW")

func exchangePolicy(root *os.Root, dir, staged string) (string, error) {
	backup := staged + ".previous"
	var names [3]*uint16
	for i, name := range [...]string{filename, staged, backup} {
		p, err := windows.UTF16PtrFromString(filepath.Join(dir, name))
		if err != nil {
			return "", err
		}
		names[i] = p
	}
	ok, _, callErr := replaceFile.Call(uintptr(unsafe.Pointer(names[0])), uintptr(unsafe.Pointer(names[1])), uintptr(unsafe.Pointer(names[2])), 0, 0, 0)
	if ok == 0 {
		return "", callErr
	}
	// ReplaceFileW preserves the displaced file as backup. Its WRITE_THROUGH
	// flag is unsupported; the private stage was flushed before replacement.
	f, err := root.OpenFile(filename, os.O_RDWR, 0)
	if err != nil {
		return "", err
	}
	defer f.Close()
	return backup, f.Sync()
}
