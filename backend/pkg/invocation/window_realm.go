package invocation

import (
	"context"
	"reflect"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// WindowIdentity names one window by concrete kind and numeric ID. Wails numbers
// native windows and server-mode browser windows from separate counters that both
// start at 1, so the ID alone is not unique.
type WindowIdentity struct {
	kind reflect.Type
	id   uint
}

// IdentityOf reads only ID() and the dynamic type; it never calls other window methods.
func IdentityOf(window application.Window) WindowIdentity {
	return WindowIdentity{kind: reflect.TypeOf(window), id: window.ID()}
}

// ContextScope supplies host-issued provenance at a binding boundary.
// A fixed Scope also implements this contract for native and agent callers.
type ContextScope interface {
	Context(context.Context) context.Context
}

// WindowRealm shares one principal across services in the same authenticated
// window. Different windows never share source observations or operation handles.
type WindowRealm struct {
	mu       sync.Mutex
	scopes   map[WindowIdentity]*Scope
	closed   map[WindowIdentity]time.Time
	onRetire func(string)
}

func NewWindowRealm(onRetire func(string)) *WindowRealm {
	return &WindowRealm{scopes: make(map[WindowIdentity]*Scope), closed: make(map[WindowIdentity]time.Time), onRetire: onRetire}
}

// ScopeForWindow accepts only the native window object, never a caller-supplied ID.
func (r *WindowRealm) ScopeForWindow(window application.Window) *Scope {
	if window == nil {
		return nil
	}
	key := IdentityOf(window)
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	for id, until := range r.closed {
		if !now.Before(until) {
			delete(r.closed, id)
		}
	}
	if _, closed := r.closed[key]; closed {
		return nil
	}
	if scope := r.scopes[key]; scope != nil {
		return scope
	}
	if len(r.scopes) >= 64 || len(r.closed) >= 1024 {
		return nil
	}
	scope := NewScope(TrustedUI)
	r.scopes[key] = scope
	window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		r.mu.Lock()
		retired := r.scopes[key] == scope
		if retired {
			delete(r.scopes, key)
			r.closed[key] = time.Now().Add(time.Minute)
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
