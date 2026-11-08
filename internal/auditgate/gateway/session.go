package gateway

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/netip"
	"sync"
	"time"
)

// Causes a session ends with. Each maps to a fixed diagnostic code and to the
// WebSocket close status a tunnel's client sees.
var (
	errAuditEnded        = errors.New("audit_ended")
	errCredentialRevoked = errors.New("credential_revoked")
	errCredentialExpired = errors.New("credential_expired")
	errReplaced          = errors.New("replaced")
	errPeerChanged       = errors.New("peer_changed")
	errClientGone        = errors.New("client_gone")
	errUpstreamGone      = errors.New("upstream_gone")
	errPingTimeout       = errors.New("ping_timeout")
	errSlowClient        = errors.New("slow_client")
	errUnexpectedFrame   = errors.New("unexpected_frame")
	errInternal          = errors.New("internal_error")
	errFinished          = errors.New("finished")
)

// principal is who an authenticated request is: a credential, the node that
// presented it and the address it came from.
type principal struct {
	credential string
	node       string
	remote     netip.AddrPort
}

// noPrincipal is the principal of a request that did not authenticate.
func noPrincipal() principal {
	var none principal
	return none
}

type sessionKind uint8

const (
	sessionRequest sessionKind = iota
	sessionTunnel
)

// session is one authenticated request or tunnel in flight. The gateway keeps
// every session so that revoking a credential, or ending the audit, can cancel
// them and wait for them to finish.
type session struct {
	g         *Gateway
	kind      sessionKind
	principal principal
	ctx       context.Context
	cancel    context.CancelCauseFunc
	done      chan struct{}
	once      sync.Once
}

// finish removes the session. It is safe to call more than once.
func (s *session) finish() {
	s.once.Do(func() {
		s.g.mu.Lock()
		delete(s.g.sessions, s)
		if s.kind == sessionTunnel {
			s.g.tunnels--
		} else {
			s.g.requests--
		}
		s.g.mu.Unlock()
		s.cancel(errFinished)
		close(s.done)
		s.g.wg.Done()
	})
}

// cause is why the session's context ended, or nil while it is live.
func (s *session) cause() error {
	if s.ctx.Err() == nil {
		return nil
	}
	return context.Cause(s.ctx)
}

// registerLocked adds a session. The caller has checked that the audit is
// active and has room. g.mu must be held.
func (g *Gateway) registerLocked(parent context.Context, kind sessionKind, p principal) *session {
	ctx, cancel := context.WithCancelCause(parent)
	s := &session{
		g:         g,
		kind:      kind,
		principal: p,
		ctx:       ctx,
		cancel:    cancel,
		done:      make(chan struct{}),
		once:      sync.Once{},
	}
	g.sessions[s] = struct{}{}
	if kind == sessionTunnel {
		g.tunnels++
	} else {
		g.requests++
	}
	g.wg.Add(1)
	return s
}

// beginRequest starts an authenticated HTTP request. It fails when the audit
// has ended, the credential stopped being usable since authentication, or the
// audit is serving as many requests as it allows.
func (g *Gateway) beginRequest(parent context.Context, p principal, now Instant) (*session, Denial, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.credentialLiveLocked(p.credential, now) {
		return nil, DenialEnded, false
	}
	if g.requests >= g.cfg.Limits.MaxInFlight {
		return nil, DenialCapacity, false
	}
	return g.registerLocked(parent, sessionRequest, p), "", true
}

// credentialLiveLocked reports whether the audit is active and the credential
// can still authenticate. g.mu must be held.
func (g *Gateway) credentialLiveLocked(id string, now Instant) bool {
	if g.state != StateActive {
		return false
	}
	index := g.table.find(id)
	return index >= 0 && g.table.slots[index].live(now)
}

// cancelCredentialLocked cancels every session of a credential and returns the
// channels that close when they have finished. g.mu must be held.
func (g *Gateway) cancelCredentialLocked(id string, cause error) []chan struct{} {
	var done []chan struct{}
	for s := range g.sessions {
		if s.principal.credential == id {
			s.cancel(cause)
			done = append(done, s.done)
		}
	}
	return done
}

func (g *Gateway) cancelAllLocked(cause error) {
	for s := range g.sessions {
		s.cancel(cause)
	}
}

// boundClient ties a remote page to one open events socket. The page chose
// its own client ID (the label); the host only ever sees the ID the gateway
// issued, so a remote cannot name an ID of its own, of another credential, or
// of a local window. The binding exists while the socket is open.
//
// A runtime call is dispatched only while it holds the client: the hold is
// taken under g.mu at the moment the call is about to be sent, and only while
// the tunnel is live, and the tunnel closes its upstream socket (which is what
// makes the host forget the issued ID) only after the holds are gone.
type boundClient struct {
	key clientKey
	// issued is the client ID registered upstream for this socket.
	issued string
	// prefix scopes the page's call IDs and ends in a terminator that no call
	// ID contains.
	prefix  string
	session *session
	ready   bool
	// calls is the number of holds; drained is closed when it reaches zero
	// while a teardown waits. Both are guarded by Gateway.mu.
	calls   int
	drained chan struct{}
}

type clientKey struct {
	credential string
	label      string
}

const clientDomain = "omniview-audit-client-v1"

// callIDTerminator ends a client's call ID prefix. Call IDs are limited to
// letters, digits, "_" and "-", so the terminator cannot appear in one, and
// two clients' prefixed IDs can never collide or run into each other.
const callIDTerminator = "."

func (g *Gateway) clientPrefix(key clientKey) string {
	sum := g.keyedDigest(clientDomain, g.id, key.credential, key.label)
	return hex.EncodeToString(sum[:idBytes]) + callIDTerminator
}

// issueClientID makes the client ID registered upstream: 128 random bits as
// unpadded base64url, which the host accepts as a Wails client ID.
func issueClientID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

// openFailure is why an events socket could not be bound.
type openFailure uint8

const (
	openOK openFailure = iota
	openEnded
	openCapacity
	openBudget
	openChurn
)

// openTunnel admits an events socket and binds the page's client ID to it.
//
// It enforces, in one step under the lock: the audit and credential are live;
// the audit and the credential have room for another socket (a page
// reconnecting with the same client ID replaces its old socket instead of
// adding one); the audit has not used up its lifetime budget of upstream
// sockets; and the credential is not reconnecting faster than its allowance.
func (g *Gateway) openTunnel(
	parent context.Context, p principal, label string, now Instant,
) (*session, *boundClient, openFailure) {
	issued, err := issueClientID()
	if err != nil {
		return nil, nil, openEnded
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	index := g.table.find(p.credential)
	if g.state != StateActive || index < 0 || !g.table.slots[index].live(now) {
		return nil, nil, openEnded
	}
	slot := &g.table.slots[index]
	key := clientKey{credential: p.credential, label: label}
	replaced := g.clients[key]
	total, mine := g.countTunnelsLocked(p.credential, replaced)
	switch {
	case total >= g.cfg.Limits.MaxTunnels || mine >= g.cfg.Limits.MaxTunnelsPerCredential:
		return nil, nil, openCapacity
	case g.socketOpens >= g.cfg.Limits.MaxEventSocketOpens:
		return nil, nil, openBudget
	case !slot.opens.available(now.Mono):
		return nil, nil, openChurn
	}
	slot.opens.spend(now.Mono)
	g.socketOpens++
	if replaced != nil {
		delete(g.clients, key)
		replaced.session.cancel(errReplaced)
	}
	sess := g.registerLocked(parent, sessionTunnel, p)
	client := &boundClient{
		key: key, issued: issued, prefix: g.clientPrefix(key), session: sess,
		ready: false, calls: 0, drained: nil,
	}
	g.clients[key] = client
	return sess, client, openOK
}

// countTunnelsLocked counts live tunnels in the audit and, second, for one
// credential, leaving out the one a new socket replaces. g.mu must be held.
func (g *Gateway) countTunnelsLocked(credential string, replaced *boundClient) (int, int) {
	total, mine := 0, 0
	for s := range g.sessions {
		if s.kind != sessionTunnel || s.ctx.Err() != nil || (replaced != nil && s == replaced.session) {
			continue
		}
		total++
		if s.principal.credential == credential {
			mine++
		}
	}
	return total, mine
}

// refundOpen gives back an upstream socket that never opened.
func (g *Gateway) refundOpen() {
	g.mu.Lock()
	g.socketOpens = max(0, g.socketOpens-1)
	g.mu.Unlock()
}

// markReady lets runtime calls use a bound client: both sockets are open and
// the host has mapped the issued ID.
func (g *Gateway) markReady(c *boundClient) {
	g.mu.Lock()
	c.ready = true
	close(g.boundChanged)
	g.boundChanged = make(chan struct{})
	g.mu.Unlock()
}

// unbind removes a client's binding when its socket closes. A newer socket
// that replaced it keeps its own binding.
func (g *Gateway) unbind(c *boundClient) {
	g.mu.Lock()
	if g.clients[c.key] == c {
		delete(g.clients, c.key)
	}
	g.mu.Unlock()
}

// acquireLocked takes a hold on the client bound to key when its socket is
// open and its tunnel live, and returns nil otherwise. g.mu must be held.
func (g *Gateway) acquireLocked(key clientKey) *boundClient {
	c := g.clients[key]
	if c == nil || !c.ready || c.session.ctx.Err() != nil {
		return nil
	}
	c.calls++
	return c
}

// releaseClient gives a hold back.
func (g *Gateway) releaseClient(c *boundClient) {
	g.mu.Lock()
	c.calls--
	if c.calls <= 0 && c.drained != nil {
		close(c.drained)
		c.drained = nil
	}
	g.mu.Unlock()
}

// awaitClient takes a hold on the client bound to key, waiting up to the
// configured bind wait for its socket to open. A call never runs without a
// hold: after the wait the answer is nil. Only a bounded number of calls wait
// at once.
func (g *Gateway) awaitClient(ctx context.Context, key clientKey) *boundClient {
	wait := g.cfg.Timeouts.BindWait
	g.mu.Lock()
	if c := g.acquireLocked(key); c != nil {
		g.mu.Unlock()
		return c
	}
	if wait <= 0 || g.bindWaiters >= g.cfg.Limits.MaxBindWaiters {
		g.mu.Unlock()
		return nil
	}
	g.bindWaiters++
	g.mu.Unlock()
	defer func() {
		g.mu.Lock()
		g.bindWaiters--
		g.mu.Unlock()
	}()

	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		g.mu.Lock()
		c := g.acquireLocked(key)
		changed := g.boundChanged
		g.mu.Unlock()
		if c != nil {
			return c
		}
		select {
		case <-changed:
		case <-timer.C:
			return nil
		case <-ctx.Done():
			return nil
		}
	}
}

// waitCalls waits, up to limit, until no call holds the client. It reports
// whether the holds were gone in time. Holds are taken only while the tunnel
// is live, so once the tunnel has ended the count can only fall.
func (g *Gateway) waitCalls(c *boundClient, limit time.Duration) bool {
	g.mu.Lock()
	if c.calls <= 0 {
		g.mu.Unlock()
		return true
	}
	if c.drained == nil {
		c.drained = make(chan struct{})
	}
	done := c.drained
	g.mu.Unlock()

	timer := time.NewTimer(limit)
	defer timer.Stop()
	select {
	case <-done:
		return true
	case <-timer.C:
		return false
	}
}
