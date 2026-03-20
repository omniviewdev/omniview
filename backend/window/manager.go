// Package window provides window lifecycle management for the application.
package window

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Manager manages the application's windows, including the main window
// and any secondary windows such as settings or devtools.
type Manager struct {
	app *application.App
}

// NewManager creates a new window Manager. It registers a hide-on-close hook
// on the provided main window so that closing the main window hides it
// instead of quitting the application.
func NewManager(app *application.App, mainWindow *application.WebviewWindow) *Manager {
	m := &Manager{app: app}
	m.registerMainWindowHideOnClose(mainWindow)
	return m
}

// Main returns the main application window by looking it up by name.
func (m *Manager) Main() *application.WebviewWindow {
	w, ok := m.app.Window.GetByName("main")
	if !ok {
		return nil
	}
	ww, _ := w.(*application.WebviewWindow)
	return ww
}

// registerMainWindowHideOnClose hooks the WindowClosing event on the main
// window so that it hides instead of closing. This prevents the application
// from quitting when the user closes the main window.
func (m *Manager) registerMainWindowHideOnClose(w *application.WebviewWindow) {
	w.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		e.Cancel()
		w.Hide()
	})
}

// OpenSettings creates and shows a new settings window. The window uses
// normal close behavior — it is destroyed when closed.
func (m *Manager) OpenSettings() *application.WebviewWindow {
	w := m.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:               "settings",
		Title:              "Settings — Omniview",
		URL:                "/#/settings",
		Width:              900,
		Height:             700,
		UseApplicationMenu: true,
	})
	w.Show()
	w.Focus()
	return w
}

// OpenDevtools creates and shows a new devtools window. The window uses
// normal close behavior — it is destroyed when closed.
func (m *Manager) OpenDevtools() *application.WebviewWindow {
	w := m.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:               "devtools",
		Title:              "DevTools — Omniview",
		URL:                "/#/devtools",
		Width:              1200,
		Height:             800,
		UseApplicationMenu: true,
	})
	w.Show()
	w.Focus()
	return w
}
