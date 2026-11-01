package window

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	logging "github.com/omniviewdev/plugin-sdk/log"
)

// Minimum size of non-main windows.
const (
	secondaryWindowMinWidth  = 640
	secondaryWindowMinHeight = 400
)

// ServiceOptions configures NewService.
type ServiceOptions struct {
	// WindowTemplate carries the options every window shares with the main
	// window (title, background colour, platform options). Name, URL, size,
	// minimum size and initial position are set per window.
	WindowTemplate application.WebviewWindowOptions
	// SessionPath is the session file, normally <stateRoot>/windows.json.
	SessionPath string
	Log         logging.Logger
}

// NewService creates the window service around the existing main window:
// main hides instead of closing, the persisted session is loaded and its
// non-main windows are recreated. Register the result with
// app.RegisterService so it is bound and flushed on shutdown.
func NewService(
	app *application.App,
	mainWindow *application.WebviewWindow,
	options ServiceOptions,
) *Service {
	host := &wailsWindowHost{app: app, template: options.WindowTemplate}
	service := newService(serviceDependencies{
		host:        host,
		emitter:     wailsEmitter{app: app},
		log:         options.Log,
		mainWindow:  wailsWindow{window: mainWindow},
		sessionPath: options.SessionPath,
		saveDelay:   sessionSaveDelay,
		dropTimeout: dropResponseTimeout,
	})
	attachMainWindow(mainWindow, service)
	return service
}

// wailsWindowHost creates Wails webview windows.
type wailsWindowHost struct {
	app      *application.App
	template application.WebviewWindowOptions
}

func (h *wailsWindowHost) createWindow(spec windowSpec, sink windowEventSink) nativeWindow {
	options := h.template
	options.Name = spec.Name
	// The frontend asks Wails for its window name; a URL query would be lost
	// when the window reloads.
	options.URL = "/#/"
	options.Width = spec.Width
	options.Height = spec.Height
	options.MinWidth = secondaryWindowMinWidth
	options.MinHeight = secondaryWindowMinHeight
	options.UseApplicationMenu = true
	if spec.Kind == KindSettings {
		options.Title = "Settings"
		options.Frameless = true
		if runtime.GOOS == "darwin" {
			// Wails skips native titles for frameless macOS windows. Retain the
			// native frame for accessibility, but draw content behind its chrome.
			options.Frameless = false
			options.Mac.TitleBar = application.MacTitleBarHidden
			options.MinimiseButtonState = application.ButtonHidden
			options.MaximiseButtonState = application.ButtonHidden
			options.CloseButtonState = application.ButtonHidden
			options.FullscreenButtonState = application.ButtonHidden
		}
		options.MinWidth = min(960, spec.Width)
		options.MinHeight = min(600, spec.Height)
		options.EnableFileDrop = false
	}
	options.InitialPosition = application.WindowCentered
	options.X, options.Y = 0, 0
	if spec.Position != nil {
		options.InitialPosition = application.WindowXY
		options.X, options.Y = spec.Position.X, spec.Position.Y
	}
	window := h.app.Window.NewWithOptions(options)
	wireFocusAndVisibility(window, spec.Name, sink)
	wireBoundsTracking(window, spec.Name, sink)
	if spec.Kind == KindSettings {
		window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
			if sink.shutdownStarted() {
				return
			}
			event.Cancel()
			window.Hide()
			go sink.windowVisibilityChanged(spec.Name, false)
		})
	} else {
		window.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) {
			sink.windowClosed(spec.Name)
		})
	}
	return wailsWindow{window: window}
}

func (h *wailsWindowHost) workAreaNear(x, y int) (Bounds, bool) {
	screen := h.app.Screen.ScreenNearestDipPoint(application.Point{X: x, Y: y})
	if screen == nil || screen.WorkArea.Width <= 0 || screen.WorkArea.Height <= 0 {
		return Bounds{}, false
	}
	area := screen.WorkArea
	return Bounds{X: area.X, Y: area.Y, Width: area.Width, Height: area.Height}, true
}

// attachMainWindow keeps main alive (hide on close) and tracks its focus,
// visibility and bounds.
func attachMainWindow(mainWindow *application.WebviewWindow, sink windowEventSink) {
	// Hooks run on the UI thread; the sink takes the service lock, so it is
	// called from a goroutine.
	mainWindow.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if sink.shutdownStarted() {
			return
		}
		event.Cancel()
		mainWindow.Hide()
		go sink.windowVisibilityChanged(MainWindowName, false)
	})
	wireFocusAndVisibility(mainWindow, MainWindowName, sink)
	wireBoundsTracking(mainWindow, MainWindowName, sink)
}

func wireFocusAndVisibility(window *application.WebviewWindow, name string, sink windowEventSink) {
	window.OnWindowEvent(events.Common.WindowFocus, func(_ *application.WindowEvent) {
		sink.windowFocused(name)
	})
	for _, hiddenEvent := range []events.WindowEventType{events.Common.WindowHide, events.Common.WindowMinimise} {
		window.OnWindowEvent(hiddenEvent, func(_ *application.WindowEvent) {
			sink.windowVisibilityChanged(name, false)
		})
	}
	for _, shownEvent := range []events.WindowEventType{
		events.Common.WindowShow, events.Common.WindowUnMinimise, events.Common.WindowRestore,
	} {
		window.OnWindowEvent(shownEvent, func(_ *application.WindowEvent) {
			sink.windowVisibilityChanged(name, true)
		})
	}
}

func wireBoundsTracking(window *application.WebviewWindow, name string, sink windowEventSink) {
	reportBounds := func(_ *application.WindowEvent) {
		sink.windowBoundsChanged(name, wailsWindow{window: window}.Bounds())
	}
	window.OnWindowEvent(events.Common.WindowDidMove, reportBounds)
	window.OnWindowEvent(events.Common.WindowDidResize, reportBounds)
}

// wailsWindow adapts a Wails webview window to nativeWindow.
type wailsWindow struct {
	window *application.WebviewWindow
}

func (w wailsWindow) Activate() {
	if w.window.IsMinimised() {
		w.window.UnMinimise()
	}
	w.window.Show()
	w.window.Focus()
}

func (w wailsWindow) Close() {
	w.window.Close()
}

func (w wailsWindow) Hide() {
	w.window.Hide()
}

func (w wailsWindow) IsVisible() bool {
	return w.window.IsVisible() && !w.window.IsMinimised()
}

func (w wailsWindow) SetPosition(x, y int) {
	w.window.SetPosition(x, y)
}

func (w wailsWindow) Bounds() Bounds {
	bounds := w.window.Bounds()
	return Bounds{X: bounds.X, Y: bounds.Y, Width: bounds.Width, Height: bounds.Height}
}

// wailsEmitter broadcasts through the Wails event bus.
type wailsEmitter struct {
	app *application.App
}

func (e wailsEmitter) emit(name string, data any) {
	e.app.Event.Emit(name, data)
}
