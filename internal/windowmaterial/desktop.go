//go:build ui_next && !server && cgo && !purego && ((darwin && !ios) || (linux && !android && !gtk3))

package windowmaterial

/*
#cgo darwin CFLAGS: -x objective-c -fobjc-arc -fblocks
#cgo darwin LDFLAGS: -framework AppKit -framework WebKit
#cgo linux pkg-config: gtk4 webkitgtk-6.0
#include "desktop.h"
*/
import "C"

import (
	"runtime"
	"runtime/cgo"
	"sync"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/omniviewdev/omniview/backend/pkg/settings"
)

type windowState struct {
	id         uint
	generation uint64
	material   settings.AppearanceMaterial
}

type controller struct {
	app     *application.App
	changed func()

	mu         sync.RWMutex // never held while dispatching, calling native code or notifying settings
	windows    map[string]windowState
	preference preference
	generation uint64
	started    bool
	closed     bool

	// Owned exclusively by the UI thread, from the first live window to shutdown.
	observer unsafe.Pointer
	handle   cgo.Handle
}

// Configure registers readiness hooks before Wails creates or restores any
// windows. SetupAppearance supplies the hydrated request without awaiting a UI
// thread: Wails has not entered its event loop yet.
func Configure(app *application.App, service *settings.Service, options *application.WebviewWindowOptions) {
	options.Mac.Backdrop = application.MacBackdropNormal // don't stack Wails' startup effect under ours
	loadStarted := events.Mac.WebViewDidStartProvisionalNavigation
	if runtime.GOOS == "linux" {
		// WebKitGTK latches its base clear colour before first paint. Start its
		// existing view clear; GtkWindow stays solid until the compositor is checked.
		options.BackgroundType = application.BackgroundTypeTransparent
		options.BackgroundColour = application.NewRGBA(0, 0, 0, 0)
		loadStarted = events.Linux.WindowLoadStarted
	}
	c := &controller{app: app, changed: service.AppearanceChanged, windows: make(map[string]windowState), generation: 1}
	setup(app, service, c.setPreference, c.presentation)
	app.Window.OnCreate(func(w application.Window) {
		name, id := w.Name(), w.ID()
		c.mu.Lock()
		if c.closed {
			c.mu.Unlock()
			return
		}
		c.windows[name] = windowState{id: id}
		c.mu.Unlock()
		ready := func(*application.WindowEvent) {
			if c.refresh(w) {
				c.changed()
			}
		}
		w.OnWindowEvent(loadStarted, ready)
		w.OnWindowEvent(events.Common.WindowRuntimeReady, ready)
		w.OnWindowEvent(events.Common.WindowShow, ready)
		// Cancelled closes (main/settings hide-on-close) never reach listeners.
		w.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
			c.mu.Lock()
			if current, ok := c.windows[name]; ok && current.id == id {
				delete(c.windows, name)
			}
			c.mu.Unlock()
		})
	})
	app.OnShutdown(c.close)
}

func (c *controller) presentation(name string) settings.AppearanceMaterial {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if name == "" { // a browser has no native window, even when connected to a desktop host
		return c.preference.inPage()
	}
	if state, ok := c.windows[name]; ok && state.generation != 0 {
		return state.material
	}
	return settings.AppearanceMaterial{Effective: "opaque", Reason: "not-ready"}
}

func (c *controller) setPreference(request settings.AppearanceRequest) {
	next := nativePreference(request)
	c.mu.Lock()
	if c.closed || next == c.preference {
		c.mu.Unlock()
		return
	}
	c.preference = next
	c.generation++
	started := c.started
	c.mu.Unlock()
	if started {
		c.refresh(nil) // the committed settings event publishes this result
	}
}

func (c *controller) refresh(window application.Window) bool {
	if c.app.Context().Err() != nil {
		return false
	}
	return application.InvokeSyncWithResult(func() bool {
		if window != nil {
			return c.apply(window)
		}
		changed := false
		// GetAll copies the registry and releases its lock before any native call.
		for _, w := range c.app.Window.GetAll() {
			if c.apply(w) {
				changed = true
			}
		}
		return changed
	})
}

// apply runs on the UI thread. Native handles are borrowed only for this call;
// a close queued before it yields a nil handle, not a stale pointer.
func (c *controller) apply(w application.Window) bool {
	name, id := w.Name(), w.ID()
	c.mu.RLock()
	state, exists := c.windows[name]
	current := exists && state.id == id && state.generation != c.generation
	c.mu.RUnlock()
	if !current {
		return false
	}
	pointer := w.NativeWindow()
	if pointer == nil {
		return false
	}
	c.mu.Lock()
	c.started = true
	pref, generation := c.preference, c.generation
	c.mu.Unlock()
	if c.handle == 0 {
		c.handle = cgo.NewHandle(c)
		c.observer = C.ovObserveMaterial(pointer, C.uintptr_t(c.handle))
	}
	mode := C.OVMaterial(C.OVOpaque)
	switch pref.mode {
	case "translucent":
		mode = C.OVTranslucent
	case "glass":
		mode = C.OVGlass
	}
	result := C.ovApplyMaterial(pointer, mode, C.bool(pref.clear), C.bool(pref.highContrast))
	material := settings.AppearanceMaterial{
		Effective:    [...]string{"opaque", "translucent", "glass", "in-page"}[result.effective],
		Reason:       [...]string{"", "accessibility", "unsupported", "no-compositor", "webview"}[result.reason],
		Glass:        bool(result.glassAvailable),
		Translucent:  true, // the portable Translucent choice always has an in-page presentation
		ForcedOpaque: result.reason == C.OVAccessibility,
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	state, exists = c.windows[name]
	if !exists || state.id != id {
		return false
	}
	c.windows[name] = windowState{id: id, generation: generation, material: material}
	return state.generation == 0 || material != state.material
}

//export ovMaterialEnvironmentChanged
func ovMaterialEnvironmentChanged(handle C.uintptr_t) {
	c := cgo.Handle(handle).Value().(*controller)
	c.mu.Lock()
	c.generation++
	c.mu.Unlock()
	// Leave the platform notification and the UI thread before notifying settings.
	go func() {
		if c.refresh(nil) {
			c.changed()
		}
	}()
}

func (c *controller) close() {
	// Wails shutdown tasks execute on the native UI thread.
	c.mu.Lock()
	c.closed = true
	c.windows = nil
	c.mu.Unlock()
	if c.handle != 0 {
		C.ovStopObservingMaterial(c.observer)
		c.handle.Delete()
	}
}
