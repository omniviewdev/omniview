//go:build server

package window

import "github.com/wailsapp/wails/v3/pkg/application"

// runsNativeWindows says whether this build shows native webview windows. The
// server build serves its pages to browsers and has no native page.
const runsNativeWindows = false

// NewWebviewWindow registers a window with the application and does not run
// it. Wails queues the JavaScript of every event for each window that runs,
// and the native page the window loads drains the queue; the server build has
// no such page, so a window that ran kept every event it was given (B-110:
// 67 MiB to 9.5 GiB in 30 s under a client that read at full speed). A window
// that has not run takes no event, and the registry still answers for it: a
// call that names no window gets the first one, and the window service keeps
// the entry it lists.
func NewWebviewWindow(app *application.App, options application.WebviewWindowOptions) *application.WebviewWindow {
	window := application.NewWindow(options)
	app.Window.Add(window)
	return window
}
