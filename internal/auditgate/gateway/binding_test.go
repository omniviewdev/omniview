package gateway_test

import (
	"bufio"
	"context"
	"crypto/tls"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

// pendingCall is a runtime call whose body has been sent only in part, as a
// client that paces its body, or a flaky link, leaves it.
type pendingCall struct {
	t    *testing.T
	conn *tls.Conn
	rest string
}

// startCall sends the headers and the first firstPart bytes of body.
func (b *browser) startCall(label, body string, firstPart int) *pendingCall {
	b.t.Helper()
	conn, err := b.dial(context.Background())
	if err != nil {
		b.t.Fatal(err)
	}
	tlsConn := tls.Client(conn, &tls.Config{RootCAs: b.h.pool, ServerName: serverName, MinVersion: tls.VersionTLS13})
	b.t.Cleanup(func() { _ = tlsConn.Close() })
	head := strings.Join([]string{
		"POST /wails/runtime HTTP/1.1",
		"Host: " + b.h.authority(),
		"Authorization: " + b.basic(),
		"Content-Type: application/json",
		"X-Wails-Client-Id: " + label,
		"Origin: " + b.origin(),
		"Sec-Fetch-Site: same-origin",
		"Content-Length: " + strconv.Itoa(len(body)),
		"Connection: close",
	}, "\r\n") + "\r\n\r\n"
	_ = tlsConn.SetDeadline(time.Now().Add(30 * time.Second))
	if _, err = io.WriteString(tlsConn, head+body[:firstPart]); err != nil {
		b.t.Fatal(err)
	}
	return &pendingCall{t: b.t, conn: tlsConn, rest: body[firstPart:]}
}

// finish sends the rest of the body and returns the status and body of the
// answer.
func (p *pendingCall) finish() (int, string) {
	p.t.Helper()
	if _, err := io.WriteString(p.conn, p.rest); err != nil {
		p.t.Fatal(err)
	}
	res, err := http.ReadResponse(bufio.NewReader(p.conn), nil)
	if err != nil {
		p.t.Fatalf("the answer to the call: %v", err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(data)
}

// endTunnel ends a page's tunnel the way a page can: any data frame on the
// events socket does.
func endTunnel(t *testing.T, s *socket) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.conn.Write(ctx, websocket.MessageText, []byte("x")); err != nil {
		t.Fatal(err)
	}
}

// TestACallWhoseTunnelEndsDuringItsBodyNeverReachesTheUpstream is the case a
// binding checked once, before the body, got wrong: the body takes its time, the
// page's events socket ends meanwhile, the host forgets the issued client ID,
// and the finished call would run as the host's first window.
func TestACallWhoseTunnelEndsDuringItsBodyNeverReachesTheUpstream(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	s := mustOpen(t, b, "page")
	eventually(t, 5*time.Second, "the host to map the page", func() bool { return len(h.up.clientIDs()) == 1 })
	body := callBody("c1", instanceInfo, "")
	call := b.startCall("page", body, len(body)/2)
	eventually(t, 5*time.Second, "the call to be admitted", func() bool { return h.gw.Status().InFlight == 1 })

	endTunnel(t, s)
	eventually(t, 5*time.Second, "the tunnel and the host's mapping to be gone", func() bool {
		return h.gw.Status().Tunnels == 0 && len(h.up.clientIDs()) == 0
	})
	status, answer := call.finish()
	deniedWith(t, "a call finished after its tunnel ended", status, answer, "client_unbound")
	if n := len(h.up.runtimeRecords()); n != 0 || h.up.callsAsMain() != 0 {
		t.Fatalf("the host saw %d calls (%d as its first window): the call must never reach it", n, h.up.callsAsMain())
	}
}

// TestACallFinishedAfterItsPageReconnectedRunsOnTheNewSocket covers the same gap
// when the page opens a new socket under the same client ID: the call belongs to
// the page's current socket, and must not run on the old one's forgotten ID.
func TestACallFinishedAfterItsPageReconnectedRunsOnTheNewSocket(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Timeouts.BindWait = 2 * time.Second })
	b := h.browser(laptop, h.pair())
	first := mustOpen(t, b, "page")
	body := callBody("c1", instanceInfo, "")
	call := b.startCall("page", body, len(body)/2)
	eventually(t, 5*time.Second, "the call to be admitted", func() bool { return h.gw.Status().InFlight == 1 })

	second := mustOpen(t, b, "page")
	first.expectClosed(t, 5*time.Second)
	status, answer := call.finish()
	if status != http.StatusOK {
		t.Fatalf("the call = %d %q, want it served on the new socket", status, answer)
	}
	records := h.up.runtimeRecords()
	if len(records) != 1 || !strings.HasPrefix(records[0].Window, "browser-") || h.up.callsAsMain() != 0 {
		t.Fatalf("records %+v: the call must run as the new socket's browser window", records)
	}
	if ids := h.up.clientIDs(); len(ids) != 1 || records[0].Header.Get("X-Wails-Client-Id") != ids[0] {
		t.Fatalf("the call used %q, the host knows %v", records[0].Header.Get("X-Wails-Client-Id"), ids)
	}
	_ = second
}

// TestAnAdmittedCallEndsWithItsTunnelAndNeverRunsAsMain holds a call at the
// host, ends the page's tunnel, and checks what the page, the host and the
// bookkeeping see.
func TestAnAdmittedCallEndsWithItsTunnelAndNeverRunsAsMain(t *testing.T) {
	h := newHarness(t)
	h.up.blockCalls.Store(true)
	b := h.browser(laptop, h.pair())
	s := mustOpen(t, b, "page")
	answered := make(chan response, 1)
	go func() { answered <- b.call("page", callBody("c1", instanceInfo, "")) }()
	select {
	case <-h.up.callStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("the call never reached the host")
	}

	endTunnel(t, s)
	eventually(t, 5*time.Second, "the host to see the call canceled", func() bool {
		return len(h.up.callsCanceledAt()) == 1
	})
	select {
	case res := <-answered:
		deniedWith(t, "a call whose tunnel ended under it", res.status, res.body, "client_unbound")
	case <-time.After(5 * time.Second):
		t.Fatal("the page never got an answer")
	}
	eventually(t, 5*time.Second, "the tunnel to close", func() bool { return h.gw.Status().Tunnels == 0 })
	if h.up.callsAsMain() != 0 {
		t.Fatal("a call ran as the host's first window")
	}
}

func TestRevokeCancelsAHeldCallAndItNeverRunsAsMain(t *testing.T) {
	h := newHarness(t)
	h.up.blockCalls.Store(true)
	good := h.pair()
	b := h.browser(laptop, good)
	mustOpen(t, b, "page")
	failed := make(chan error, 1)
	go func() {
		_, err := b.sendErr(request{
			method: http.MethodPost, path: "/wails/runtime", header: runtimeHeader(b, "page"),
			body: callBody("c1", instanceInfo, ""),
		})
		failed <- err
	}()
	select {
	case <-h.up.callStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("the call never reached the host")
	}
	if err := h.gw.Revoke(t.Context(), good.info.ID); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	if err := <-failed; err == nil {
		t.Fatal("the call of a revoked credential was answered")
	}
	eventually(t, 5*time.Second, "the host to see the call canceled", func() bool {
		return len(h.up.callsCanceledAt()) == 1
	})
	if h.up.callsAsMain() != 0 {
		t.Fatal("a call ran as the host's first window")
	}
}

// TestTheFirstCallWaitsForTheHostsMapping has the host register the issued
// client ID late, after its 101, as the real one does. The tunnel is not usable
// until the host has mapped the ID, so the first call runs as the page's window.
func TestTheFirstCallWaitsForTheHostsMapping(t *testing.T) {
	h := newHarness(t)
	h.up.mappingDelay.Store(int64(150 * time.Millisecond))
	b := h.browser(laptop, h.pair())
	mustOpen(t, b, "page")
	res := b.call("page", callBody("c1", instanceInfo, ""))
	if res.status != http.StatusOK {
		t.Fatalf("the first call = %d %q", res.status, res.body)
	}
	records := h.up.runtimeRecords()
	if len(records) != 1 || !strings.HasPrefix(records[0].Window, "browser-") {
		t.Fatalf("records %+v: the first call must run as the page's browser window", records)
	}
	if h.up.callsAsMain() != 0 {
		t.Fatal("a call ran as the host's first window")
	}
	// The probe retried until the host knew the ID, and a probe is not a call.
	if h.up.probeCount() < 2 {
		t.Fatalf("%d probes: the tunnel did not wait for the mapping", h.up.probeCount())
	}
}

func TestAHostThatNeverMapsTheIDLeavesNoTunnelAndCostsNoBudget(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Timeouts.MappingWait = 200 * time.Millisecond
		c.Limits.MaxEventSocketOpens = 1
	})
	h.up.mappingDelay.Store(int64(700 * time.Millisecond))
	b := h.browser(laptop, h.pair())
	s, err := b.openEvents("page", false)
	if err == nil {
		_ = s.conn.CloseNow()
		t.Fatal("a tunnel opened although the host never mapped its client ID")
	}
	if status, body := refusalOf(s); status != http.StatusBadGateway || !strings.Contains(body, "audit_unavailable") {
		t.Fatalf("answer = %d %q, want a fixed 502", status, body)
	}
	if got := h.gw.Status(); got.Tunnels != 0 || got.EventSocketOpens != 0 {
		t.Fatalf("status %+v: a tunnel that never opened must cost nothing", got)
	}
	// The socket the gateway opened to the host for the refused page is
	// closed, not left behind.
	// The host only sees the socket once its mapping delay has passed; it must
	// then find it already closed, and not left open.
	eventually(t, 10*time.Second, "the host to find the abandoned socket closed", func() bool {
		return h.up.windowsOpened() >= 1 && len(h.up.openSockets()) == 0
	})
	// With the host mapping at once the same budget of one still serves a page.
	h.up.mappingDelay.Store(0)
	mustOpen(t, b, "page")
}

func TestTheMappingProbeIsNotAPageCall(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	mustOpen(t, b, "page")
	if h.up.probeCount() != 1 {
		t.Fatalf("probes = %d, want exactly one for a host that maps at once", h.up.probeCount())
	}
	if n := len(h.up.runtimeRecords()); n != 0 {
		t.Fatalf("the probe was recorded as %d page calls", n)
	}
	probe := h.up.headerFor("/wails/runtime")
	for _, name := range []string{"Authorization", "Cookie", "X-Wails-Window-Name", "X-Wails-Window-Id"} {
		if probe.Get(name) != "" {
			t.Errorf("the probe carried %s", name)
		}
	}
	if probe.Get("X-Wails-Client-Id") == "" || probe.Get("X-Wails-Client-Id") == "page" {
		t.Errorf("the probe carried client ID %q, want the issued one", probe.Get("X-Wails-Client-Id"))
	}
}

func TestOnlyABoundedNumberOfCallsWaitForTheirSocket(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Timeouts.BindWait = time.Second
		c.Limits.MaxBindWaiters = 2
	})
	b := h.browser(laptop, h.pair())
	good := callBody("c1", instanceInfo, "")

	type outcome struct {
		after  time.Duration
		status int
	}
	results := make(chan outcome, 3)
	var started sync.WaitGroup
	for range 3 {
		started.Add(1)
		go func() {
			started.Done()
			begin := time.Now()
			res := b.call("nobody", good)
			results <- outcome{after: time.Since(begin), status: res.status}
		}()
	}
	started.Wait()
	var quick, slow int
	for range 3 {
		got := <-results
		if got.status != http.StatusForbidden {
			t.Fatalf("a call without a socket = %d, want 403", got.status)
		}
		if got.after < 500*time.Millisecond {
			quick++
		} else {
			slow++
		}
	}
	if quick != 1 || slow != 2 {
		t.Fatalf("%d calls answered at once and %d after the wait; want 1 and 2 with two places to wait", quick, slow)
	}
}

// A call sent while the host is still mapping the tunnel's client ID finds the
// tunnel bound but not ready, and waits for it. Let through, it would reach the
// host before the host knew the ID and run as its first window.
func TestACallSentWhileTheHostIsStillMappingWaitsForTheTunnelToBeReady(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Timeouts.BindWait = 2 * time.Second })
	h.up.mappingDelay.Store(int64(400 * time.Millisecond))
	b := h.browser(laptop, h.pair())
	opened := make(chan *socket, 1)
	go func() {
		s, err := b.openEvents("page", false)
		if err != nil {
			s = nil
		}
		opened <- s
	}()
	time.Sleep(100 * time.Millisecond)
	res := b.call("page", callBody("c1", instanceInfo, ""))
	if res.status != http.StatusOK {
		t.Fatalf("the call = %d %q", res.status, res.body)
	}
	records := h.up.runtimeRecords()
	if len(records) != 1 || !strings.HasPrefix(records[0].Window, "browser-") {
		t.Fatalf("records %+v: the call must run as the page's browser window", records)
	}
	if h.up.callsAsMain() != 0 {
		t.Fatal("a call ran as the host's first window")
	}
	if h.up.probeCount() < 2 {
		t.Fatalf("%d probes: the host had not yet mapped the ID when the tunnel was first probed", h.up.probeCount())
	}
	s := <-opened
	if s == nil {
		t.Fatal("the tunnel did not open")
	}
	t.Cleanup(func() { _ = s.conn.CloseNow() })
}

// A call holds its tunnel from the moment it is dispatched until it returns,
// which is what keeps the host's socket open for it.
func TestACallHoldsItsTunnelFromDispatchUntilItReturns(t *testing.T) {
	h := newHarness(t)
	h.up.blockCalls.Store(true)
	cred := h.pair()
	b := h.browser(laptop, cred)
	s := mustOpen(t, b, "page")
	answered := make(chan response, 1)
	go func() { answered <- b.call("page", callBody("c1", instanceInfo, "")) }()
	select {
	case <-h.up.callStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("the call never reached the host")
	}
	if held := h.gw.HeldCalls(cred.info.ID, "page"); held != 1 {
		t.Fatalf("%d holds while the call is in flight, want 1", held)
	}
	endTunnel(t, s)
	select {
	case <-answered:
	case <-time.After(10 * time.Second):
		t.Fatal("the call did not return after its tunnel ended")
	}
	waitTunnelClosed(t, h, "unexpected_frame")
}

// The host's socket outlives the last call by CallSettle, but only for a tunnel
// that served one.
func TestATunnelThatServedCallsSettlesBeforeClosingTheHostSocket(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Timeouts.CallSettle = time.Second
		c.Timeouts.CloseGrace = 200 * time.Millisecond
	})
	b := h.browser(laptop, h.pair())
	idle := mustOpen(t, b, "idle")
	busy := mustOpen(t, b, "busy")
	if res := b.call("busy", callBody("c1", instanceInfo, "")); res.status != http.StatusOK {
		t.Fatalf("the call = %d %q", res.status, res.body)
	}
	closing := func(s *socket) time.Duration {
		begin := time.Now()
		endTunnel(t, s)
		s.expectClosed(t, 15*time.Second)
		return time.Since(begin)
	}
	idleTook, busyTook := closing(idle), closing(busy)
	if busyTook < 900*time.Millisecond {
		t.Fatalf("a tunnel that served a call closed after %v, before the settle", busyTook)
	}
	if idleTook+500*time.Millisecond > busyTook {
		t.Fatalf("a tunnel that served no call closed after %v, as slowly as one that did (%v)", idleTook, busyTook)
	}
}
