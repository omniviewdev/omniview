package gateway_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

// blockingChannel is a SecretChannel whose Deliver waits for the test, as a
// slow disk or a stalled prompt would.
type blockingChannel struct {
	entered chan deliveredSecret
	release chan struct{}

	mu        sync.Mutex
	discarded []string
}

type deliveredSecret struct {
	id, username, secret string
}

func newBlockingChannel() *blockingChannel {
	return &blockingChannel{entered: make(chan deliveredSecret, 1), release: make(chan struct{}), mu: sync.Mutex{}}
}

func (c *blockingChannel) Deliver(_ context.Context, credential gateway.IssuedCredential) error {
	c.entered <- deliveredSecret{
		id: credential.CredentialID, username: credential.Username, secret: string(credential.Secret),
	}
	<-c.release
	return nil
}

func (c *blockingChannel) Discard(_ context.Context, credentialID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.discarded = append(c.discarded, credentialID)
}

func (c *blockingChannel) discardedIDs() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.discarded...)
}

// exchangeAsync starts an Exchange that will block in Deliver.
func (h *harness) exchangeAsync(channel gateway.SecretChannel, opts gateway.ExchangeOptions) <-chan error {
	h.t.Helper()
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		h.t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, exchangeErr := h.gw.Exchange(context.Background(), offer.Code, channel, opts)
		result <- exchangeErr
	}()
	return result
}

func awaitDelivery(t *testing.T, channel *blockingChannel) deliveredSecret {
	t.Helper()
	select {
	case delivered := <-channel.entered:
		return delivered
	case <-time.After(5 * time.Second):
		t.Fatal("Deliver was never called")
		return deliveredSecret{}
	}
}

func awaitExchange(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("Exchange did not return")
		return nil
	}
}

func TestStopWhileASecretIsBeingDeliveredLeavesNoUsableCredential(t *testing.T) {
	h := newHarness(t)
	channel := newBlockingChannel()
	result := h.exchangeAsync(channel, gateway.ExchangeOptions{})
	delivered := awaitDelivery(t, channel)

	// Stop does not wait for a delivery: it is not a session.
	begin := time.Now()
	if err := h.gw.Stop(t.Context()); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if took := time.Since(begin); took > 2*time.Second {
		t.Fatalf("Stop waited %v for a secret channel", took)
	}
	close(channel.release)
	err := awaitExchange(t, result)
	if !errors.Is(err, gateway.ErrAuditEnded) || gateway.CodeOf(err) != gateway.CodeNotFound {
		t.Fatalf("Exchange = %v, want ErrAuditEnded (audit_not_found)", err)
	}
	if got := channel.discardedIDs(); len(got) != 1 || got[0] != delivered.id {
		t.Fatalf("discarded %v, want the one delivered credential %q", got, delivered.id)
	}
	for _, credential := range h.gw.Status().Credentials {
		if credential.State == gateway.CredentialActive || credential.State == gateway.CredentialPending {
			t.Fatalf("credential %+v is still usable after the audit was stopped", credential)
		}
	}
	// The delivered secret opens nothing: the audit refuses everything now.
	b := h.browser(laptop, credential{username: delivered.username, secret: delivered.secret})
	if res, sendErr := b.sendErr(request{path: "/"}); sendErr == nil && res.status == http.StatusOK {
		t.Fatal("the secret of an exchange that lost its audit opened the page")
	}
}

func TestRevokeWhileASecretIsBeingDeliveredLeavesNoUsableCredential(t *testing.T) {
	h := newHarness(t)
	channel := newBlockingChannel()
	result := h.exchangeAsync(channel, gateway.ExchangeOptions{})
	delivered := awaitDelivery(t, channel)

	if err := h.gw.Revoke(t.Context(), delivered.id); err != nil {
		t.Fatalf("Revoke of a credential that is still being delivered: %v", err)
	}
	close(channel.release)
	err := awaitExchange(t, result)
	if !errors.Is(err, gateway.ErrCredentialEnded) || gateway.CodeOf(err) != gateway.CodeNotFound {
		t.Fatalf("Exchange = %v, want ErrCredentialEnded (audit_not_found)", err)
	}
	if got := channel.discardedIDs(); len(got) != 1 || got[0] != delivered.id {
		t.Fatalf("discarded %v, want the revoked credential %q", got, delivered.id)
	}
	// The secret the channel was given is dead, and the audit goes on.
	dead := h.browser(laptop, credential{username: delivered.username, secret: delivered.secret})
	if res := dead.send(request{path: "/"}); res.status != http.StatusUnauthorized {
		t.Fatalf("the revoked secret = %d, want 401", res.status)
	}
	if res := h.browser(laptop, h.pair()).get("/"); res.status != http.StatusOK {
		t.Fatalf("a new credential after the revoke = %d", res.status)
	}
}

func TestACredentialThatExpiresWhileItsSecretIsBeingDeliveredIsDiscarded(t *testing.T) {
	h := newHarness(t)
	channel := newBlockingChannel()
	result := h.exchangeAsync(channel, gateway.ExchangeOptions{CredentialTTL: time.Minute})
	delivered := awaitDelivery(t, channel)
	h.clock.Advance(2 * time.Minute)
	eventually(t, 5*time.Second, "the credential to expire", func() bool {
		for _, credential := range h.gw.Status().Credentials {
			if credential.ID == delivered.id {
				return credential.State == gateway.CredentialExpired
			}
		}
		return false
	})
	close(channel.release)
	if err := awaitExchange(t, result); !errors.Is(err, gateway.ErrCredentialEnded) {
		t.Fatalf("Exchange = %v, want ErrCredentialEnded", err)
	}
	if got := channel.discardedIDs(); len(got) != 1 || got[0] != delivered.id {
		t.Fatalf("discarded %v, want %q", got, delivered.id)
	}
	if ended(h.gw) {
		t.Fatal("a credential's expiry ended the audit")
	}
}

func TestStopHasNothingToWaitForAndSaysSoEvenForADoneContext(t *testing.T) {
	h := newHarness(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := h.gw.Stop(ctx); err != nil {
		t.Fatalf("Stop with no sessions and a done context = %v, want nil", err)
	}
	if err := h.gw.Stop(ctx); err != nil {
		t.Fatalf("a second Stop = %v, want nil", err)
	}
}

func TestEveryErrorTheAPIReturnsCarriesItsCode(t *testing.T) {
	cases := []struct {
		err  error
		code gateway.Code
	}{
		{gateway.ErrAuditEnded, gateway.CodeNotFound},
		{gateway.ErrCredentialNotFound, gateway.CodeNotFound},
		{gateway.ErrCredentialEnded, gateway.CodeNotFound},
		{gateway.ErrCredentialLimit, gateway.CodeInvalidOptions},
		{gateway.ErrPairingLimit, gateway.CodeInvalidOptions},
		{gateway.ErrPairingInvalid, gateway.CodeUnauthorized},
		{gateway.ErrPairingRateLimited, gateway.CodeUnauthorized},
		{gateway.ErrDelivery, gateway.CodeUnavailable},
		{gateway.ErrTargetChanged, gateway.CodeTargetChanged},
		{gateway.ErrTargetUnavailable, gateway.CodeUnavailable},
		{gateway.ErrTimeout, gateway.CodeTimeout},
		{gateway.ErrShutdownIncomplete, gateway.CodeShutdownIncomplete},
	}
	codes := map[gateway.Code]string{
		gateway.CodeNotFound: "audit_not_found", gateway.CodeInvalidOptions: "invalid_audit_options",
		gateway.CodeUnauthorized: "audit_unauthorized", gateway.CodeUnavailable: "audit_unavailable",
		gateway.CodeTargetChanged: "audit_target_changed", gateway.CodeTimeout: "audit_timeout",
		gateway.CodeShutdownIncomplete: "audit_shutdown_incomplete", gateway.CodeDenied: "audit_denied",
	}
	for _, tc := range cases {
		if string(tc.code) != codes[tc.code] {
			t.Errorf("code %q is not the plan's name %q", tc.code, codes[tc.code])
		}
		wrapped := fmt.Errorf("while doing something: %w", tc.err)
		joined := errors.Join(errors.New("another cause"), tc.err)
		for name, err := range map[string]error{"plain": tc.err, "wrapped": wrapped, "joined": joined} {
			if got := gateway.CodeOf(err); got != tc.code {
				t.Errorf("CodeOf(%s %v) = %q, want %q", name, tc.err, got, tc.code)
			}
			if !errors.Is(err, tc.err) {
				t.Errorf("%s %v lost its identity", name, tc.err)
			}
		}
		if !strings.HasPrefix(tc.err.Error(), string(tc.code)+":") {
			t.Errorf("%q does not start with its code %q", tc.err.Error(), tc.code)
		}
	}
	if got := gateway.CodeOf(errors.New("plain")); got != "" {
		t.Errorf("CodeOf of a plain error = %q, want none", got)
	}
}

// funcUpstream is an Upstream whose verification the test supplies.
type funcUpstream struct {
	address netip.AddrPort
	verify  func(context.Context) error
}

func (u funcUpstream) Address() netip.AddrPort { return u.address }

func (u funcUpstream) Verify(ctx context.Context) error { return u.verify(ctx) }

func TestAFailedFirstVerificationIsReportedAsWhatItWas(t *testing.T) {
	address := newFakeWails(t).Address()
	plain := errors.New("the control plane refused the connection")
	cases := map[string]struct {
		verify func(context.Context) error
		code   gateway.Code
		is     error
	}{
		"a replaced host": {
			func(context.Context) error { return fmt.Errorf("pid changed: %w", gateway.ErrTargetChanged) },
			gateway.CodeTargetChanged, gateway.ErrTargetChanged,
		},
		"an unreachable control plane": {
			func(context.Context) error { return plain },
			gateway.CodeUnavailable, plain,
		},
		"no answer in time": {
			func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() },
			gateway.CodeTimeout, context.DeadlineExceeded,
		},
		"a verification that panics": {
			func(context.Context) error { panic("a bug in the adapter") },
			gateway.CodeUnavailable, gateway.ErrTargetUnavailable,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := gateway.New(t.Context(), gateway.Config{
				ServerName: serverName, Port: 8443, OwnerID: ownerID, LocalNodeID: hostNodeID,
				Peers: newFakePeers(), Upstream: funcUpstream{address: address, verify: tc.verify},
				Clock: newFakeClock(), Timeouts: gateway.Timeouts{Verify: 100 * time.Millisecond},
			})
			if err == nil {
				t.Fatal("New succeeded")
			}
			if got := gateway.CodeOf(err); got != tc.code {
				t.Fatalf("code = %q (%v), want %q", got, err, tc.code)
			}
			if !errors.Is(err, tc.is) {
				t.Fatalf("%v does not wrap %v", err, tc.is)
			}
		})
	}
}

func TestAPanickingPeerLookupIsADenialAndNotACrash(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Peers = panickingPeers{} })
	b := h.browser(laptop, h.pair())
	reference := b.send(request{path: "/", anonymous: true})
	sameDenial(t, "a peer lookup that panics", reference, b.send(request{path: "/"}))
	if h.up.Hits() != 0 {
		t.Fatal("a request whose peer lookup panicked reached the host")
	}
}

type panickingPeers struct{}

func (panickingPeers) Resolve(context.Context, netip.AddrPort) (gateway.Peer, error) {
	panic("a bug in the daemon adapter")
}

func TestAnAuditEndsWhenItsVerificationPanicsLater(t *testing.T) {
	up := newFakeWails(t)
	var calls int
	var mu sync.Mutex
	gw, err := gateway.New(t.Context(), gateway.Config{
		ServerName: serverName, Port: 8443, OwnerID: ownerID, LocalNodeID: hostNodeID, Peers: newFakePeers(),
		Upstream: funcUpstream{address: up.Address(), verify: func(context.Context) error {
			mu.Lock()
			defer mu.Unlock()
			if calls++; calls > 2 {
				panic("a bug in the adapter")
			}
			return nil
		}},
		Clock: newFakeClock(), Timeouts: gateway.Timeouts{Watch: 10 * time.Millisecond},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = gw.Stop(context.Background()) })
	eventually(t, 5*time.Second, "the audit to end", func() bool { return ended(gw) })
	if got := gw.EndReason(); got != gateway.EndTargetUnavailable {
		t.Fatalf("end reason = %q, want target_unavailable", got)
	}
}

func eventsOf(h *harness, kind gateway.EventKind) []gateway.Event {
	var found []gateway.Event
	for _, event := range h.events.all() {
		if event.Kind == kind {
			found = append(found, event)
		}
	}
	return found
}

func TestPairingEventsCarryTheirKindsAndCodesButNeverTheCode(t *testing.T) {
	h := newHarness(t)
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(eventsOf(h, gateway.EventPairingOffered)) != 1 {
		t.Fatal("no pairing_offered event")
	}
	_, err = h.gw.Exchange(t.Context(), "AAAA-AAAA-AAAA-AAAA", &memoryChannel{}, gateway.ExchangeOptions{})
	if err == nil {
		t.Fatal("a wrong code was accepted")
	}
	if rejected := eventsOf(h, gateway.EventPairingRejected); len(rejected) != 1 || rejected[0].Code != "invalid" {
		t.Fatalf("pairing_rejected events %+v, want one coded invalid", rejected)
	}
	info, err := h.gw.Exchange(t.Context(), offer.Code, &memoryChannel{}, gateway.ExchangeOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if redeemed := eventsOf(h, gateway.EventPairingRedeemed); len(redeemed) != 1 || redeemed[0].CredentialID != info.ID {
		t.Fatalf("pairing_redeemed events %+v", redeemed)
	}
	if issued := eventsOf(h, gateway.EventCredentialIssued); len(issued) != 1 || issued[0].CredentialID != info.ID {
		t.Fatalf("credential_issued events %+v", issued)
	}
	for _, event := range h.events.all() {
		if strings.Contains(event.Code+event.Subject+event.CredentialID+event.NodeID, offer.Code) {
			t.Fatal("an event carries the pairing code")
		}
	}
}

// With an allowance of two failures, the first two wrong attempts are examined
// and refused as invalid, and the third is not examined at all.
func TestPairingFailuresAreExaminedUntilTheAllowanceIsSpent(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Limits.PairingFailureBurst = 2 })
	for range 3 {
		_, _ = h.gw.Exchange(t.Context(), "BBBB-BBBB-BBBB-BBBB", &memoryChannel{}, gateway.ExchangeOptions{})
	}
	var invalid, limited int
	for _, event := range eventsOf(h, gateway.EventPairingRejected) {
		switch event.Code {
		case "invalid":
			invalid++
		case "rate_limited":
			limited++
		}
	}
	if invalid != 2 || limited != 1 {
		t.Fatalf("%d invalid and %d rate_limited rejections, want 2 and 1", invalid, limited)
	}
}

func TestCredentialEventsCarryTheirIDsAndTheNodeTheyArePinnedTo(t *testing.T) {
	h := newHarness(t)
	cred := h.pair()
	b := h.browser(laptop, cred)
	mustOpen(t, b, "page")
	id := cred.info.ID
	if opened := eventsOf(h, gateway.EventTunnelOpened); len(opened) != 1 || opened[0].CredentialID != id ||
		opened[0].NodeID != laptop.NodeID {
		t.Fatalf("tunnel_opened events %+v", opened)
	}
	if err := h.gw.Revoke(t.Context(), id); err != nil {
		t.Fatal(err)
	}
	if revoked := eventsOf(h, gateway.EventCredentialRevoked); len(revoked) != 1 || revoked[0].CredentialID != id ||
		revoked[0].NodeID != laptop.NodeID {
		t.Fatalf("credential_revoked events %+v", revoked)
	}
	waitTunnelClosed(t, h, "credential_revoked")
	// Revoking a credential that is already revoked is no new revocation.
	if err := h.gw.Revoke(t.Context(), id); err != nil {
		t.Fatal(err)
	}
	if got := len(eventsOf(h, gateway.EventCredentialRevoked)); got != 1 {
		t.Fatalf("%d credential_revoked events after a second Revoke, want 1", got)
	}
}

func TestTheAuditEndedEventNamesWhyItEnded(t *testing.T) {
	cases := []struct {
		name   string
		reason gateway.EndReason
		end    func(h *harness)
	}{
		{"stopped", gateway.EndStopped, func(h *harness) { _ = h.gw.Stop(context.Background()) }},
		{"expired", gateway.EndExpired, func(h *harness) { h.clock.Suspend(2 * time.Hour) }},
		{"clock stepped back", gateway.EndClockJump, func(h *harness) { h.clock.StepWall(-time.Hour) }},
		{"target replaced", gateway.EndTargetChanged, func(h *harness) { h.up.failVerification(gateway.ErrTargetChanged) }},
		{"target unreachable", gateway.EndTargetUnavailable, func(h *harness) { h.up.failVerification(errors.New("gone")) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t)
			tc.end(h)
			eventually(t, 5*time.Second, "the audit_ended event", func() bool {
				return len(eventsOf(h, gateway.EventEnded)) > 0
			})
			// An audit that has ended says so once, whatever is done to it next.
			if err := h.gw.Stop(t.Context()); err != nil {
				t.Fatalf("Stop after the audit ended: %v", err)
			}
			endedEvents := eventsOf(h, gateway.EventEnded)
			if len(endedEvents) != 1 || endedEvents[0].Code != string(tc.reason) {
				t.Fatalf("audit_ended events %+v, want exactly one coded %q", endedEvents, tc.reason)
			}
			if got := h.gw.EndReason(); got != tc.reason {
				t.Fatalf("end reason = %q, want %q", got, tc.reason)
			}
		})
	}
}

// storm runs the operations of an audit in loops until it is told to stop.
type storm struct {
	h        *harness
	shared   credential
	browsers []*browser
	stop     chan struct{}
	workers  sync.WaitGroup
}

func newStorm(h *harness) *storm {
	shared := h.pair()
	return &storm{
		h: h, shared: shared, stop: make(chan struct{}),
		browsers: []*browser{
			h.browser(laptop, shared), h.browser(laptop, shared), h.browser(laptop, shared), h.browser(laptop, shared),
		},
	}
}

func (s *storm) spin(work func()) {
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		for {
			select {
			case <-s.stop:
				return
			default:
				work()
			}
		}
	}()
}

// start sets every kind of work going: pairing, requests, a call, tunnels,
// revokes of other credentials, clock movement and status reads.
func (s *storm) start() {
	h := s.h
	s.spin(func() {
		if offer, err := h.gw.NewPairing(gateway.PairingOptions{}); err == nil {
			_, _ = h.gw.Exchange(context.Background(), offer.Code, &memoryChannel{}, gateway.ExchangeOptions{})
		}
	})
	s.spin(func() { _, _ = s.browsers[0].sendErr(request{path: "/health"}) })
	s.spin(func() { _, _ = s.browsers[1].sendErr(request{path: "/assets/app.js"}) })
	s.spin(func() {
		_, _ = s.browsers[2].sendErr(request{
			method: http.MethodPost, path: "/wails/runtime", header: runtimeHeader(s.browsers[2], "stress"),
			body: callBody("c1", instanceInfo, ""),
		})
	})
	s.spin(func() {
		socket, err := s.browsers[3].openEvents("stress", false)
		if err != nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
		_ = socket.conn.CloseNow()
	})
	s.spin(func() {
		for _, credential := range h.gw.Status().Credentials {
			if credential.ID != s.shared.info.ID && credential.State == gateway.CredentialActive {
				_ = h.gw.Revoke(context.Background(), credential.ID)
			}
		}
		time.Sleep(5 * time.Millisecond)
	})
	s.spin(func() { h.clock.Advance(20 * time.Millisecond); time.Sleep(10 * time.Millisecond) })
	s.spin(func() { _ = h.gw.Status() })
}

// finish stops the loops and fails the test if one of them is stuck.
func (s *storm) finish(t *testing.T) {
	t.Helper()
	close(s.stop)
	done := make(chan struct{})
	go func() { s.workers.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("the workers never finished: something is stuck")
	}
}

// endConcurrently stops the audit twice and revokes a credential, all at once.
func endConcurrently(h *harness, credentialID string) {
	var ending sync.WaitGroup
	for range 2 {
		ending.Add(1)
		go func() {
			defer ending.Done()
			_ = h.gw.Stop(context.Background())
		}()
	}
	ending.Add(1)
	go func() {
		defer ending.Done()
		_ = h.gw.Revoke(context.Background(), credentialID)
	}()
	ending.Wait()
}

// TestConcurrentOperationsLeaveAConsistentAudit runs every operation at once
// under the race detector: pairing, requests, tunnels, calls, revokes, clock
// movement and status reads, ending in a concurrent Stop.
func TestConcurrentOperationsLeaveAConsistentAudit(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.FailureBurst = 1 << 20
		c.Limits.GlobalFailureBurst = 1 << 20
		c.Limits.TunnelOpenBurst = 1 << 20
		c.Limits.MaxEventSocketOpens = 1 << 20
		c.Limits.PairingFailureBurst = 1 << 20
		c.Timeouts.CloseGrace = 100 * time.Millisecond
	})
	s := newStorm(h)
	s.start()
	time.Sleep(1500 * time.Millisecond)
	endConcurrently(h, s.shared.info.ID)
	time.Sleep(100 * time.Millisecond)
	s.finish(t)

	if err := h.gw.Stop(t.Context()); err != nil {
		t.Fatalf("Stop after the storm: %v", err)
	}
	status := h.gw.Status()
	if status.State != gateway.StateEnded || status.Tunnels != 0 || status.InFlight != 0 || status.PendingOffers != 0 {
		t.Fatalf("status after the storm: %+v", status)
	}
	for _, credential := range status.Credentials {
		if credential.State == gateway.CredentialActive || credential.State == gateway.CredentialPending {
			t.Fatalf("credential %+v is still usable after Stop", credential)
		}
	}
	if res, err := s.browsers[0].sendErr(request{path: "/health"}); err == nil && res.status == http.StatusOK {
		t.Fatal("a request was served after the audit ended")
	}
}
