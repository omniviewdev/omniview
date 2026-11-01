//go:build darwin && !server && cgo

package processinfo

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework AppKit -framework CoreGraphics
#include "native_darwin.h"
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

func (s *Service) nativeWindows() []Window {
	windows := []Window{}
	if s.app == nil {
		return windows
	}
	application.InvokeSync(func() {
		for _, window := range s.app.Window.GetAll() {
			// Resolve metadata and handle together. No raw handle leaves this call.
			row := Window{Name: window.Name(), ID: window.ID(), Ownership: "unverified"}
			native := C.omniviewObserveProcessWindow(window.NativeWindow(), C.int(s.host.PID))
			row.Error = C.GoString(native.error)
			if native.windowID > 0 && row.Error == "" {
				row.NativeID = int64(native.windowID)
				row.Ownership = "verified"
			}
			windows = append(windows, row)
		}
	})
	return windows
}
