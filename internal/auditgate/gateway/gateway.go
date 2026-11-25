package gateway

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

// State is where an audit is in its life. An audit is active until it ends and
// never becomes active again.
type State string

// Audit states.
const (
	StateActive State = "active"
	StateEnded  State = "ended"
)

// clockJumpTolerance is how far the wall clock may be seen to step backward
// before the audit fails closed. Smaller steps are noise.
const clockJumpTolerance = 2 * time.Second

// Gateway is one audit generation: the http.Handler that fronts the loopback
// Wails endpoint, with its credentials, pairing offers and lifecycle. Build it
// with [New]; end it with [Gateway.Stop], expiry or a failed target check.
type Gateway struct {
	cfg       Config
	id        string
	realm     string
	origin    string
	authority string
	key       [keyBytes]byte

	allow    allowlist
	up       *upstreamClient
	peers    *peerResolver
	failures *failureLimiter
	admit    *admission
	pairing  *pairingFailures
	created  Instant
	expires  deadline

	// ctx is canceled when the audit ends; background work and request
	// contexts derive from it.
	ctx    context.Context
	cancel context.CancelFunc
	ended  chan struct{}
	// wg counts sessions. Sessions are added only while the audit is active,
	// so Stop's Wait always follows every Add.
	wg sync.WaitGroup

	denials denialCounters
	// eventsForwarded and eventsDropped count events messages through the
	// filter, for the status report.
	eventsForwarded atomic.Uint64
	eventsDropped   atomic.Uint64

	mu           sync.Mutex
	state        State
	reason       EndReason
	lastWall     time.Time
	table        credentialTable
	offers       [maxPairingOffers]pairingOffer
	sessions     map[*session]struct{}
	requests     int
	tunnels      int
	clients      map[clientKey]*boundClient
	boundChanged chan struct{}
	socketOpens  int
	bindWaiters  int
}

const keyBytes = 32

// New starts an audit for cfg.
//
// It verifies the upstream once before returning, so an audit never starts
// against a target that is already wrong. ctx bounds only that first check;
// the audit lives until [Gateway.Stop], its deadline, or a failed check. Call
// Stop even after expiry, to wait for in-flight work and release resources.
func New(ctx context.Context, cfg Config) (*Gateway, error) {
	cfg, err := cfg.validate()
	if err != nil {
		return nil, err
	}
	policy := cfg.Policy
	if policy == nil {
		policy, err = auditgate.Default()
		if err != nil {
			return nil, fmt.Errorf("gateway: load allowlist: %w", err)
		}
	}
	id, err := randomHex(auditIDBytes)
	if err != nil {
		return nil, err
	}
	now := cfg.Clock.Now()
	g := &Gateway{ //nolint:exhaustruct // The remaining fields are set below, once the clock has been read.
		cfg:       cfg,
		id:        id,
		realm:     "omniview-audit-" + id,
		origin:    "https://" + cfg.authority(),
		authority: cfg.authority(),
		key:       [keyBytes]byte{},
		allow:     policyAllowlist{policy: policy},
		up:        newUpstreamClient(cfg.upstreamAddress, cfg.Timeouts.UpstreamDial),
		peers: newPeerResolver(cfg.Peers,
			peerPolicy{owner: cfg.OwnerID, localNode: cfg.LocalNodeID, allowSelf: cfg.AllowSelf},
			cfg.Clock, cfg.Timeouts.PeerCache, cfg.Timeouts.PeerLookup),
		admit:        newAdmission(cfg.Limits.MaxUnauthenticated, cfg.Limits.MaxUnauthenticatedPerAddress),
		ended:        make(chan struct{}),
		wg:           sync.WaitGroup{},
		denials:      newDenialCounters(now.Mono),
		mu:           sync.Mutex{},
		state:        StateActive,
		reason:       EndNone,
		table:        credentialTable{slots: [credentialSlots]credentialSlot{}},
		offers:       [maxPairingOffers]pairingOffer{},
		sessions:     make(map[*session]struct{}),
		clients:      make(map[clientKey]*boundClient),
		boundChanged: make(chan struct{}),
	}
	if _, err = rand.Read(g.key[:]); err != nil {
		return nil, err
	}
	g.created = now
	g.expires = deadlineAfter(now, cfg.TTL)
	g.lastWall = now.Wall
	g.failures = newFailureLimiter(cfg.Limits, now.Mono)
	g.pairing = newPairingFailures(cfg.Limits, now.Mono)
	g.ctx, g.cancel = context.WithCancel(context.Background())
	if err = g.verifyTarget(ctx); err != nil {
		g.cancel()
		g.up.close()
		return nil, startFailure(err)
	}
	go g.watchClock()
	go g.watchTarget()
	return g, nil
}

// ID is the audit's opaque identifier. It is not a secret.
func (g *Gateway) ID() string { return g.id }

// Realm is the Basic authentication realm. It is fresh per audit, so a browser
// never reuses credentials cached for an earlier audit.
func (g *Gateway) Realm() string { return g.realm }

// Origin is the exact HTTPS origin the page is served from.
func (g *Gateway) Origin() string { return g.origin }

// ExpiresAt is the recorded wall-clock deadline. The audit ends there or
// earlier: a wall clock that was set back lets the monotonic deadline arrive
// first, and a stepped-back clock ends it at once. A suspend moves the wall
// clock ahead of the monotonic one, so after a suspend the recorded deadline
// is the one that counts.
func (g *Gateway) ExpiresAt() time.Time { return g.expires.wall }

// Ended is closed as soon as the audit stops accepting requests: at stop,
// expiry or a failed target check. The owner closes the listener when it fires.
func (g *Gateway) Ended() <-chan struct{} { return g.ended }

// EndReason reports why the audit ended, or EndNone while it is active.
func (g *Gateway) EndReason() EndReason {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.reason
}

// Stop ends the audit and waits for its tunnels and in-flight requests to
// close. New requests are refused before Stop returns. It returns
// [ErrShutdownIncomplete] if closure is not confirmed before ctx ends, or
// before the configured shutdown timeout when ctx has no deadline; the audit
// has ended all the same and refuses everything. Stopping an ended audit only
// waits again. With nothing left to close it returns nil even if ctx is
// already done.
func (g *Gateway) Stop(ctx context.Context) error {
	g.end(EndStopped)
	return g.waitClosed(ctx, nil, true)
}

// Revoke makes a credential unusable and closes everything it is serving. The
// revocation is effective in memory before Revoke returns; waiting for the
// closure is bounded as in [Gateway.Stop]. A credential cannot be revived. A
// browser that cached it will still be refused.
func (g *Gateway) Revoke(ctx context.Context, credentialID string) error {
	g.mu.Lock()
	if g.state != StateActive {
		g.mu.Unlock()
		return ErrAuditEnded
	}
	index := g.table.find(credentialID)
	if index < 0 {
		g.mu.Unlock()
		return ErrCredentialNotFound
	}
	slot := &g.table.slots[index]
	revoked := slot.state == slotActive || slot.state == slotPending
	if revoked {
		slot.state = slotRevoked
	}
	closing := g.cancelCredentialLocked(credentialID, errCredentialRevoked)
	node := slot.node
	g.mu.Unlock()
	if revoked {
		g.emit(g.event(EventCredentialRevoked, "", credentialID, node, ""))
	}
	return g.waitClosed(ctx, closing, false)
}

// waitClosed waits for the given sessions to finish, or for every session when
// all is set. Its answer is "closure confirmed" or [ErrShutdownIncomplete].
// When nothing is left to wait for it answers at once, whatever ctx says.
func (g *Gateway) waitClosed(ctx context.Context, sessions []chan struct{}, all bool) error {
	if g.nothingToClose(sessions, all) {
		return nil
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, g.cfg.Timeouts.Shutdown)
		defer cancel()
	}
	closed := make(chan struct{})
	go func() {
		defer close(closed)
		if all {
			g.wg.Wait()
			return
		}
		for _, done := range sessions {
			<-done
		}
	}()
	select {
	case <-closed:
		return nil
	case <-ctx.Done():
		select {
		case <-closed:
			return nil
		default:
			return ErrShutdownIncomplete
		}
	}
}

// nothingToClose reports, without waiting, that no session is left to wait for.
func (g *Gateway) nothingToClose(sessions []chan struct{}, all bool) bool {
	if all {
		g.mu.Lock()
		defer g.mu.Unlock()
		return len(g.sessions) == 0
	}
	for _, done := range sessions {
		select {
		case <-done:
		default:
			return false
		}
	}
	return true
}

// end stops the audit: it refuses new requests, voids every credential and
// pairing offer, and cancels everything in flight. It is idempotent and does
// not wait.
func (g *Gateway) end(reason EndReason) {
	g.mu.Lock()
	if g.state != StateActive {
		g.mu.Unlock()
		return
	}
	g.state = StateEnded
	g.reason = reason
	for i := range g.table.slots {
		if state := g.table.slots[i].state; state == slotActive || state == slotPending {
			g.table.slots[i].state = slotRevoked
		}
	}
	g.offers = [maxPairingOffers]pairingOffer{}
	g.cancelAllLocked(errAuditEnded)
	g.mu.Unlock()

	g.cancel()
	close(g.ended)
	g.up.close()
	g.emit(g.event(EventEnded, string(reason), "", "", ""))
}

// observe checks the clocks and returns whether the audit is still active.
//
// The audit expires at the earlier of its monotonic and wall-clock deadlines,
// so a suspend (the wall clock jumps, the monotonic clock stands still) cannot
// extend it. A wall clock seen to step backward means time can no longer be
// trusted, and the audit ends rather than guess.
func (g *Gateway) observe(now Instant) bool {
	var events []Event
	g.mu.Lock()
	if g.state != StateActive {
		g.mu.Unlock()
		return false
	}
	var reason EndReason
	switch {
	case now.Wall.Before(g.lastWall.Add(-clockJumpTolerance)):
		reason = EndClockJump
	case g.expires.reached(now):
		reason = EndExpired
	default:
		g.lastWall = laterOf(g.lastWall, now.Wall)
		g.expireCredentialsLocked(now, &events)
	}
	g.mu.Unlock()
	g.emitAll(events)
	if reason != EndNone {
		g.end(reason)
		return false
	}
	return true
}

func laterOf(a, b time.Time) time.Time {
	if b.After(a) {
		return b
	}
	return a
}

// watchClock enforces expiry independently of traffic.
func (g *Gateway) watchClock() {
	ticker := time.NewTicker(g.cfg.Timeouts.Watch)
	defer ticker.Stop()
	for {
		select {
		case <-g.ended:
			return
		case <-ticker.C:
			g.observe(g.cfg.Clock.Now())
		}
	}
}

// watchTarget re-verifies the upstream about once a second. Any failure ends
// the audit: a replaced host, a changed generation or an unreachable control
// plane is not something the gateway may keep serving through.
func (g *Gateway) watchTarget() {
	ticker := time.NewTicker(g.cfg.Timeouts.Watch)
	defer ticker.Stop()
	for {
		select {
		case <-g.ended:
			return
		case <-ticker.C:
			if err := g.verifyTarget(g.ctx); err != nil {
				if g.ctx.Err() != nil {
					return
				}
				reason := EndTargetUnavailable
				if errors.Is(err, ErrTargetChanged) {
					reason = EndTargetChanged
				}
				g.end(reason)
				return
			}
		}
	}
}

// verifyTarget asks the upstream to prove it is still the target. An
// implementation that ignores ctx cannot stall the caller past the timeout,
// and one that panics fails the verification instead of the process.
func (g *Gateway) verifyTarget(parent context.Context) error {
	ctx, cancel := context.WithTimeout(parent, g.cfg.Timeouts.Verify)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		defer func() {
			if recover() != nil {
				result <- errVerifyPanicked
			}
		}()
		result <- g.cfg.Upstream.Verify(ctx)
	}()
	select {
	case err := <-result:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

var errVerifyPanicked = errors.New("gateway: the upstream verification panicked")

// startFailure maps a failed first verification to the audit's error codes.
func startFailure(err error) error {
	switch {
	case errors.Is(err, ErrTargetChanged):
		return err
	case errors.Is(err, context.DeadlineExceeded):
		return fmt.Errorf("%w: %w", ErrTimeout, err)
	default:
		return fmt.Errorf("%w: %w", ErrTargetUnavailable, err)
	}
}

func (g *Gateway) event(kind EventKind, code, credential, node, subject string) Event {
	return Event{
		At:           g.cfg.Clock.Now().Wall,
		Kind:         kind,
		Code:         code,
		CredentialID: credential,
		NodeID:       node,
		Subject:      subject,
	}
}

// emit hands one event to the configured sink. A sink that panics must not
// take the audit, or the process, down with it.
func (g *Gateway) emit(event Event) {
	if g.cfg.Events == nil {
		return
	}
	defer func() { _ = recover() }()
	g.cfg.Events(event)
}

func (g *Gateway) emitAll(events []Event) {
	for _, event := range events {
		g.emit(event)
	}
}
