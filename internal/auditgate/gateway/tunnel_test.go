package gateway_test

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

// fillsAnyBuffer is how many 64 KiB messages it takes to fill every buffer
// between the gateway and a page that reads nothing: 64 MiB, against the few
// MiB that each direction of a loopback connection can hold on any system the
// tests run on. The tests that depend on a write blocking send this many; a
// smaller flood passes or fails with the machine's socket buffer tuning.
const fillsAnyBuffer = 1024

// mustOpenNoRead opens a page's events socket that never reads it.
func mustOpenNoRead(t *testing.T, b *browser, label string) *socket {
	t.Helper()
	s, err := b.openEventsNoRead(label)
	if err != nil {
		t.Fatalf("open events socket %q: %v", label, err)
	}
	t.Cleanup(func() { _ = s.conn.CloseNow() })
	return s
}

func tunnelClosedWith(h *harness, code string) bool {
	return slices.Contains(closedCodes(h), code)
}

// closedCodes are the causes of the tunnels that have closed so far.
func closedCodes(h *harness) []string {
	var codes []string
	for _, event := range h.events.all() {
		if event.Kind == gateway.EventTunnelClosed {
			codes = append(codes, event.Code)
		}
	}
	return codes
}

func waitTunnelClosed(t *testing.T, h *harness, code string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !tunnelClosedWith(h, code) {
		if time.Now().After(deadline) {
			t.Fatalf("no tunnel closed with %s; tunnels closed with %v, %d still open",
				code, closedCodes(h), h.gw.Status().Tunnels)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// pairFor issues a credential that lasts ttl.
func (h *harness) pairFor(ttl time.Duration) credential {
	h.t.Helper()
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		h.t.Fatalf("NewPairing: %v", err)
	}
	channel := &memoryChannel{}
	info, err := h.gw.Exchange(context.Background(), offer.Code, channel, gateway.ExchangeOptions{CredentialTTL: ttl})
	if err != nil {
		h.t.Fatalf("Exchange: %v", err)
	}
	return credential{info: info, username: info.Username, secret: channel.secret}
}

// TestAPageThatReadsNothingCannotMakeTheHostQueueEvents sends the gateway far
// more than fits in the kernel buffers toward a page that never reads. The host
// queues events for each socket without a bound, so the one thing that must
// not happen is the gateway ceasing to read the host: every write the host
// makes has to go through, and the page is cut off instead.
func TestAPageThatReadsNothingCannotMakeTheHostQueueEvents(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.TunnelQueueBytes = 1 << 20
		c.Timeouts.TunnelWrite = time.Minute // not the bound under test
	})
	b := h.browser(laptop, h.pair())
	mustOpenNoRead(t, b, "page")
	eventually(t, 5*time.Second, "the host to map the page", func() bool { return len(h.up.clientIDs()) == 1 })

	if err := h.up.flood(allowedEvent, fillsAnyBuffer, 64<<10, 5*time.Second, 0); err != nil {
		t.Fatalf("a write of the host stalled, so the gateway stopped reading it: %v", err)
	}
	waitTunnelClosed(t, h, "slow_client")
	eventually(t, 5*time.Second, "the tunnel to be gone", func() bool { return h.gw.Status().Tunnels == 0 })
}

// TestATrickleReaderIsCutByTheLagBudget is the slow reader that a per-write
// deadline never catches: it takes one message after another, each well within
// any write deadline, while the host sends faster than it reads.
func TestATrickleReaderIsCutByTheLagBudget(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Timeouts.TunnelLag = 300 * time.Millisecond
		c.Timeouts.TunnelWrite = time.Minute // not the bound under test
		c.Limits.TunnelQueueBytes = 1 << 30
		c.Limits.TunnelQueueMessages = 1 << 20
	})
	b := h.browser(laptop, h.pair())
	s := mustOpenNoRead(t, b, "page")
	eventually(t, 5*time.Second, "the host to map the page", func() bool { return len(h.up.clientIDs()) == 1 })

	stop := make(chan struct{})
	var reading sync.WaitGroup
	reading.Add(1)
	go func() {
		defer reading.Done()
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_, _, err := s.conn.Read(ctx)
			cancel()
			if err != nil {
				return
			}
			select {
			case <-stop:
				return
			case <-time.After(40 * time.Millisecond):
			}
		}
	}()
	defer func() { close(stop); reading.Wait() }()

	if err := h.up.flood(allowedEvent, 600, 256<<10, 5*time.Second, 5*time.Millisecond); err != nil {
		t.Fatalf("a write of the host stalled, so the gateway stopped reading it: %v", err)
	}
	waitTunnelClosed(t, h, "slow_client")
}

// TestAWriteThatTakesTooLongCutsThePage has nothing but TunnelWrite to go by:
// the queue is effectively unbounded and the lag budget is an hour.
func TestAWriteThatTakesTooLongCutsThePage(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Timeouts.TunnelWrite = 300 * time.Millisecond
		c.Timeouts.TunnelLag = time.Hour
		c.Limits.TunnelQueueBytes = 1 << 30
		c.Limits.TunnelQueueMessages = 1 << 20
	})
	b := h.browser(laptop, h.pair())
	mustOpenNoRead(t, b, "page")
	eventually(t, 5*time.Second, "the host to map the page", func() bool { return len(h.up.clientIDs()) == 1 })

	if err := h.up.flood(allowedEvent, fillsAnyBuffer, 64<<10, 5*time.Second, 0); err != nil {
		t.Fatalf("a write of the host stalled: %v", err)
	}
	waitTunnelClosed(t, h, "slow_client")
}

// TestEventsTheFilterDropsNeverTakeQueueSpace sends a page that reads nothing a
// flood of events it may not have. They are dropped before they are queued, so
// nothing waits for the page and nothing cuts it off.
func TestEventsTheFilterDropsNeverTakeQueueSpace(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.TunnelQueueBytes = 1 << 20
		c.Timeouts.TunnelWrite = time.Minute
	})
	b := h.browser(laptop, h.pair())
	mustOpenNoRead(t, b, "page")
	eventually(t, 5*time.Second, "the host to map the page", func() bool { return len(h.up.clientIDs()) == 1 })

	if err := h.up.flood("core/exec/stream/abc", 256, 64<<10, 5*time.Second, 0); err != nil {
		t.Fatalf("a write of the host stalled: %v", err)
	}
	eventually(t, 10*time.Second, "the gateway to have read the flood", func() bool {
		return h.gw.Status().EventsDropped == 256
	})
	if h.gw.Status().Tunnels != 1 || tunnelClosedWith(h, "slow_client") {
		t.Fatal("a page was cut off for events that were never going to be sent to it")
	}
	if h.gw.Status().EventsForwarded != 0 {
		t.Fatal("a denied event was forwarded")
	}
}

func TestAPageThatNeverAnswersPingsIsCut(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Timeouts.TunnelPing = 100 * time.Millisecond
		c.Timeouts.TunnelPong = 100 * time.Millisecond
		c.Timeouts.CloseGrace = 200 * time.Millisecond
	})
	b := h.browser(laptop, h.pair())
	mustOpenNoRead(t, b, "page") // a page that reads nothing answers no ping
	waitTunnelClosed(t, h, "ping_timeout")
	eventually(t, 5*time.Second, "the tunnel to be gone", func() bool { return h.gw.Status().Tunnels == 0 })
}

func TestAHostThatClosesItsEventsSocketEndsTheTunnel(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	s := mustOpen(t, b, "page")
	eventually(t, 5*time.Second, "the host to map the page", func() bool { return len(h.up.clientIDs()) == 1 })

	h.up.closeEventSockets()
	waitTunnelClosed(t, h, "upstream_gone")
	s.expectClosed(t, 5*time.Second)
	if status := s.closeStatus(); status != websocket.StatusGoingAway {
		t.Fatalf("close status = %d, want going away", status)
	}
	// With no socket the page has no binding, and nothing reaches the host.
	res := b.call("page", callBody("c1", instanceInfo, ""))
	deniedWith(t, "a call after the host closed the socket", res.status, res.body, "client_unbound")
	if len(h.up.runtimeRecords()) != 0 {
		t.Fatal("a call reached the host after its socket was gone")
	}
}

// TestTheCloseStatusTellsThePageOnlyWhatItNeedsToKnow checks the status the
// page sees for each way a tunnel can end that the page can see.
func TestTheCloseStatusTellsThePageOnlyWhatItNeedsToKnow(t *testing.T) {
	cases := []struct {
		name   string
		status websocket.StatusCode
		code   string
		end    func(t *testing.T, h *harness, b *browser, cred credential, s *socket)
	}{
		{"credential revoked", websocket.StatusPolicyViolation, "credential_revoked",
			func(t *testing.T, h *harness, _ *browser, cred credential, _ *socket) {
				if err := h.gw.Revoke(t.Context(), cred.info.ID); err != nil {
					t.Fatal(err)
				}
			}},
		{"the peer is no longer the owner", websocket.StatusPolicyViolation, "peer_changed",
			func(_ *testing.T, h *harness, _ *browser, _ credential, _ *socket) {
				h.peers.setAll(gateway.Peer{UserID: otherUserID, NodeID: laptop.NodeID}, nil)
			}},
		{"the page sent data", websocket.StatusPolicyViolation, "unexpected_frame",
			func(t *testing.T, _ *harness, _ *browser, _ credential, s *socket) { endTunnel(t, s) }},
		{"the audit stopped", websocket.StatusGoingAway, "audit_ended",
			func(t *testing.T, h *harness, _ *browser, _ credential, _ *socket) {
				if err := h.gw.Stop(t.Context()); err != nil {
					t.Fatal(err)
				}
			}},
		{"the host closed its socket", websocket.StatusGoingAway, "upstream_gone",
			func(_ *testing.T, h *harness, _ *browser, _ credential, _ *socket) { h.up.closeEventSockets() }},
		{"the page reconnected", websocket.StatusGoingAway, "replaced",
			func(t *testing.T, _ *harness, b *browser, _ credential, _ *socket) { mustOpen(t, b, "page") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t)
			cred := h.pair()
			b := h.browser(laptop, cred)
			s := mustOpen(t, b, "page")
			eventually(t, 5*time.Second, "the host to map the page", func() bool { return len(h.up.clientIDs()) == 1 })
			tc.end(t, h, b, cred, s)
			s.expectClosed(t, 5*time.Second)
			if got := s.closeStatus(); got != tc.status {
				t.Fatalf("close status = %d, want %d", got, tc.status)
			}
			waitTunnelClosed(t, h, tc.code)
		})
	}

	t.Run("the credential expired", func(t *testing.T) {
		h := newHarness(t)
		cred := h.pairFor(5 * time.Minute)
		b := h.browser(laptop, cred)
		s := mustOpen(t, b, "page")
		h.clock.Advance(6 * time.Minute)
		s.expectClosed(t, 5*time.Second)
		if got := s.closeStatus(); got != websocket.StatusPolicyViolation {
			t.Fatalf("close status = %d, want policy violation", got)
		}
		waitTunnelClosed(t, h, "credential_expired")
	})
}

// A revoke must not wait for the WebSocket library's own five second timeouts,
// whatever the other side is doing. CloseGrace is 200ms here and each test
// requires far less than the library's 5s, so a regression to the library's
// timing cannot pass by luck.
func TestARevokeDoesNotWaitForAHostThatNeverAnswersTheClose(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Timeouts.CloseGrace = 200 * time.Millisecond })
	h.up.stallEvents.Store(true)
	good := h.pair()
	b := h.browser(laptop, good)
	mustOpen(t, b, "page")

	begin := time.Now()
	if err := h.gw.Revoke(t.Context(), good.info.ID); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	if took := time.Since(begin); took > 2*time.Second {
		t.Fatalf("Revoke took %v with a host that never answers a close: the close grace was not applied", took)
	}
	if h.gw.Status().Tunnels != 0 {
		t.Fatal("the tunnel is still open")
	}
}

func TestARevokeDoesNotWaitForAWriteToAPageThatStoppedReading(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Timeouts.CloseGrace = 200 * time.Millisecond
		c.Timeouts.TunnelWrite = time.Minute
		c.Limits.TunnelQueueBytes = 1 << 30
		c.Limits.TunnelQueueMessages = 1 << 20
	})
	good := h.pair()
	b := h.browser(laptop, good)
	mustOpenNoRead(t, b, "page")
	eventually(t, 5*time.Second, "the host to map the page", func() bool { return len(h.up.clientIDs()) == 1 })
	// Enough to fill every buffer between the gateway and the page, so that the
	// gateway's writer is stuck in a write that nothing but a cut can end.
	if err := h.up.flood(allowedEvent, fillsAnyBuffer, 64<<10, 5*time.Second, 0); err != nil {
		t.Fatalf("a write of the host stalled: %v", err)
	}
	eventually(t, 5*time.Second, "the writer to stall", func() bool {
		status := h.gw.Status()
		time.Sleep(100 * time.Millisecond)
		return h.gw.Status().EventsForwarded == status.EventsForwarded && status.EventsForwarded > 0
	})

	begin := time.Now()
	if err := h.gw.Revoke(t.Context(), good.info.ID); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	if took := time.Since(begin); took > 2*time.Second {
		t.Fatalf("Revoke took %v with its writer stuck in a write to the page", took)
	}
	if h.gw.Status().Tunnels != 0 {
		t.Fatal("the tunnel is still open")
	}
}

// A response that is blocked on a client that stopped reading is interrupted by
// the revoke, instead of holding its place until its write deadline.
func TestARevokeInterruptsAResponseBlockedOnAClientThatStoppedReading(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.MaxStaticResponseBytes = 1 << 30
		c.Timeouts.Static = time.Minute
	})
	h.up.hugeSize = 256 << 20
	good := h.pair()
	b := h.browser(laptop, good)
	conn, err := b.dial(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	tlsConn := b.tlsOver(conn)
	t.Cleanup(func() { _ = tlsConn.Close() })
	if _, err = tlsConn.Write([]byte(b.rawRequest("GET", "/assets/stream.js"))); err != nil {
		t.Fatal(err)
	}
	// The client reads nothing, so the response stalls in the gateway's write.
	eventually(t, 10*time.Second, "the request to be in flight", func() bool { return h.gw.Status().InFlight == 1 })
	h.up.waitHugeStalled(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err = h.gw.Revoke(ctx, good.info.ID); err != nil {
		t.Fatalf("Revoke = %v: the blocked write was not interrupted", err)
	}
	if got := h.gw.Status().InFlight; got != 0 {
		t.Fatalf("%d requests still in flight", got)
	}
}

func TestAnAuthenticatedRequestOverTheInFlightLimitIsAnsweredBusy(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Limits.MaxInFlight = 1 })
	b := h.browser(laptop, h.pair())
	held := make(chan error, 1)
	go func() {
		_, err := h.browser(laptop, b.cred).sendErr(request{path: "/assets/slow.js"})
		held <- err
	}()
	select {
	case <-h.up.slowStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("the first request never reached the host")
	}
	res := b.get("/assets/app.js")
	if res.status != http.StatusServiceUnavailable || !strings.Contains(res.body, `"code":"audit_unavailable"`) ||
		!strings.Contains(res.body, `"reason":"busy"`) {
		t.Fatalf("request over the limit = %d %q, want a fixed 503 busy", res.status, res.body)
	}
	if h.gw.Status().Denials[gateway.DenialCapacity] != 1 {
		t.Fatalf("denials %v, want one capacity denial", h.gw.Status().Denials)
	}
	if err := h.gw.Stop(t.Context()); err != nil {
		t.Fatal(err)
	}
	<-held
}

// A call that has returned no longer holds its tunnel, so the tunnel does not
// wait out CallDrain for it when it ends. CallDrain is long here: a hold that
// is never given back would keep the tunnel open for all of it.
func TestFinishedCallsDoNotKeepATunnelOpen(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Timeouts.CallDrain = time.Minute
		c.Timeouts.CloseGrace = 200 * time.Millisecond
	})
	b := h.browser(laptop, h.pair())
	s := mustOpen(t, b, "page")
	for i := range 3 {
		res := b.call("page", callBody(fmt.Sprintf("c%d", i), instanceInfo, ""))
		if res.status != http.StatusOK {
			t.Fatalf("call %d = %d %q", i, res.status, res.body)
		}
	}
	endTunnel(t, s)
	waitTunnelClosed(t, h, "unexpected_frame")
}
