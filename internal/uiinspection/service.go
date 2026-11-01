// Package uiinspection controls the native WebKit inspection policy at startup.
package uiinspection

import "github.com/wailsapp/wails/v3/pkg/application"

// Status describes the native window, not a debugger connection.
type Status struct {
	Supported   bool   `json:"supported"`
	Enabled     bool   `json:"enabled"`
	Engine      string `json:"engine"`
	Window      string `json:"window"`
	Application string `json:"application"`
	Target      string `json:"target"`
	Error       string `json:"error"`
}

// Service keeps the startup policy immutable until the next application launch.
type Service struct {
	app     *application.App
	enabled bool
}

// New must run before creating any windows, including restored windows.
func New(app *application.App, enabled bool) *Service {
	s := &Service{app: app, enabled: enabled}
	s.installPolicy()
	return s
}

// GetStatus reads the current native property without changing inspection policy.
func (s *Service) GetStatus(windowName string) Status {
	return s.getStatus(windowName)
}
