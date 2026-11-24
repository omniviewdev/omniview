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

// headlessWindow is a window of the server build, which has no platform window. A window the window service lists is
// only a name here: nothing is created in Wails for it, because a window Wails knows is a window it queues every event
// for (B-110), and there are no native pages to show.
type headlessWindow struct {
	name string
	kind Kind
	sink windowEventSink
}

func newHeadlessWindow(spec windowSpec, sink windowEventSink) nativeWindow {
	return headlessWindow{name: spec.Name, kind: spec.Kind, sink: sink}
}

func (headlessWindow) Activate()            {}
func (headlessWindow) Hide()                {}
func (headlessWindow) IsVisible() bool      { return false }
func (headlessWindow) SetPosition(int, int) {}
func (headlessWindow) Bounds() Bounds       { return Bounds{X: 0, Y: 0, Width: 0, Height: 0} }

// Close does what the closing hooks of createWindow do for a window that exists: the settings window hides instead
// of closing unless the host is shutting down, any other window closes and the window service is told. The service
// calls Close without holding its lock, and its fake reports synchronously too, so the notice is sent here.
func (w headlessWindow) Close() {
	switch {
	case w.kind == KindSettings && !w.sink.shutdownStarted():
		w.sink.windowVisibilityChanged(w.name, false)
	case w.kind != KindSettings:
		w.sink.windowClosed(w.name)
	}
}
