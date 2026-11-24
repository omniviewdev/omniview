//go:build !server

package window

import "github.com/wailsapp/wails/v3/pkg/application"

// runsNativeWindows says whether this build shows native webview windows.
const runsNativeWindows = true

// NewWebviewWindow creates a window and has the application run it.
func NewWebviewWindow(app *application.App, options application.WebviewWindowOptions) *application.WebviewWindow {
	return app.Window.NewWithOptions(options)
}

// newHeadlessWindow is never called in this build: it shows native windows.
func newHeadlessWindow(windowSpec, windowEventSink) nativeWindow {
	return nil
}
