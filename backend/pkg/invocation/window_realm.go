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

// windowEntry is what the realm holds for one window.
type windowEntry struct {
	scope *Scope
	// client is the runtime's client id of the page a server-mode window serves, the key of Wails' registry of connected pages.
	// It is empty for a native window, which announces its own close.
	client string
	// absent counts the sweeps in a row that found no events socket registered for client.
	absent int
}

const (
	// A server-mode page that closes announces nothing: stock Wails' BrowserWindow.OnWindowEvent registers nothing and never fires. The realm
	// asks, every pageSweepEvery, whether the page's client id still has an events socket registered, and retires the page's scope once
	// pageSweepAbsences sweeps in a row found none: a socket that drops reconnects within a second or two, so one absence is a blip.
	pageSweepEvery    = 2 * time.Second
	pageSweepAbsences = 2
)

// WindowRealm shares one principal across services in the same authenticated
// window. Different windows never share source observations or operation handles.
// A native window's scope is retired by its close event; a server-mode page's, by the sweep of pageSweepEvery.
type WindowRealm struct {
	mu       sync.Mutex
	scopes   map[WindowIdentity]*windowEntry
	closed   map[WindowIdentity]time.Time
	onRetire func(string)
	// connected reports whether a client id has an events socket registered; every is the sweep's interval.
	connected func(client string) bool
	every     time.Duration
	// sweeper is the timer of the sweep: set while the realm holds a server-mode window, nil otherwise.
	sweeper *time.Timer
}

func NewWindowRealm(onRetire func(string)) *WindowRealm {
	return &WindowRealm{
		mu: sync.Mutex{}, scopes: make(map[WindowIdentity]*windowEntry), closed: make(map[WindowIdentity]time.Time), onRetire: onRetire,
		connected: pageConnected, every: pageSweepEvery, sweeper: nil,
	}
}

// pageConnected reports whether the page of a client id has an events socket registered with Wails' server (never, in a build that is not a server).
func pageConnected(client string) bool { return application.GetBrowserWindow(client) != nil }

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
	if entry := r.scopes[key]; entry != nil {
		return entry.scope
	}
	if len(r.scopes) >= 64 || len(r.closed) >= 1024 {
		return nil
	}
	entry := &windowEntry{scope: NewScope(TrustedUI), client: "", absent: 0}
	if page, ok := window.(interface{ ClientID() string }); ok {
		entry.client = page.ClientID()
		if r.sweeper == nil {
			r.sweeper = time.AfterFunc(r.every, r.sweep)
		}
	}
	r.scopes[key] = entry
	window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		r.mu.Lock()
		retired := r.scopes[key] == entry
		if retired {
			delete(r.scopes, key)
			r.closed[key] = time.Now().Add(time.Minute)
		}
		r.mu.Unlock()
		if retired && r.onRetire != nil {
			r.onRetire(entry.scope.Principal().Owner())
		}
	})
	return entry.scope
}

// sweep retires the scope of every server-mode page that is gone and keeps the timer running while the realm holds a page. It is the timer's function.
func (r *WindowRealm) sweep() {
	var gone []*Scope
	r.mu.Lock()
	pages := 0
	for key, entry := range r.scopes {
		if entry.client == "" {
			continue
		}
		if r.connected(entry.client) {
			entry.absent = 0
		} else {
			entry.absent++
		}
		if entry.absent < pageSweepAbsences {
			pages++
			continue
		}
		delete(r.scopes, key)
		r.closed[key] = time.Now().Add(time.Minute)
		gone = append(gone, entry.scope)
	}
	if pages > 0 && r.sweeper != nil {
		r.sweeper.Reset(r.every)
	} else {
		r.sweeper = nil
	}
	r.mu.Unlock()
	// Outside the lock, as the close event's callback does it: retiring an owner closes its streams.
	for _, scope := range gone {
		if r.onRetire != nil {
			r.onRetire(scope.Principal().Owner())
		}
	}
}

func (r *WindowRealm) Context(ctx context.Context) context.Context {
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	if scope := r.ScopeForWindow(window); scope != nil {
		return scope.Context(ctx)
	}
	// A missing, closed, or over-limit window must not retain another realm's grant.
	return context.WithValue(ctx, principalKey{}, Principal{})
}
