package gateway

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

// websocketPair returns the two ends of a real WebSocket connection: the
// dialing end, then the accepting end.
func websocketPair(t *testing.T) (*websocket.Conn, *websocket.Conn) {
	t.Helper()
	accepted := make(chan *websocket.Conn, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		accepted <- conn
	}))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	client, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		srv.Close()
		t.Fatal(err)
	}
	server := <-accepted
	t.Cleanup(func() {
		_ = client.CloseNow()
		_ = server.CloseNow()
		srv.Close()
	})
	return client, server
}

// The writer refuses to send an event that has waited longer than the lag
// budget, even when no new event arrives to make the queue notice: a page that
// wakes from a long pause is cut off, not fed what happened while it slept.
func TestAnEventThatWaitedLongerThanTheLagBudgetIsNeverSent(t *testing.T) {
	gw, clock := newTestGateway(t, func(c *Config) { c.Timeouts.TunnelLag = 100 * time.Millisecond })
	issueForTest(t, gw, clock)
	p := principal{
		credential: gw.Status().Credentials[0].ID, node: "node", remote: netip.MustParseAddrPort("100.64.0.1:1"),
	}
	sess, _, failure := gw.openTunnel(context.Background(), p, "page", clock.Now())
	if failure != openOK {
		t.Fatalf("openTunnel failed: %v", failure)
	}
	defer sess.finish()
	down, _ := websocketPair(t)
	// The queue's own age bound is set out of the way, so that only the
	// writer's check can act.
	queue := newTunnelQueue(1<<20, 100, time.Hour)
	queue.push([]byte(`{"name":"plugin/state_change","data":1}`), time.Now().Add(-time.Second))

	done := make(chan struct{})
	go func() {
		defer close(done)
		gw.writeDownstream(context.Background(), sess, down, queue)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the writer sent, or waited on, an event that was already too old")
	}
	if !errors.Is(sess.cause(), errSlowClient) {
		t.Fatalf("the tunnel ended with %v, want slow_client", sess.cause())
	}
	if sent := gw.eventsForwarded.Load(); sent != 0 {
		t.Fatalf("%d events were sent; the stale one must not be", sent)
	}
}

// TestInterruptWritesEndsABlockedWriteWithNothingButTheDeadline serves from a
// server that records no connection, as an owner's own server would: the write
// deadline set to now is all that can free a handler stuck writing to a client
// that reads nothing.
func TestInterruptWritesEndsABlockedWriteWithNothingButTheDeadline(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var chunks atomic.Int64
	returned := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(returned)
		stop := interruptWrites(ctx, r, w)
		defer stop()
		chunk := make([]byte, 64<<10)
		for {
			if _, err := w.Write(chunk); err != nil {
				return
			}
			chunks.Add(1)
		}
	}))
	defer srv.Close()
	conn, err := net.Dial("tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err = io.WriteString(conn, "GET / HTTP/1.1\r\nHost: test\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	// The client reads nothing; wait until the handler's writes stop.
	last, unchanged := int64(-1), 0
	eventually(t, 30*time.Second, "the handler's write to stall", func() bool {
		time.Sleep(100 * time.Millisecond)
		now := chunks.Load()
		if now > 0 && now == last {
			unchanged++
		} else {
			unchanged = 0
		}
		last = now
		return unchanged >= 3
	})

	cancel()
	select {
	case <-returned:
	case <-time.After(3 * time.Second):
		t.Fatal("canceling the context did not free a handler stuck in a write")
	}
}

// drain reads and discards what arrives on conn, so its close handshake is
// answered, until it fails.
func drain(conn *websocket.Conn) {
	go func() {
		for {
			if _, _, err := conn.Read(context.Background()); err != nil {
				return
			}
		}
	}()
}

// tunnelFixture runs one tunnel over two real WebSocket pairs: up is the
// gateway's socket to a host that upHost stands in for, down is the page's.
type tunnelFixture struct {
	gw      *Gateway
	sess    *session
	client  *boundClient
	key     clientKey
	upHost  *websocket.Conn
	pageEnd *websocket.Conn
	done    chan struct{}
}

func startTunnel(t *testing.T, adjust ...func(*Config)) *tunnelFixture {
	t.Helper()
	gw, clock := newTestGateway(t, adjust...)
	issueForTest(t, gw, clock)
	credential := gw.Status().Credentials[0].ID
	p := principal{credential: credential, node: "node", remote: netip.MustParseAddrPort("100.64.0.1:1")}
	sess, client, failure := gw.openTunnel(context.Background(), p, "page", clock.Now())
	if failure != openOK {
		t.Fatalf("openTunnel failed: %v", failure)
	}
	up, upHost := websocketPair(t)
	down, pageEnd := websocketPair(t)
	drain(pageEnd)
	f := &tunnelFixture{
		gw: gw, sess: sess, client: client, key: client.key, upHost: upHost, pageEnd: pageEnd,
		done: make(chan struct{}),
	}
	go func() {
		defer close(f.done)
		defer sess.finish()
		gw.runTunnel(sess, client, up, down)
	}()
	eventually(t, 5*time.Second, "the tunnel to be ready", func() bool {
		gw.mu.Lock()
		defer gw.mu.Unlock()
		return client.ready
	})
	return f
}

func eventually(t *testing.T, timeout time.Duration, what string, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// readsUntilClosed reports what conn's next read returns, from a goroutine, so
// that a test can ask whether it has returned without giving the read a
// deadline, which would close the connection itself.
func readsUntilClosed(conn *websocket.Conn) <-chan error {
	result := make(chan error, 1)
	go func() {
		_, _, err := conn.Read(context.Background())
		result <- err
	}()
	return result
}

// TestATunnelClosesItsHostSocketOnlyAfterTheCallsHoldingItHaveReturned pins the
// order that keeps a call from running as the host's first window: the host
// forgets the issued client ID when its socket closes, so the socket must stay
// open until every call that holds the ID has returned.
func TestATunnelClosesItsHostSocketOnlyAfterTheCallsHoldingItHaveReturned(t *testing.T) {
	f := startTunnel(t, func(c *Config) {
		c.Timeouts.CallDrain = 10 * time.Second
		c.Timeouts.CloseGrace = time.Second
	})
	hold := f.gw.awaitClient(context.Background(), f.key)
	if hold == nil {
		t.Fatal("no hold on a ready tunnel")
	}
	hostRead := readsUntilClosed(f.upHost)

	f.sess.cancel(errClientGone)
	select {
	case err := <-hostRead:
		t.Fatalf("the host's socket ended while a call still held the tunnel: %v", err)
	case <-time.After(400 * time.Millisecond):
	}
	if f.gw.acquireLockedForTest(f.key) != nil {
		t.Fatal("a call took a hold on a tunnel that has ended")
	}

	f.gw.releaseClient(hold)
	select {
	case err := <-hostRead:
		if status := websocket.CloseStatus(err); status != websocket.StatusGoingAway {
			t.Fatalf("host socket ended with %v (status %d), want a close with going away", err, status)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the host's socket was not closed after the last hold was given back")
	}
	<-f.done
}

// acquireLockedForTest takes a hold the way a call does.
func (g *Gateway) acquireLockedForTest(key clientKey) *boundClient {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.acquireLocked(key)
}

func TestAHoldThatIsNeverGivenBackDelaysTheCloseOnlyByCallDrain(t *testing.T) {
	f := startTunnel(t, func(c *Config) {
		c.Timeouts.CallDrain = 300 * time.Millisecond
		c.Timeouts.CloseGrace = time.Second
	})
	if f.gw.awaitClient(context.Background(), f.key) == nil {
		t.Fatal("no hold on a ready tunnel")
	}
	hostRead := readsUntilClosed(f.upHost)
	begin := time.Now()
	f.sess.cancel(errClientGone)
	select {
	case <-hostRead:
	case <-time.After(5 * time.Second):
		t.Fatal("a hold nobody gave back kept the host's socket open past the drain bound")
	}
	if waited := time.Since(begin); waited < 250*time.Millisecond {
		t.Fatalf("the host's socket closed after %v, before the drain bound: the hold was not waited for", waited)
	}
	<-f.done
}

func TestWaitCallsAnswersAtOnceWhenNothingHoldsTheClient(t *testing.T) {
	gw, _ := newTestGateway(t)
	idle := &boundClient{key: clientKey{credential: "c", label: "l"}, calls: 0}
	begin := time.Now()
	if !gw.waitCalls(idle, time.Minute) || time.Since(begin) > time.Second {
		t.Fatal("waitCalls waited for a client nothing holds")
	}
	held := &boundClient{key: clientKey{credential: "c", label: "l"}, calls: 1}
	if gw.waitCalls(held, 50*time.Millisecond) {
		t.Fatal("waitCalls reported a held client as free")
	}
	go func() {
		time.Sleep(50 * time.Millisecond)
		gw.releaseClient(held)
	}()
	if !gw.waitCalls(held, 5*time.Second) {
		t.Fatal("waitCalls did not see the last hold released")
	}
}

// panickingAllowlist stands for a bug in the filter, or in anything else a
// tunnel goroutine runs.
type panickingAllowlist struct{ policyAllowlist }

func (panickingAllowlist) filter(auditgate.MessageKind, []byte) eventDecision {
	panic("a bug in the event filter")
}

func TestAPanicInATunnelGoroutineEndsTheTunnelAndNotTheProcess(t *testing.T) {
	f := startTunnel(t)
	f.gw.allow = panickingAllowlist{}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := f.upHost.Write(ctx, websocket.MessageText, []byte(`{"name":"plugin/state_change","data":1}`)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-f.done:
	case <-time.After(5 * time.Second):
		t.Fatal("the tunnel did not end after its goroutine panicked")
	}
	if cause := f.sess.cause(); !errors.Is(cause, errInternal) {
		t.Fatalf("the tunnel ended with %v, want internal_error", cause)
	}
}

func TestEveryCauseHasACloseStatusAndADiagnosticCode(t *testing.T) {
	cases := []struct {
		cause  error
		status websocket.StatusCode
		code   string
	}{
		{errAuditEnded, websocket.StatusGoingAway, "audit_ended"},
		{errCredentialRevoked, websocket.StatusPolicyViolation, "credential_revoked"},
		{errCredentialExpired, websocket.StatusPolicyViolation, "credential_expired"},
		{errReplaced, websocket.StatusGoingAway, "replaced"},
		{errPeerChanged, websocket.StatusPolicyViolation, "peer_changed"},
		{errClientGone, websocket.StatusGoingAway, "client_gone"},
		{errUpstreamGone, websocket.StatusGoingAway, "upstream_gone"},
		{errPingTimeout, websocket.StatusGoingAway, "ping_timeout"},
		{errSlowClient, websocket.StatusTryAgainLater, "slow_client"},
		{errUnexpectedFrame, websocket.StatusPolicyViolation, "unexpected_frame"},
		{errInternal, websocket.StatusInternalError, "internal_error"},
		{errFinished, websocket.StatusGoingAway, closedCode},
		{nil, websocket.StatusGoingAway, closedCode},
		{errors.New("an unlisted cause"), websocket.StatusGoingAway, closedCode},
	}
	for _, tc := range cases {
		if got := closeStatus(tc.cause); got != tc.status {
			t.Errorf("closeStatus(%v) = %d, want %d", tc.cause, got, tc.status)
		}
		if got := causeCode(tc.cause); got != tc.code {
			t.Errorf("causeCode(%v) = %q, want %q", tc.cause, got, tc.code)
		}
	}
}

func TestAnEventsSinkThatPanicsDoesNotTakeTheAuditDown(t *testing.T) {
	gw, clock := newTestGateway(t, func(c *Config) {
		c.Events = func(Event) { panic("a sink that fails") }
	})
	issueForTest(t, gw, clock)
	gw.emit(gw.event(EventTunnelOpened, "", "", "", ""))
	if _, err := gw.NewPairing(PairingOptions{}); err != nil {
		t.Fatalf("the audit stopped working after its sink panicked: %v", err)
	}
}
