package resource

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// EventEmitter abstracts event emission for testability.
// Production uses wailsEmitter; tests use recordingEmitter.
type EventEmitter interface {
	Emit(eventKey string, data interface{})
}

// wailsEmitter emits events via the Wails runtime.
type wailsEmitter struct {
	ctx context.Context
}

func newWailsEmitter(ctx context.Context) *wailsEmitter {
	return &wailsEmitter{ctx: ctx}
}

func (e *wailsEmitter) Emit(eventKey string, data interface{}) {
	runtime.EventsEmit(e.ctx, eventKey, data)
}
