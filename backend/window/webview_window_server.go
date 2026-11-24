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

// registryWindow is a window of the window service in the server build. It is in Wails' registry, because a page binds
// to a window by its name (the e2e fixtures send the name of the settings window with every call), and it never runs:
// there is no native page to show, and a window that runs is a window Wails queues every event for (B-110). Wails'
// own Close returns at once for a window that has not run, and emitting its closing event is fatal for one (its
// listener calls impl.close on a nil impl), so Close here does what the closing hooks of createWindow do for a window
// that exists and takes the window out of the registry as the destruction of a platform window does.
type registryWindow struct {
	app    *application.App
	window *application.WebviewWindow
	kind   Kind
	name   string
	sink   windowEventSink
}

func newRegistryWindow(app *application.App, window *application.WebviewWindow, spec windowSpec, sink windowEventSink) nativeWindow {
	return registryWindow{app: app, window: window, kind: spec.Kind, name: spec.Name, sink: sink}
}

func (registryWindow) Activate()            {}
func (registryWindow) Hide()                {}
func (registryWindow) IsVisible() bool      { return false }
func (registryWindow) SetPosition(int, int) {}
func (registryWindow) Bounds() Bounds       { return Bounds{X: 0, Y: 0, Width: 0, Height: 0} }

// Close hides the settings window instead of closing it, unless the host is shutting down; any other window is
// closed and the window service is told. The service calls Close without holding its lock, and its fake reports
// synchronously too, so the notice is sent here.
func (w registryWindow) Close() {
	if w.kind == KindSettings && !w.sink.shutdownStarted() {
		w.sink.windowVisibilityChanged(w.name, false)
		return
	}
	w.app.Window.Remove(w.window.ID())
	if w.kind != KindSettings {
		w.sink.windowClosed(w.name)
	}
}
