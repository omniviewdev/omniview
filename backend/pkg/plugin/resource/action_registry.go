package resource

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
)

const (
	actionAttachTimeout     = 10 * time.Second
	actionTerminalRetention = 30 * time.Second
	actionLifetime          = 10 * time.Minute
	actionStartupTimeout    = 30 * time.Second
	actionSnapshotBudget    = 64 * 1024
	actionRealmQuota        = 32
	actionTotalQuota        = 64
)

type ActionEventDTO struct {
	Type  string             `json:"type"`
	Data  map[string]any     `json:"data,omitempty"`
	Error *apperror.AppError `json:"error,omitempty"`
}
type ActionSnapshot struct {
	Sequence uint64         `json:"sequence"`
	Event    ActionEventDTO `json:"event"`
	Terminal bool           `json:"terminal"`
}
type actionTimer interface{ Stop() bool }
type actionReservation struct {
	request  invocation.Request
	provider string
	cancel   context.CancelFunc
}
type actionHandle struct {
	// delivery fences actual dispatch against completed removal. Never wait for it
	// while holding the registry mutex.
	delivery      sync.Mutex
	id            string
	request       invocation.Request
	closing       bool
	provider      string
	cancel        context.CancelFunc
	attached      bool
	snapshot      ActionSnapshot
	attachTimer   actionTimer
	lifetimeTimer actionTimer
	terminalTimer actionTimer
}
type actionRegistry struct {
	mu        sync.Mutex
	pending   map[*actionReservation]struct{}
	entries   map[string]*actionHandle
	blocked   map[string]bool
	closed    bool
	afterFunc func(time.Duration, func()) actionTimer
	// Private action adapter: Emit must not synchronously cancel/stop this registry.
	// Wails supports synchronous Go hooks, but no such action hooks are registered;
	// remote frontend cancellation cannot synchronously reenter this call.
	emit func(string, ActionSnapshot)
}

func newActionRegistry() *actionRegistry {
	return &actionRegistry{pending: make(map[*actionReservation]struct{}), entries: make(map[string]*actionHandle), blocked: make(map[string]bool), afterFunc: func(d time.Duration, fn func()) actionTimer { return time.AfterFunc(d, fn) }}
}
func unavailableAction() error {
	return apperror.Forbidden("Access denied", "The action handle is not available to this invocation.")
}
func (r *actionRegistry) reserve(request invocation.Request, cancel context.CancelFunc) (*actionReservation, error) {
	provider := request.Target().Provider
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.blocked[provider] {
		return nil, unavailableAction()
	}
	count := 0
	for pending := range r.pending {
		if pending.request.Principal() == request.Principal() {
			count++
		}
	}
	for _, handle := range r.entries {
		if handle.request.Principal() == request.Principal() {
			count++
		}
	}
	if count >= actionRealmQuota || len(r.pending)+len(r.entries) >= actionTotalQuota {
		return nil, apperror.New(apperror.TypeResourceLimit, 429, "Resource limit", "Too many active actions.")
	}
	reservation := &actionReservation{request: request, provider: provider, cancel: cancel}
	r.pending[reservation] = struct{}{}
	return reservation, nil
}
func (r *actionRegistry) release(reservation *actionReservation) {
	r.mu.Lock()
	delete(r.pending, reservation)
	r.mu.Unlock()
}
func (r *actionRegistry) commit(reservation *actionReservation, ctx context.Context) (*actionHandle, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.pending[reservation]; !ok || r.closed || r.blocked[reservation.provider] {
		return nil, unavailableAction()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	delete(r.pending, reservation)
	handle := &actionHandle{id: uuid.NewString(), request: reservation.request, provider: reservation.provider, cancel: reservation.cancel, snapshot: ActionSnapshot{Sequence: 1, Event: ActionEventDTO{Type: "progress", Data: map[string]any{"message": "Started"}}}}
	r.entries[handle.id] = handle
	handle.attachTimer = r.afterFunc(actionAttachTimeout, func() { r.expireUnattached(handle) })
	handle.lifetimeTimer = r.afterFunc(actionLifetime, func() { r.expire(handle, true) })
	return handle, nil
}
func (r *actionRegistry) owned(ctx context.Context, id string) (*actionHandle, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	handle := r.entries[id]
	if handle == nil || handle.closing || !handle.request.OwnedBy(ctx) {
		return nil, unavailableAction()
	}
	return handle, nil
}
func (r *actionRegistry) attach(ctx context.Context, id string) (ActionSnapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	handle := r.entries[id]
	if handle == nil || handle.closing || !handle.request.OwnedBy(ctx) {
		return ActionSnapshot{}, unavailableAction()
	}
	if err := ctx.Err(); err != nil {
		return ActionSnapshot{}, err
	}
	handle.attached = true
	if handle.attachTimer != nil {
		handle.attachTimer.Stop()
		handle.attachTimer = nil
	}
	return handle.snapshot, nil
}
func (r *actionRegistry) cancelOwned(ctx context.Context, id string) error {
	r.mu.Lock()
	handle := r.entries[id]
	if handle == nil || handle.closing || !handle.request.OwnedBy(ctx) {
		r.mu.Unlock()
		return unavailableAction()
	}
	r.removeLocked(handle)
	r.mu.Unlock()
	handle.cancel()
	r.finishRemoval(handle)
	return nil
}
func (r *actionRegistry) update(handle *actionHandle, event ActionEventDTO, terminal bool) {
	handle.delivery.Lock()
	defer handle.delivery.Unlock()
	r.mu.Lock()
	if r.entries[handle.id] != handle || handle.closing || handle.snapshot.Terminal {
		r.mu.Unlock()
		return
	}
	if handle.snapshot.Sequence >= 9007199254740990 {
		event = ActionEventDTO{Type: "error", Error: apperror.ForResource(apperror.New(apperror.TypeResourceLimit, 429, "Resource limit", "Action event limit exceeded."), handle.request.ID())}
		terminal = true
	}
	handle.snapshot = ActionSnapshot{Sequence: handle.snapshot.Sequence + 1, Event: event, Terminal: terminal}
	if terminal {
		if handle.lifetimeTimer != nil {
			handle.lifetimeTimer.Stop()
			handle.lifetimeTimer = nil
		}
		handle.terminalTimer = r.afterFunc(actionTerminalRetention, func() { r.expire(handle, false) })
	}
	snapshot, attached, emit := handle.snapshot, handle.attached, r.emit
	r.mu.Unlock()
	if terminal {
		handle.cancel()
	}
	if attached && emit != nil {
		emit(handle.id, snapshot)
	}
}
func (r *actionRegistry) removeLocked(handle *actionHandle) {
	// Keep closing handles discoverable by concurrent stop calls until fenced.
	handle.closing = true
	for _, timer := range []actionTimer{handle.attachTimer, handle.lifetimeTimer, handle.terminalTimer} {
		if timer != nil {
			timer.Stop()
		}
	}
}
func (r *actionRegistry) finishRemoval(handle *actionHandle) {
	handle.delivery.Lock()
	defer handle.delivery.Unlock()
	r.mu.Lock()
	if r.entries[handle.id] == handle {
		delete(r.entries, handle.id)
	}
	r.mu.Unlock()
}
func (r *actionRegistry) expireUnattached(handle *actionHandle) {
	r.mu.Lock()
	if r.entries[handle.id] != handle || handle.closing || handle.attached {
		r.mu.Unlock()
		return
	}
	r.removeLocked(handle)
	r.mu.Unlock()
	handle.cancel()
	r.finishRemoval(handle)
}
func (r *actionRegistry) expire(handle *actionHandle, timeout bool) {
	handle.delivery.Lock()
	defer handle.delivery.Unlock()
	r.mu.Lock()
	if r.entries[handle.id] != handle || handle.closing || (timeout && handle.snapshot.Terminal) {
		r.mu.Unlock()
		return
	}
	attached, emit := handle.attached, r.emit
	r.removeLocked(handle)
	if timeout && attached && emit != nil {
		snapshot := ActionSnapshot{Sequence: handle.snapshot.Sequence + 1, Terminal: true, Event: ActionEventDTO{Type: "error", Error: apperror.ForResource(context.DeadlineExceeded, handle.request.ID())}}
		handle.snapshot = snapshot
		// Keep the handle tracked until dispatch completes, so stop can fence it.
		r.mu.Unlock()
		handle.cancel()
		emit(handle.id, snapshot)
		r.mu.Lock()
		if r.entries[handle.id] == handle {
			delete(r.entries, handle.id)
		}
		r.mu.Unlock()
		return
	}
	delete(r.entries, handle.id)
	r.mu.Unlock()
	handle.cancel()
}
func (r *actionRegistry) startPlugin(provider string) {
	r.mu.Lock()
	delete(r.blocked, provider)
	r.mu.Unlock()
}
func (r *actionRegistry) stopPlugin(provider string) { r.stop(provider, false) }
func (r *actionRegistry) stopAll()                   { r.stop("", true) }
func (r *actionRegistry) stop(provider string, all bool) {
	var cancel []context.CancelFunc
	var handles []*actionHandle
	r.mu.Lock()
	if all {
		r.closed = true
	} else {
		r.blocked[provider] = true
	}
	for reservation := range r.pending {
		if all || reservation.provider == provider {
			delete(r.pending, reservation)
			cancel = append(cancel, reservation.cancel)
		}
	}
	for _, handle := range r.entries {
		if all || handle.provider == provider {
			r.removeLocked(handle)
			handles = append(handles, handle)
		}
	}
	r.mu.Unlock()
	for _, fn := range cancel {
		fn()
	}
	for _, handle := range handles {
		handle.cancel()
	}
	for _, handle := range handles {
		r.finishRemoval(handle)
	}
}
