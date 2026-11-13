package gateway_test

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

func TestAuditLifetimeIsBounded(t *testing.T) {
	cases := map[string]struct {
		ttl  time.Duration
		want bool
	}{
		"default":        {0, true},
		"minimum":        {gateway.MinTTL, true},
		"maximum":        {gateway.MaxTTL, true},
		"below minimum":  {gateway.MinTTL - time.Second, false},
		"above maximum":  {gateway.MaxTTL + time.Second, false},
		"negative":       {-time.Hour, false},
		"nine hours":     {9 * time.Hour, false},
		"thirty seconds": {30 * time.Second, false},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			up := newFakeWails(t)
			cfg := gateway.Config{
				ServerName: serverName, Port: 8443, OwnerID: ownerID, LocalNodeID: hostNodeID, Peers: newFakePeers(), Upstream: up,
				Clock: newFakeClock(), TTL: tc.ttl,
			}
			gw, err := gateway.New(t.Context(), cfg)
			if gw != nil {
				t.Cleanup(func() { _ = gw.Stop(context.Background()) })
			}
			if tc.want && err != nil {
				t.Fatalf("ttl %v: %v", tc.ttl, err)
			}
			if !tc.want {
				if err == nil || gateway.CodeOf(err) != gateway.CodeInvalidOptions {
					t.Fatalf("ttl %v: err %v, want invalid_audit_options", tc.ttl, err)
				}
			}
		})
	}
}

func TestAuditHasADefaultLifetimeOfOneHour(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.TTL = 0 })
	want := h.clock.Now().Wall.Add(time.Hour)
	if got := h.gw.ExpiresAt(); !got.Equal(want) {
		t.Fatalf("expires at %v, want %v", got, want)
	}
}

func TestConfigurationIsValidatedBeforeAnythingStarts(t *testing.T) {
	up := newFakeWails(t)
	base := func() gateway.Config {
		return gateway.Config{
			ServerName: serverName, Port: 8443, OwnerID: ownerID, LocalNodeID: hostNodeID, Peers: newFakePeers(), Upstream: up, Clock: newFakeClock(),
		}
	}
	cases := map[string]func(*gateway.Config){
		"ip literal name":     func(c *gateway.Config) { c.ServerName = "100.64.0.1" },
		"short name":          func(c *gateway.Config) { c.ServerName = "laptop" },
		"trailing dot":        func(c *gateway.Config) { c.ServerName = "laptop.example.ts.net." },
		"upper case name":     func(c *gateway.Config) { c.ServerName = "Laptop.example.ts.net" },
		"name with port":      func(c *gateway.Config) { c.ServerName = "laptop.example.ts.net:8443" },
		"numeric last label":  func(c *gateway.Config) { c.ServerName = "laptop.example.123" },
		"port zero":           func(c *gateway.Config) { c.Port = 0 },
		"port too high":       func(c *gateway.Config) { c.Port = 65536 },
		"no owner":            func(c *gateway.Config) { c.OwnerID = "" },
		"no local node":       func(c *gateway.Config) { c.LocalNodeID = "" },
		"no peers":            func(c *gateway.Config) { c.Peers = nil },
		"no upstream":         func(c *gateway.Config) { c.Upstream = nil },
		"non-loopback target": func(c *gateway.Config) { c.Upstream = addressOnly{addr: "192.0.2.10:3000"} },
		"wildcard target":     func(c *gateway.Config) { c.Upstream = addressOnly{addr: "0.0.0.0:3000"} },
		"target port zero":    func(c *gateway.Config) { c.Upstream = addressOnly{addr: "127.0.0.1:0"} },
	}
	for name, mutate := range cases {
		cfg := base()
		mutate(&cfg)
		gw, err := gateway.New(t.Context(), cfg)
		if err == nil {
			_ = gw.Stop(context.Background())
			t.Errorf("%s: New succeeded", name)
			continue
		}
		if gateway.CodeOf(err) != gateway.CodeInvalidOptions {
			t.Errorf("%s: %v, want invalid_audit_options", name, err)
		}
	}
}

// Without a node ID for this machine the gateway cannot tell the owner's own
// machine from a peer, so it refuses to start unless self is allowed.
func TestTheLocalNodeIsOnlyOptionalWhenSelfIsAllowed(t *testing.T) {
	up := newFakeWails(t)
	cfg := gateway.Config{
		ServerName: serverName, Port: 8443, OwnerID: ownerID, Peers: newFakePeers(), Upstream: up, Clock: newFakeClock(),
		AllowSelf: true,
	}
	gw, err := gateway.New(t.Context(), cfg)
	if err != nil {
		t.Fatalf("a gateway that allows self needs no local node: %v", err)
	}
	_ = gw.Stop(context.Background())
	cfg.AllowSelf = false
	if _, err = gateway.New(t.Context(), cfg); gateway.CodeOf(err) != gateway.CodeInvalidOptions {
		t.Fatalf("a gateway that refuses self and cannot tell which node is self started: %v", err)
	}
}

func TestAnAuditDoesNotStartAgainstAWrongTarget(t *testing.T) {
	up := newFakeWails(t)
	up.failVerification(gateway.ErrTargetChanged)
	_, err := gateway.New(t.Context(), gateway.Config{
		ServerName: serverName, Port: 8443, OwnerID: ownerID, LocalNodeID: hostNodeID, Peers: newFakePeers(), Upstream: up, Clock: newFakeClock(),
	})
	if !errors.Is(err, gateway.ErrTargetChanged) || gateway.CodeOf(err) != gateway.CodeTargetChanged {
		t.Fatalf("New with a wrong target = %v, want audit_target_changed", err)
	}
}

func TestAuditExpiresWhenTheWallClockPassesItsDeadlineDuringASuspend(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	s := mustOpen(t, b, "page")
	if res := b.get("/"); res.status != http.StatusOK {
		t.Fatalf("before expiry = %d", res.status)
	}

	// The machine sleeps for two hours: the wall clock moves, the monotonic
	// clock does not. No request arrives; only the independent timer can notice.
	h.clock.Suspend(2 * time.Hour)
	eventually(t, 5*time.Second, "the audit to expire", func() bool { return ended(h.gw) })
	if got := h.gw.EndReason(); got != gateway.EndExpired {
		t.Fatalf("end reason = %q, want expired", got)
	}
	s.expectClosed(t, 5*time.Second)
	if err := <-h.served; err != nil {
		t.Fatalf("Serve returned %v, want nil once the audit ended", err)
	}
	h.served <- nil
	if _, err := net.DialTimeout("tcp", h.ln.Addr().String(), time.Second); err == nil {
		t.Fatal("the listener is still open after the audit expired")
	}
}

func TestAuditExpiresWhenTheMonotonicClockPassesItsDeadlineFirst(t *testing.T) {
	h := newHarness(t)
	h.pair()
	h.clock.Advance(59 * time.Minute)
	// The wall clock is set back by less than the tolerated step, so the wall
	// deadline is still ahead when the monotonic one arrives.
	h.clock.StepWall(-1500 * time.Millisecond)
	h.clock.Advance(61 * time.Second)
	if wall, deadline := h.clock.Now().Wall, h.gw.ExpiresAt(); !wall.Before(deadline) {
		t.Fatalf("test setup: wall clock %v is already past %v", wall, deadline)
	}
	eventually(t, 5*time.Second, "the audit to expire on the monotonic clock", func() bool { return ended(h.gw) })
	if got := h.gw.EndReason(); got != gateway.EndExpired {
		t.Fatalf("end reason = %q, want expired", got)
	}
}

func TestAuditFailsClosedWhenTheWallClockStepsBack(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	s := mustOpen(t, b, "page")
	h.clock.StepWall(-time.Hour)
	eventually(t, 5*time.Second, "the audit to end", func() bool { return ended(h.gw) })
	if got := h.gw.EndReason(); got != gateway.EndClockJump {
		t.Fatalf("end reason = %q, want clock_jump", got)
	}
	s.expectClosed(t, 5*time.Second)
	if _, err := h.gw.NewPairing(gateway.PairingOptions{}); !errors.Is(err, gateway.ErrAuditEnded) {
		t.Fatalf("pairing after the audit ended = %v, want ErrAuditEnded", err)
	}
}

func TestSmallWallClockStepsAreIgnored(t *testing.T) {
	h := newHarness(t)
	h.clock.StepWall(-time.Second)
	time.Sleep(100 * time.Millisecond)
	if ended(h.gw) {
		t.Fatalf("a one second step ended the audit: %q", h.gw.EndReason())
	}
}

// TestRequestsAreRefusedTheMomentTheDeadlinePasses has the background timer
// switched off, so the only thing that can notice the deadline is the request
// itself.
func TestRequestsAreRefusedTheMomentTheDeadlinePasses(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Timeouts.Watch = time.Hour })
	b := h.browser(laptop, h.pair())
	if res := b.get("/health"); res.status != http.StatusOK {
		t.Fatalf("before the deadline = %d", res.status)
	}
	reference := b.send(request{path: "/", anonymous: true})
	h.clock.Advance(time.Hour)
	if ended(h.gw) || h.gw.Status().State != gateway.StateActive {
		t.Fatal("the audit ended with no request and no timer: the test cannot tell what noticed")
	}
	// The request that finds the deadline passed ends the audit, and ending it
	// closes the server, so its answer is the uniform refusal or a closed
	// connection, and never the page.
	res, err := b.sendErr(request{path: "/health"})
	if err == nil {
		sameDenial(t, "request after the deadline", reference, res)
		if res.status != http.StatusUnauthorized {
			t.Fatalf("request after the deadline = %d, want the uniform 401", res.status)
		}
	}
	if got := h.gw.EndReason(); got != gateway.EndExpired || !ended(h.gw) {
		t.Fatalf("end reason = %q, ended = %v: the request did not end the audit", got, ended(h.gw))
	}
}

func TestCredentialsNeverOutliveTheAuditAndMayBeShorter(t *testing.T) {
	h := newHarness(t)
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	long := &memoryChannel{}
	info, err := h.gw.Exchange(t.Context(), offer.Code, long, gateway.ExchangeOptions{CredentialTTL: 10 * time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	if !info.ExpiresAt.Equal(h.gw.ExpiresAt()) {
		t.Fatalf("a 10h credential expires at %v, want the audit's %v", info.ExpiresAt, h.gw.ExpiresAt())
	}

	offer, err = h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	short := &memoryChannel{}
	info, err = h.gw.Exchange(t.Context(), offer.Code, short, gateway.ExchangeOptions{CredentialTTL: 5 * time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	b := h.browser(phone, credential{info: info, username: info.Username, secret: short.secret})
	s := mustOpen(t, b, "page")
	if res := b.get("/"); res.status != http.StatusOK {
		t.Fatalf("short credential = %d", res.status)
	}
	h.clock.Advance(6 * time.Minute)
	s.expectClosed(t, 5*time.Second)
	if res := b.get("/"); res.status != http.StatusUnauthorized {
		t.Fatalf("expired credential = %d, want 401", res.status)
	}
	if ended(h.gw) {
		t.Fatal("a credential's expiry ended the audit")
	}
	if got := h.events.count(gateway.EventCredentialExpired); got != 1 {
		t.Fatalf("credential_expired events = %d, want 1", got)
	}
}

func TestRevokeClosesTunnelsAndInFlightRequests(t *testing.T) {
	h := newHarness(t)
	good := h.pair()
	b := h.browser(laptop, good)
	s := mustOpen(t, b, "page")

	inFlight := make(chan error, 1)
	go func() {
		_, err := b.sendErr(request{path: "/assets/slow.js"})
		inFlight <- err
	}()
	select {
	case <-h.up.slowStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("the slow request never reached the upstream")
	}

	if err := h.gw.Revoke(t.Context(), good.info.ID); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	// Revoke waited for closure: both are already gone.
	if status := h.gw.Status(); status.Tunnels != 0 || status.InFlight != 0 {
		t.Fatalf("after Revoke: %d tunnels, %d requests still open", status.Tunnels, status.InFlight)
	}
	s.expectClosed(t, 5*time.Second)
	select {
	case err := <-inFlight:
		if err == nil {
			t.Fatal("the in-flight request completed after its credential was revoked")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the in-flight request was not closed")
	}
	eventually(t, 5*time.Second, "the upstream request to be canceled", func() bool { return h.up.slowCancels.Load() == 1 })

	// Another credential is untouched by it.
	other := h.browser(phone, h.pair())
	if res := other.get("/"); res.status != http.StatusOK {
		t.Fatalf("other credential after the revoke = %d", res.status)
	}
}

func TestStopClosesEverythingAndStopsServing(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	s := mustOpen(t, b, "page")
	inFlight := make(chan error, 1)
	go func() {
		_, err := b.sendErr(request{path: "/assets/slow.js"})
		inFlight <- err
	}()
	<-h.up.slowStarted

	if err := h.gw.Stop(t.Context()); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if status := h.gw.Status(); status.State != gateway.StateEnded || status.Tunnels != 0 || status.InFlight != 0 {
		t.Fatalf("after Stop: %+v", status)
	}
	s.expectClosed(t, 5*time.Second)
	if err := <-inFlight; err == nil {
		t.Fatal("the in-flight request completed after Stop")
	}
	if err := h.gw.Stop(t.Context()); err != nil {
		t.Fatalf("a second Stop: %v", err)
	}
	if got := h.gw.EndReason(); got != gateway.EndStopped {
		t.Fatalf("end reason = %q, want stopped", got)
	}
	if _, err := h.gw.NewPairing(gateway.PairingOptions{}); !errors.Is(err, gateway.ErrAuditEnded) {
		t.Fatalf("NewPairing after Stop = %v", err)
	}
	if err := h.gw.Revoke(t.Context(), "x"); !errors.Is(err, gateway.ErrAuditEnded) {
		t.Fatalf("Revoke after Stop = %v", err)
	}
}

// TestStopReportsClosureItCannotConfirm serves the gateway through a server
// that records no connection for its handlers, as an owner that manages its
// own server might. The write of a response stuck on a client that stopped
// reading is interrupted by the write deadline, but net/http then closes the
// TLS connection, and crypto/tls waits up to five seconds to send its
// close_notify into the full buffer of the dead peer. The handler stays until
// then, and Stop must say that closure was not confirmed.
func TestStopReportsClosureItCannotConfirm(t *testing.T) {
	s := startPlainServer(t, func(c *gateway.Config) {
		c.Limits.MaxStaticResponseBytes = 512 << 20
		c.Timeouts.Static = time.Minute
	})
	s.up.hugeSize = 256 << 20

	client, conn := s.dial(t, serverName)
	defer conn.Close()
	text := "GET /assets/stream.js HTTP/1.1\r\nHost: " + s.authority() + "\r\nAuthorization: " + s.authorization() + "\r\n\r\n"
	if _, err := client.Write([]byte(text)); err != nil {
		t.Fatal(err)
	}
	// The client never reads. Wait until the response has stalled: until the
	// socket buffers are full the write is not stuck, and a Stop would find
	// nothing to wait for.
	eventually(t, 10*time.Second, "the request to be in flight", func() bool { return s.gw.Status().InFlight == 1 })
	s.up.waitHugeStalled(t)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	err := s.gw.Stop(ctx)
	if !errors.Is(err, gateway.ErrShutdownIncomplete) || gateway.CodeOf(err) != gateway.CodeShutdownIncomplete {
		t.Fatalf("Stop with a stuck request = %v, want audit_shutdown_incomplete", err)
	}
	// New requests were refused before Stop returned, stuck or not.
	if status := s.gw.Status(); status.State != gateway.StateEnded {
		t.Fatalf("state after a Stop that could not confirm closure = %q, want ended", status.State)
	}
	_ = client.Close()
	_ = conn.Close()
	if err = s.gw.Stop(t.Context()); err != nil {
		t.Fatalf("Stop after the client went away: %v", err)
	}
}

// TestTheHandlerChecksTheServerNameItselfNotJustTheHandshake serves the handler
// through a server that accepts any SNI: a request that names the right Host
// over a connection for another name is still refused.
func TestTheHandlerChecksTheServerNameItselfNotJustTheHandshake(t *testing.T) {
	s := startPlainServer(t)
	if got := s.get(t, serverName, s.authority()); got != http.StatusOK {
		t.Fatalf("the configured name = %d, want 200", got)
	}
	for _, sni := range []string{"evil.example", "other.example.ts.net"} {
		if got := s.get(t, sni, s.authority()); got != http.StatusUnauthorized {
			t.Errorf("SNI %q with the right Host = %d, want 401", sni, got)
		}
	}
	before := s.up.Hits()
	if got := s.get(t, serverName, "evil.example"); got != http.StatusUnauthorized || s.up.Hits() != before {
		t.Errorf("the right SNI with another Host = %d", got)
	}
}

func TestAuditEndsWhenTheUpstreamIsNoLongerTheTarget(t *testing.T) {
	for name, tc := range map[string]struct {
		err  error
		want gateway.EndReason
	}{
		"replaced host":    {gateway.ErrTargetChanged, gateway.EndTargetChanged},
		"unreachable host": {errors.New("control plane unreachable"), gateway.EndTargetUnavailable},
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			b := h.browser(laptop, h.pair())
			s := mustOpen(t, b, "page")
			h.up.failVerification(tc.err)
			eventually(t, 5*time.Second, "the audit to end", func() bool { return ended(h.gw) })
			if got := h.gw.EndReason(); got != tc.want {
				t.Fatalf("end reason = %q, want %q", got, tc.want)
			}
			s.expectClosed(t, 5*time.Second)
		})
	}
}

func TestAHungVerificationCannotKeepTheAuditAlive(t *testing.T) {
	up := newFakeWails(t)
	hung := &hangingUpstream{fakeWails: up, release: make(chan struct{})}
	t.Cleanup(func() { close(hung.release) })
	gw, err := gateway.New(t.Context(), gateway.Config{
		ServerName: serverName, Port: 8443, OwnerID: ownerID, LocalNodeID: hostNodeID, Peers: newFakePeers(), Upstream: hung, Clock: newFakeClock(),
		Timeouts: gateway.Timeouts{Watch: 10 * time.Millisecond, Verify: 50 * time.Millisecond},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = gw.Stop(context.Background()) })
	hung.hang.Store(true)
	select {
	case <-gw.Ended():
	case <-time.After(5 * time.Second):
		t.Fatal("a verification that never returns kept the audit running")
	}
}

func TestStatusCarriesNoSecrets(t *testing.T) {
	h := newHarness(t)
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	channel := &memoryChannel{}
	if _, err = h.gw.Exchange(t.Context(), offer.Code, channel, gateway.ExchangeOptions{}); err != nil {
		t.Fatal(err)
	}
	b := h.browser(laptop, credential{username: channel.credential.Username, secret: channel.secret})
	b.get("/")
	b.send(request{path: "/", anonymous: true})

	dump := fmtValue(h.gw.Status()) + fmtValue(h.events.all())
	for _, secret := range []string{channel.secret, offer.Code, strings.ReplaceAll(offer.Code, "-", "")} {
		if strings.Contains(dump, secret) {
			t.Fatalf("diagnostics contain a secret: %q", secret)
		}
	}
	if strings.Contains(dump, b.basic()) || strings.Contains(dump, strings.TrimPrefix(b.basic(), "Basic ")) {
		t.Fatal("diagnostics contain an Authorization value")
	}
}
