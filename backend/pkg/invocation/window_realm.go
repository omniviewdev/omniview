package invocation

import (
	"context"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// ContextScope supplies host-issued provenance at a binding boundary.
// A fixed Scope also implements this contract for native and agent callers.
type ContextScope interface {
	Context(context.Context) context.Context
}

// WindowRealm shares one principal across services in the same authenticated
// window. Different windows never share source observations or operation handles.
type WindowRealm struct {
	mu       sync.Mutex
	scopes   map[uint]*Scope
	closed   map[uint]time.Time
	onRetire func(string)
}

func NewWindowRealm(onRetire func(string)) *WindowRealm {
	return &WindowRealm{scopes: make(map[uint]*Scope), closed: make(map[uint]time.Time), onRetire: onRetire}
}

// ScopeForWindow accepts only the native window object, never a caller-supplied ID.
func (r *WindowRealm) ScopeForWindow(window application.Window) *Scope {
	if window == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	for id, until := range r.closed {
		if !now.Before(until) {
			delete(r.closed, id)
		}
	}
	if _, closed := r.closed[window.ID()]; closed {
		return nil
	}
	if scope := r.scopes[window.ID()]; scope != nil {
		return scope
	}
	if len(r.scopes) >= 64 || len(r.closed) >= 1024 {
		return nil
	}
	scope := NewScope(TrustedUI)
	r.scopes[window.ID()] = scope
	window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		r.mu.Lock()
		retired := r.scopes[window.ID()] == scope
		if retired {
			delete(r.scopes, window.ID())
			r.closed[window.ID()] = time.Now().Add(time.Minute)
		}
		r.mu.Unlock()
		if retired && r.onRetire != nil {
			r.onRetire(scope.Principal().Owner())
		}
	})
	return scope
}

func (r *WindowRealm) Context(ctx context.Context) context.Context {
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	if scope := r.ScopeForWindow(window); scope != nil {
		return scope.Context(ctx)
	}
	// A missing, closed, or over-limit window must not retain another realm's grant.
	return context.WithValue(ctx, principalKey{}, Principal{})
}
