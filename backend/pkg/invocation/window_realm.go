package invocation

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"slices"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	logging "github.com/omniviewdev/plugin-sdk/log"
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
// Every per-window registry of the host (the source coordinator, the metric sessions, the graph observations) releases its entries
// on the realm's one retirement signal, OnRetire, so a page and a native window free their slots the same way.
type WindowRealm struct {
	mu       sync.Mutex
	scopes   map[WindowIdentity]*windowEntry
	closed   map[WindowIdentity]time.Time
	onRetire func(string)
	// subscribers hear of each retirement after onRetire: the registries keyed by window.
	subscribers []func(WindowIdentity)
	// connected reports whether a client id has an events socket registered; every is the sweep's interval.
	connected func(client string) bool
	every     time.Duration
	// sweeper is the timer of the sweep: set while the realm holds a server-mode window, nil otherwise.
	sweeper *time.Timer
	// log says that a window was refused for lack of a slot; nil says nothing.
	log logging.Logger
	now func() time.Time
	// refused holds the windows already named in the log, with the time of the line, and suppressed counts the lines a full table dropped.
	refused    map[WindowIdentity]time.Time
	suppressed int
}

const (
	// maxRealmWindows is the number of live windows the realm serves; maxClosedWindows the number of closed ones it remembers.
	maxRealmWindows  = 64
	maxClosedWindows = 1024
	// A refused window is named in the host's log once for each refusalLogEvery, and at most refusedWindowsKept windows are remembered for that:
	// a page retries every few seconds, and a burst of windows must not grow the table or the log.
	refusalLogEvery    = time.Minute
	refusedWindowsKept = 1024
	refusalMessage     = "window realm refused a window: no free slot"
)

// ErrWindowLimit is what a window is refused with when the realm holds no free slot for it. It is the cause of the RESOURCE_LIMIT
// error a service answers with, never a permission refusal.
var ErrWindowLimit = errors.New("no free window slot")

// ErrWindowUnavailable is what a missing window, or one the realm retired, is refused with.
var ErrWindowUnavailable = errors.New("window unavailable")

// windowLimitError is the page's answer to ErrWindowLimit: the class's own text and the code RESOURCE_LIMIT, with neither the limit nor the count.
func windowLimitError() error {
	err := apperror.WrapWithDetail(ErrWindowLimit, apperror.TypeResourceLimit, http.StatusTooManyRequests, "Resource limit", "The operation exceeds a host resource limit.")
	err.Code = "RESOURCE_LIMIT"
	return apperror.ForResource(err, "")
}

// WindowRealmOption configures a realm at construction.
type WindowRealmOption func(*WindowRealm)

// WithLogger gives the realm the host's logger, which it uses to say that it refused a window for lack of a slot.
func WithLogger(log logging.Logger) WindowRealmOption {
	return func(r *WindowRealm) { r.log = log }
}

// WithPageSweep replaces Wails' registry of connected pages and the sweep's interval.
// A realm built for a test of another package uses it to close a page without a browser.
func WithPageSweep(connected func(client string) bool, every time.Duration) WindowRealmOption {
	return func(r *WindowRealm) { r.connected, r.every = connected, every }
}

func NewWindowRealm(onRetire func(string), options ...WindowRealmOption) *WindowRealm {
	r := &WindowRealm{
		mu: sync.Mutex{}, scopes: make(map[WindowIdentity]*windowEntry), closed: make(map[WindowIdentity]time.Time), onRetire: onRetire,
		subscribers: nil, connected: pageConnected, every: pageSweepEvery, sweeper: nil, log: nil, now: time.Now,
		refused: make(map[WindowIdentity]time.Time), suppressed: 0,
	}
	for _, option := range options {
		option(r)
	}
	return r
}

// OnRetire registers fn to run each time the realm retires a window, once for each window: for a native window when Wails fires its
// close event, for a server-mode page when the sweep finds its events socket gone. fn runs after the source owner is retired, outside the
// realm's lock, and the window is already refused when it runs. A registry keyed by window drops its entry in fn; it never listens to a window's own close event,
// which a server-mode window never fires.
func (r *WindowRealm) OnRetire(fn func(WindowIdentity)) {
	if fn == nil {
		return
	}
	r.mu.Lock()
	r.subscribers = append(r.subscribers, fn)
	r.mu.Unlock()
}

// pageConnected reports whether the page of a client id has an events socket registered with Wails' server (never, in a build that is not a server).
func pageConnected(client string) bool { return application.GetBrowserWindow(client) != nil }

// limitRefusal describes a window refused for lack of a slot, and whether this refusal is the one the log names.
type limitRefusal struct {
	registry   string
	limit      int
	count      int
	say        bool
	suppressed int
}

// ScopeForWindow accepts only the native window object, never a caller-supplied ID.
func (r *WindowRealm) ScopeForWindow(window application.Window) *Scope {
	scope, _ := r.AdmitWindow(window)
	return scope
}

// AdmitWindow is ScopeForWindow with the reason: ErrWindowLimit (inside a RESOURCE_LIMIT error) for a window that found no free slot, and
// ErrWindowUnavailable for a missing window or one the realm retired.
func (r *WindowRealm) AdmitWindow(window application.Window) (*Scope, error) {
	if window == nil {
		return nil, ErrWindowUnavailable
	}
	key := IdentityOf(window)
	scope, refusal := r.grant(key, window)
	if refusal != nil {
		if refusal.say && r.log != nil {
			_, page := window.(interface{ ClientID() string })
			fields := []any{"registry", refusal.registry, "limit", refusal.limit, "count", refusal.count, "window", key.id, "page", page}
			if refusal.suppressed > 0 {
				fields = append(fields, "suppressed", refusal.suppressed)
			}
			r.log.Warnw(context.Background(), refusalMessage, fields...)
		}
		return nil, windowLimitError()
	}
	if scope == nil {
		return nil, ErrWindowUnavailable
	}
	return scope, nil
}

// grant finds or makes the window's scope under the lock. Its result is the scope, or a refusal for lack of a slot, or neither for a closed window.
func (r *WindowRealm) grant(key WindowIdentity, window application.Window) (*Scope, *limitRefusal) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	for id, until := range r.closed {
		if !now.Before(until) {
			delete(r.closed, id)
		}
	}
	if _, closed := r.closed[key]; closed {
		return nil, nil
	}
	if entry := r.scopes[key]; entry != nil {
		return entry.scope, nil
	}
	switch {
	case len(r.scopes) >= maxRealmWindows:
		return nil, r.refuse(key, now, &limitRefusal{registry: "window-realm", limit: maxRealmWindows, count: len(r.scopes), say: false, suppressed: 0})
	case len(r.closed) >= maxClosedWindows:
		return nil, r.refuse(key, now, &limitRefusal{registry: "window-realm-closed", limit: maxClosedWindows, count: len(r.closed), say: false, suppressed: 0})
	}
	delete(r.refused, key)
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
			r.closed[key] = r.now().Add(time.Minute)
		}
		r.mu.Unlock()
		if retired {
			r.announce(key, entry.scope)
		}
	})
	return entry.scope, nil
}

// refuse decides, under the lock, whether this refusal is written to the log: the first of each window, then one a refusalLogEvery.
func (r *WindowRealm) refuse(key WindowIdentity, now time.Time, refusal *limitRefusal) *limitRefusal {
	if at, known := r.refused[key]; known && now.Sub(at) < refusalLogEvery {
		return refusal
	}
	for id, at := range r.refused {
		if now.Sub(at) >= refusalLogEvery {
			delete(r.refused, id)
		}
	}
	if _, known := r.refused[key]; !known && len(r.refused) >= refusedWindowsKept {
		r.suppressed++
		return refusal
	}
	r.refused[key] = now
	refusal.say, refusal.suppressed = true, r.suppressed
	r.suppressed = 0
	return refusal
}

// announce is the realm's one retirement signal: the source owner first, then every registry that subscribed. It runs outside the lock because
// retiring an owner closes its streams.
func (r *WindowRealm) announce(key WindowIdentity, scope *Scope) {
	if r.onRetire != nil {
		r.onRetire(scope.Principal().Owner())
	}
	r.mu.Lock()
	subscribers := slices.Clone(r.subscribers)
	r.mu.Unlock()
	for _, fn := range subscribers {
		fn(key)
	}
}

type retiredWindow struct {
	key   WindowIdentity
	scope *Scope
}

// sweep retires the scope of every server-mode page that is gone and keeps the timer running while the realm holds a page. It is the timer's function.
func (r *WindowRealm) sweep() {
	var gone []retiredWindow
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
		r.closed[key] = r.now().Add(time.Minute)
		gone = append(gone, retiredWindow{key: key, scope: entry.scope})
	}
	if pages > 0 && r.sweeper != nil {
		r.sweeper.Reset(r.every)
	} else {
		r.sweeper = nil
	}
	r.mu.Unlock()
	for _, window := range gone {
		r.announce(window.key, window.scope)
	}
}

// refusalKey carries, in the context of a window refused for lack of a slot, the error the boundary answers with.
type refusalKey struct{}

func (r *WindowRealm) Context(ctx context.Context) context.Context {
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	scope, err := r.AdmitWindow(window)
	if scope != nil {
		return scope.Context(ctx)
	}
	// A missing, closed, or over-limit window must not retain another realm's grant.
	ctx = context.WithValue(ctx, principalKey{}, Principal{owner: "", origin: "", generation: ""})
	if errors.Is(err, ErrWindowLimit) {
		// The boundary then answers RESOURCE_LIMIT, not the denial of a caller with no host-issued invocation.
		ctx = context.WithValue(ctx, refusalKey{}, err)
	}
	return ctx
}
