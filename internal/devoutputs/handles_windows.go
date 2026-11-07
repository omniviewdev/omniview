package devoutputs

import (
	"os"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

func openRelativeWindows(parent *os.File, name string, access, options uint32) (*os.File, error) {
	return openRelativeWindowsObject(parent, name, access, options, windows.OBJ_CASE_INSENSITIVE|windows.OBJ_DONT_REPARSE)
}

// Metadata observation opens a final reparse point itself, never its target.
// Read and rename callers retain OBJ_DONT_REPARSE and reject reparse points.
func openRelativeWindowsMetadata(parent *os.File, name string) (*os.File, error) {
	return openRelativeWindowsObject(parent, name, windows.FILE_READ_ATTRIBUTES, 0, windows.OBJ_CASE_INSENSITIVE)
}

func openRelativeWindowsObject(parent *os.File, name string, access, options, objectFlags uint32) (*os.File, error) {
	objectName, err := windows.NewNTUnicodeString(name)
	if err != nil {
		return nil, err
	}
	attributes := windows.OBJECT_ATTRIBUTES{RootDirectory: windows.Handle(parent.Fd()), ObjectName: objectName, Attributes: objectFlags}
	attributes.Length = uint32(unsafe.Sizeof(attributes))
	var handle windows.Handle
	err = windows.NtCreateFile(&handle, access|windows.SYNCHRONIZE, &attributes, &windows.IO_STATUS_BLOCK{}, nil, 0,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, windows.FILE_OPEN,
		options|windows.FILE_OPEN_REPARSE_POINT|windows.FILE_SYNCHRONOUS_IO_NONALERT, 0, 0)
	runtime.KeepAlive(parent)
	if status, ok := err.(windows.NTStatus); ok {
		err = status.Errno()
	}
	if err != nil {
		return nil, &os.PathError{Op: "open", Path: name, Err: err}
	}
	return os.NewFile(uintptr(handle), name), nil
}
