package gateway_test

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/omniviewdev/omniview/internal/auditgate"
	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

const allowedEvent = "plugin/state_change"

// refusalOf reads the status and body out of a refused upgrade.
func refusalOf(s *socket) (int, string) {
	if s == nil || s.resp == nil {
		return 0, ""
	}
	data, _ := io.ReadAll(s.resp.Body)
	return s.resp.StatusCode, string(data)
}

func TestEventsSocketNeedsAValidCredentialToUpgrade(t *testing.T) {
	h := newHarness(t)
	good := h.pair()
	b := h.browser(laptop, good)

	s, err := b.openEvents("page", true)
	if err == nil {
		_ = s.conn.CloseNow()
		t.Fatal("an anonymous upgrade succeeded")
	}
	if status, body := refusalOf(s); status != http.StatusUnauthorized || !strings.Contains(body, "audit_unauthorized") {
		t.Fatalf("anonymous upgrade = %d %q, want the uniform 401", status, body)
	}

	wrong := h.browser(laptop, credential{username: good.username, secret: strings.Repeat("C", 43)})
	if s, err = wrong.openEvents("page", false); err == nil {
		_ = s.conn.CloseNow()
		t.Fatal("an upgrade with a wrong secret succeeded")
	}

	stranger := h.browser(gateway.Peer{UserID: otherUserID, NodeID: "node-x"}, good)
	if s, err = stranger.openEvents("page", false); err == nil {
		_ = s.conn.CloseNow()
		t.Fatal("an upgrade from another user's node succeeded")
	}
	if h.up.Hits() != 0 || h.up.windowsOpened() != 0 {
		t.Fatalf("refused upgrades reached the upstream: %d hits, %d windows", h.up.Hits(), h.up.windowsOpened())
	}
}

func TestEventsUpgradeShapeAndContextAreChecked(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	origin := "Origin: " + b.origin()
	upgrade := []string{"Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Version: 13", "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=="}
	with := func(target string, extra ...string) string {
		return b.rawRequest("GET", target, append(append([]string{}, extra...), upgrade...)...)
	}
	without := func(prefix string) []string {
		var kept []string
		for _, line := range upgrade {
			if !strings.HasPrefix(line, prefix) {
				kept = append(kept, line)
			}
		}
		return kept
	}

	cases := []struct {
		name, request, reason string
	}{
		{"no origin", with("/wails/events?clientId=page"), "origin"},
		{"another origin", with("/wails/events?clientId=page", "Origin: https://evil.example"), "origin"},
		{"cross-site fetch", with("/wails/events?clientId=page", origin, "Sec-Fetch-Site: cross-site"), "fetch_metadata"},
		{"no client ID", with("/wails/events", origin), "client_id"},
		{"empty client ID", with("/wails/events?clientId=", origin), "client_id"},
		{"invalid client ID", with("/wails/events?clientId=a.b", origin), "client_id"},
		{"long client ID", with("/wails/events?clientId="+strings.Repeat("a", 65), origin), "client_id"},
		{"extra parameter", with("/wails/events?clientId=page&x=1", origin), "client_id"},
		{"repeated client ID", with("/wails/events?clientId=page&clientId=other", origin), "client_id"},
		{"other parameter name", with("/wails/events?clientid=page", origin), "client_id"},
		{"encoded client ID", with("/wails/events?clientId=%70age", origin), "client_id"},
		{"old protocol version", b.rawRequest("GET", "/wails/events?clientId=page",
			append(without("Sec-WebSocket-Version"), origin, "Sec-WebSocket-Version: 8")...), "upgrade_invalid"},
		{"no key", b.rawRequest("GET", "/wails/events?clientId=page", append(without("Sec-WebSocket-Key"), origin)...), "upgrade_invalid"},
		{"short key", b.rawRequest("GET", "/wails/events?clientId=page",
			append(without("Sec-WebSocket-Key"), origin, "Sec-WebSocket-Key: c2hvcnQ=")...), "upgrade_invalid"},
		{"no upgrade header", b.rawRequest("GET", "/wails/events?clientId=page", origin, "Sec-WebSocket-Version: 13"), "upgrade_invalid"},
		{"POST", b.rawRequest("POST", "/wails/events?clientId=page", append(upgrade, origin)...), "http_method_not_allowed"},
	}
	for _, tc := range cases {
		status, _, body := b.raw(tc.request)
		deniedWith(t, tc.name, status, body, tc.reason)
	}
	if h.up.Hits() != 0 {
		t.Fatalf("refused upgrades reached the upstream (%d hits)", h.up.Hits())
	}
}

func TestEventsAreFilteredMessageByMessage(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	s := mustOpen(t, b, "page")
	eventually(t, 5*time.Second, "the upstream socket", func() bool { return len(h.up.clientIDs()) == 1 })

	dropped := [][]byte{
		event("core/exec/stream/abc", "terminal output"),
		event("core/exec/signal/abc", "signal"),
		event("mcp/confirmation/requested", "approve?"),
		event("action/stream/x", "log"),
		event("totally/unlisted", "unknown name"),
		[]byte(`not json at all`),
		[]byte(`{"name":"plugin/state_change","name":"mcp/x","data":1}`),
		[]byte(`{"name":"plugin/state_change","data":1,"extra":true}`),
		[]byte(`{"name":7,"data":1}`),
	}
	for _, frame := range dropped {
		h.up.broadcast(websocket.MessageText, frame)
	}
	h.up.broadcast(websocket.MessageBinary, event(allowedEvent, "binary"))
	want := event(allowedEvent, map[string]any{"state": "ready"})
	h.up.broadcast(websocket.MessageText, want)

	kind, got, err := s.read(t, 5*time.Second)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if kind != websocket.MessageText || !bytes.Equal(got, want) {
		t.Fatalf("the first message through was %q (%v), want the allowed event %q", got, kind, want)
	}
	// The counts move after the page has the message, so wait for them.
	eventually(t, 5*time.Second, "the filter counts", func() bool {
		status := h.gw.Status()
		return status.EventsForwarded == 1 && status.EventsDropped == uint64(len(dropped)+1)
	})
}

func TestLargeEventsAreReassembledAndOversizedOnesDropped(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	s := mustOpen(t, b, "page")
	eventually(t, 5*time.Second, "the upstream socket", func() bool { return len(h.up.clientIDs()) == 1 })

	// Far past the WebSocket library's default 32 KiB limit, so it travels as
	// many frames and must be reassembled before it is judged.
	large := event(allowedEvent, strings.Repeat("x", 300<<10))
	h.up.broadcast(websocket.MessageText, large)
	_, got, err := s.read(t, 10*time.Second)
	if err != nil || !bytes.Equal(got, large) {
		t.Fatalf("a %d byte event arrived as %d bytes, err %v", len(large), len(got), err)
	}

	// Past the cap: dropped without closing the tunnel or the upstream socket.
	huge := event(allowedEvent, strings.Repeat("y", auditgate.MaxEventMessageBytes))
	h.up.broadcast(websocket.MessageText, huge)
	after := event(allowedEvent, "still here")
	h.up.broadcast(websocket.MessageText, after)
	_, got, err = s.read(t, 30*time.Second)
	if err != nil || !bytes.Equal(got, after) {
		t.Fatalf("after an oversized event the next message was %d bytes (err %v), want the small one", len(got), err)
	}
	if h.up.windowsOpened() != 1 || h.gw.Status().Tunnels != 1 {
		t.Fatal("the oversized event cost a socket")
	}
}

func TestEventsSocketsAreBoundToIssuedClientIDs(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	mustOpen(t, b, "page-one")
	eventually(t, 5*time.Second, "the upstream socket", func() bool { return len(h.up.clientIDs()) == 1 })
	ids := h.up.clientIDs()
	if ids[0] == "page-one" || len(ids[0]) != 22 || !auditgate.ValidClientID(ids[0]) {
		t.Fatalf("the upstream registered %q: the page's own ID, or not a gateway-issued one", ids[0])
	}
	// Each socket gets its own.
	mustOpen(t, b, "page-two")
	eventually(t, 5*time.Second, "the second upstream socket", func() bool { return len(h.up.clientIDs()) == 2 })
	if got := h.up.clientIDs(); got[0] == got[1] {
		t.Fatalf("two sockets share the upstream client ID %q", got[0])
	}
}

func TestEventsSocketsAreCappedPerCredentialAndPerAudit(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.MaxTunnels = 3
		c.Limits.TunnelOpenBurst = 100
	})
	a := h.browser(laptop, h.pair())
	c := h.browser(phone, h.pair())

	mustOpen(t, a, "a1")
	mustOpen(t, a, "a2")
	s, err := a.openEvents("a3", false)
	if err == nil {
		_ = s.conn.CloseNow()
		t.Fatal("a third socket for one credential was accepted")
	}
	if status, body := refusalOf(s); status != http.StatusServiceUnavailable || !strings.Contains(body, "tunnel_limit") {
		t.Fatalf("third socket = %d %q, want a fixed 503 tunnel_limit", status, body)
	}

	mustOpen(t, c, "c1")
	if s, err = c.openEvents("c2", false); err == nil {
		_ = s.conn.CloseNow()
		t.Fatal("a socket past the audit's cap was accepted")
	}
	if got := h.up.windowsOpened(); got != 3 {
		t.Fatalf("host windows opened = %d, want 3: a refused socket must not touch the upstream", got)
	}
}

func TestReconnectingWithTheSameClientIDReplacesTheOldSocket(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	first := mustOpen(t, b, "page")
	second := mustOpen(t, b, "page")
	first.expectClosed(t, 5*time.Second)

	eventually(t, 5*time.Second, "one tunnel to remain", func() bool { return h.gw.Status().Tunnels == 1 })
	// The replacement did not count toward the cap: a second page still fits.
	mustOpen(t, b, "other")

	h.up.broadcast(websocket.MessageText, event(allowedEvent, 1))
	if _, _, err := second.read(t, 5*time.Second); err != nil {
		t.Fatalf("the replacement socket is not live: %v", err)
	}
}

func TestReconnectChurnIsSlowedDown(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	opened := 0
	for range 3 {
		s := mustOpen(t, b, "page")
		opened++
		_ = s.conn.CloseNow()
		eventually(t, 5*time.Second, "the tunnel to close", func() bool { return h.gw.Status().Tunnels == 0 })
	}
	s, err := b.openEvents("page", false)
	if err == nil {
		_ = s.conn.CloseNow()
		t.Fatal("a fourth immediate reconnect was accepted")
	}
	status, body := refusalOf(s)
	if status != http.StatusTooManyRequests || !strings.Contains(body, "client_churn") {
		t.Fatalf("fourth reconnect = %d %q, want 429 client_churn", status, body)
	}
	if s.resp.Header.Get("Retry-After") == "" {
		t.Fatal("a slowed-down reconnect does not say when to retry")
	}
	if got := h.up.windowsOpened(); got != opened {
		t.Fatalf("host windows = %d after the refusal, want %d", got, opened)
	}

	h.clock.Advance(10 * time.Second)
	mustOpen(t, b, "page")
}

func TestAuditsHaveALifetimeBudgetOfUpstreamSockets(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.MaxEventSocketOpens = 2
		c.Limits.TunnelOpenBurst = 100
	})
	b := h.browser(laptop, h.pair())
	for range 2 {
		s := mustOpen(t, b, "page")
		_ = s.conn.CloseNow()
		eventually(t, 5*time.Second, "the tunnel to close", func() bool { return h.gw.Status().Tunnels == 0 })
	}
	s, err := b.openEvents("page", false)
	if err == nil {
		_ = s.conn.CloseNow()
		t.Fatal("a socket past the lifetime budget was accepted")
	}
	if status, body := refusalOf(s); status != http.StatusServiceUnavailable || !strings.Contains(body, "client_budget") {
		t.Fatalf("over budget = %d %q, want 503 client_budget", status, body)
	}
	if got := h.up.windowsOpened(); got != 2 {
		t.Fatalf("host windows = %d, want 2", got)
	}
}

func TestAnUpstreamThatCannotOpenASocketCostsNoBudget(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.MaxEventSocketOpens = 1
		c.Limits.TunnelOpenBurst = 100
	})
	b := h.browser(laptop, h.pair())
	h.up.failEvents.Store(true)
	s, err := b.openEvents("page", false)
	if err == nil {
		_ = s.conn.CloseNow()
		t.Fatal("the upgrade succeeded against an upstream that refuses")
	}
	if status, body := refusalOf(s); status != http.StatusBadGateway || !strings.Contains(body, "audit_unavailable") {
		t.Fatalf("upstream failure = %d %q, want a fixed 502", status, body)
	}
	h.up.failEvents.Store(false)
	mustOpen(t, b, "page")
}

func TestThePageSendingDataEndsTheTunnel(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	s := mustOpen(t, b, "page")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.conn.Write(ctx, websocket.MessageText, []byte("hello")); err != nil {
		t.Fatal(err)
	}
	s.expectClosed(t, 5*time.Second)
	eventually(t, 5*time.Second, "the tunnel to be gone", func() bool { return h.gw.Status().Tunnels == 0 })
}

func TestTunnelsEndWhenTheirPeerStopsBeingTheOwner(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	s := mustOpen(t, b, "page")
	h.peers.setAll(gateway.Peer{UserID: otherUserID, NodeID: laptop.NodeID}, nil)
	s.expectClosed(t, 5*time.Second)

	// Calls that were bound to it are gone with it.
	res := b.call("page", callBody("c1", instanceInfo, ""))
	if res.status == http.StatusOK {
		t.Fatal("a call ran after the tunnel's peer was no longer the owner")
	}
}

func TestUpgradeCostsNoUpstreamWorkWhenTheCredentialIsRefused(t *testing.T) {
	h := newHarness(t)
	good := h.pair()
	b := h.browser(laptop, good)
	if err := h.gw.Revoke(t.Context(), good.info.ID); err != nil {
		t.Fatal(err)
	}
	if s, err := b.openEvents("page", false); err == nil {
		_ = s.conn.CloseNow()
		t.Fatal("a revoked credential opened an events socket")
	}
	if h.up.windowsOpened() != 0 {
		t.Fatal("a refused upgrade created a host window")
	}
}

// TestCallsAreRefusedWhileATunnelIsStillClosing holds a tunnel in its close
// handshake with a client that never answers it. The binding exists until the
// tunnel is gone, but the moment the tunnel ends a call under its client ID
// must already be refused.
func TestCallsAreRefusedWhileATunnelIsStillClosing(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Timeouts.CloseGrace = 3 * time.Second })
	b := h.browser(laptop, h.pair())
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "wss://"+h.authority()+"/wails/events?clientId=page", &websocket.DialOptions{
		HTTPClient: b.client,
		HTTPHeader: http.Header{"Origin": {b.origin()}, "Authorization": {b.basic()}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	good := callBody("c1", instanceInfo, "")
	eventually(t, 5*time.Second, "the call to be served", func() bool { return b.call("page", good).status == http.StatusOK })

	// Nobody reads this socket, so it cannot answer the server's close frame.
	if err = conn.Write(ctx, websocket.MessageText, []byte("unexpected")); err != nil {
		t.Fatal(err)
	}
	eventually(t, 2*time.Second, "calls to be refused", func() bool {
		return b.call("page", good).status == http.StatusForbidden
	})
	if got := h.gw.Status().Tunnels; got != 1 {
		t.Fatalf("tunnels = %d: the test needs the tunnel still closing when the calls are refused", got)
	}
}

// TestAClientThatNeverAnswersTheCloseCannotHoldATunnel leaves a client's close
// handshake unanswered. The library would wait five seconds for it; the
// gateway cuts the socket after its own, shorter grace period.
func TestAClientThatNeverAnswersTheCloseCannotHoldATunnel(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Timeouts.CloseGrace = 300 * time.Millisecond })
	b := h.browser(laptop, h.pair())
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "wss://"+h.authority()+"/wails/events?clientId=page", &websocket.DialOptions{
		HTTPClient: b.client,
		HTTPHeader: http.Header{"Origin": {b.origin()}, "Authorization": {b.basic()}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	eventually(t, 5*time.Second, "the tunnel to open", func() bool { return h.gw.Status().Tunnels == 1 })
	if err = conn.Write(ctx, websocket.MessageText, []byte("unexpected")); err != nil {
		t.Fatal(err)
	}
	eventually(t, 2*time.Second, "the tunnel to be cut", func() bool { return h.gw.Status().Tunnels == 0 })
}
