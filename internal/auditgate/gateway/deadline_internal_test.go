package gateway

import (
	"context"
	"crypto/tls"
	"errors"
	"net/netip"
	"reflect"
	"testing"
	"time"
)

// After a credential's deadline nothing may use it, whether or not the sweep
// that records its end has run yet. The sweep runs on a timer and the clock
// can jump past a deadline between two ticks, so every use looks at the clock
// as it is at that moment, and never at the state the slot last claimed.
func TestEveryUseOfACredentialRechecksItsDeadlineAtTheMomentOfUse(t *testing.T) {
	gw, clock := newTestGateway(t) // sweeps hourly: nothing sweeps during this test
	username, secret := issueForTest(t, gw, clock)
	id := gw.Status().Credentials[0].ID
	p := principal{credential: id, node: "node", remote: netip.MustParseAddrPort("100.64.0.1:1")}
	ctx := context.Background()

	before := clock.Now()
	if check := gw.verifyCredential(username, secret, "node", true, before); !check.ok {
		t.Fatalf("control: the credential is refused before its deadline: %+v", check)
	}
	sess, denial, ok := gw.beginRequest(ctx, p, before)
	if !ok {
		t.Fatalf("control: a request is refused before the deadline: %v", denial)
	}
	sess.finish()
	sess, _, failure := gw.openTunnel(ctx, p, "page", before)
	if failure != openOK {
		t.Fatalf("control: a tunnel is refused before the deadline: %v", failure)
	}
	sess.finish()

	after := Instant{Wall: before.Wall.Add(2 * time.Hour), Mono: before.Mono + 2*time.Hour}
	gw.mu.Lock()
	state := gw.table.slots[0].state
	gw.mu.Unlock()
	if state != slotActive {
		t.Fatalf("precondition: the slot is %v, not active; the sweep must not have run", state)
	}
	if check := gw.verifyCredential(username, secret, "node", true, after); check.ok {
		t.Error("a credential past its deadline authenticated")
	}
	if sess, denial, ok = gw.beginRequest(ctx, p, after); ok {
		sess.finish()
		t.Error("a request began for a credential past its deadline")
	} else if denial != DenialEnded {
		t.Errorf("the refusal is %v, want the ended denial", denial)
	}
	if sess, _, failure = gw.openTunnel(ctx, p, "another", after); failure == openOK {
		sess.finish()
		t.Error("a tunnel opened for a credential past its deadline")
	}
}

func TestAnActivationAfterTheDeadlineFailsEvenIfNothingSweptTheCredential(t *testing.T) {
	gw, clock := newTestGateway(t)
	secret, err := gw.mint()
	if err != nil {
		t.Fatal(err)
	}
	var events []Event
	gw.mu.Lock()
	place, err := gw.placeLocked(clock.Now(), time.Minute, &secret, &events)
	gw.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	clock.advance(2 * time.Minute)
	if err = gw.activate(secret.id, place.index); !errors.Is(err, ErrCredentialEnded) {
		t.Fatalf("activate after the deadline = %v, want ErrCredentialEnded", err)
	}
	if gw.table.slots[place.index].state == slotActive {
		t.Fatal("an expired credential became active")
	}
}

// A bound that defaults to zero is a bound that is off. Every field is checked
// by reflection so that one added later cannot be left out.
func TestEveryTimeoutAndLimitHasANonZeroDefault(t *testing.T) {
	timeouts := reflect.ValueOf(Timeouts{}.withDefaults())
	for i := range timeouts.NumField() {
		if timeouts.Field(i).Int() <= 0 {
			t.Errorf("Timeouts.%s defaults to %v", timeouts.Type().Field(i).Name, timeouts.Field(i))
		}
	}
	limits := reflect.ValueOf(Limits{}.withDefaults())
	for i := range limits.NumField() {
		if limits.Field(i).Int() <= 0 {
			t.Errorf("Limits.%s defaults to %v", limits.Type().Field(i).Name, limits.Field(i))
		}
	}
}

func TestTheServerIsBuiltFromTheConfiguredDeadlinesAndLimits(t *testing.T) {
	gw, _ := newTestGateway(t, func(c *Config) {
		c.Timeouts.ReadHeader = 3 * time.Second
		c.Timeouts.Read = 4 * time.Second
		c.Timeouts.Idle = 5 * time.Second
	})
	srv := gw.newServer(nil)
	if srv.ReadHeaderTimeout != 3*time.Second || srv.ReadTimeout != 4*time.Second || srv.IdleTimeout != 5*time.Second {
		t.Fatalf("deadlines %v %v %v, want the configured 3s 4s 5s", srv.ReadHeaderTimeout, srv.ReadTimeout, srv.IdleTimeout)
	}
	if srv.MaxHeaderBytes != maxHeaderBytes || srv.MaxHeaderBytes <= 0 {
		t.Fatalf("MaxHeaderBytes = %d", srv.MaxHeaderBytes)
	}
	if srv.TLSNextProto == nil || len(srv.TLSNextProto) != 0 {
		t.Fatal("HTTP/2 is not switched off")
	}
	if !srv.DisableGeneralOptionsHandler {
		t.Fatal("net/http answers OPTIONS * itself, ahead of the identity and credential checks")
	}
	if srv.ConnContext == nil || srv.BaseContext == nil || srv.ErrorLog == nil {
		t.Fatal("the server lacks its connection context, base context or quiet error log")
	}
	config := srv.TLSConfig
	if config.MinVersion != tls.VersionTLS13 || config.MaxVersion != tls.VersionTLS13 {
		t.Fatalf("TLS versions %x to %x, want TLS 1.3 only", config.MinVersion, config.MaxVersion)
	}
	if !reflect.DeepEqual(config.NextProtos, []string{"http/1.1"}) {
		t.Fatalf("ALPN %v, want only http/1.1", config.NextProtos)
	}

	defaults, _ := newTestGateway(t)
	srv = defaults.newServer(nil)
	if srv.ReadHeaderTimeout != defaultReadHeader || srv.ReadTimeout != defaultRead || srv.IdleTimeout != defaultIdle {
		t.Fatalf("default deadlines %v %v %v", srv.ReadHeaderTimeout, srv.ReadTimeout, srv.IdleTimeout)
	}
}

func TestNamesAreComparedByASCIIOnly(t *testing.T) {
	equal := [][2]string{
		{"audit.example.ts.net", "audit.example.ts.net"},
		{"audit.example.ts.net", "AUDIT.Example.TS.net"},
		{"", ""},
	}
	for _, pair := range equal {
		if !asciiEqualFold(pair[0], pair[1]) {
			t.Errorf("%q and %q differ", pair[0], pair[1])
		}
	}
	different := [][2]string{
		{"audit.example.ts.net", "audit.example.ts.nex"},
		{"audit.example.ts.net", "audit.example.ts.ne"},
		// U+017F (long s) and U+212A (Kelvin sign) fold to "s" and "k" under
		// Unicode rules; DNS names do not.
		{"audit.example.ts.net", "audit.example.t\u017f.net"},
		{"kube.example.ts.net", "\u212aube.example.ts.net"},
		{"audit.example.ts.net", "audit.example.ts.net\x00"},
	}
	for _, pair := range different {
		if asciiEqualFold(pair[0], pair[1]) {
			t.Errorf("%q and %q compare equal", pair[0], pair[1])
		}
	}
}
