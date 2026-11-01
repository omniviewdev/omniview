//go:build darwin && !server && cgo

package uiinspection

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Foundation -framework AppKit -framework WebKit
#include "native_darwin.h"
*/
import "C"

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

func (s *Service) installPolicy() {
	s.app.Window.OnCreate(func(window application.Window) {
		// OnCreate precedes native creation. Hooks run synchronously before
		// Wails' ordinary navigation-finished listeners show the window.
		// Development Wails builds may already enable inspection before this
		// first navigation finishes; this is not an initial-load policy hook.
		window.RegisterHook(events.Mac.WebViewDidFinishNavigation, func(_ *application.WindowEvent) {
			application.InvokeSync(func() {
				status := C.omniviewInspectWindow(window.NativeWindow(), C.bool(true), C.bool(s.enabled))
				C.omniviewFreeInspectionStatus(status)
			})
		})
	})
}

func (s *Service) getStatus(windowName string) Status {
	status := Status{Window: windowName, Engine: "WebKit", Error: "Native inspection status is unavailable"}
	application.InvokeSync(func() {
		// Resolve the window and its native handle on the main thread so a
		// concurrent native close cannot leave a stale pointer in the bridge.
		window, exists := s.app.Window.GetByName(windowName)
		var native C.OmniviewInspectionStatus
		if exists {
			native = C.omniviewInspectWindow(window.NativeWindow(), C.bool(false), C.bool(s.enabled))
		} else {
			native = C.omniviewInspectWindow(nil, C.bool(false), C.bool(s.enabled))
		}
		defer C.omniviewFreeInspectionStatus(native)
		status.Supported = bool(native.supported)
		status.Enabled = bool(native.enabled)
		status.Application = C.GoString(native.application)
		status.Target = C.GoString(native.target)
		status.Error = C.GoString(native.error)
	})
	return status
}
