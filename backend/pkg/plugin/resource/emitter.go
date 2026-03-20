package resource

import (
	"github.com/wailsapp/wails/v3/pkg/application"
)

// EventEmitter abstracts event emission for testability.
// Production uses appEmitter; tests use recordingEmitter.
type EventEmitter interface {
	Emit(eventKey string, data ...any)
}

// appEmitter emits events via the Wails v3 application instance.
type appEmitter struct {
	app *application.App
}

func newAppEmitter(app *application.App) *appEmitter {
	return &appEmitter{app: app}
}

func (e *appEmitter) Emit(eventKey string, data ...any) {
	e.app.Event.Emit(eventKey, data...)
}

// NoopEmitter silently discards all events. Used before the app is initialized.
type NoopEmitter struct{}

func (NoopEmitter) Emit(string, ...any) {}
