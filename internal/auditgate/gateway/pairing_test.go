package gateway_test

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

// retainingChannel keeps the very slice it is given, to see what the gateway
// does to it afterwards.
type retainingChannel struct {
	secret   []byte
	username string
}

func (c *retainingChannel) Deliver(_ context.Context, credential gateway.IssuedCredential) error {
	c.secret = credential.Secret
	c.username = credential.Username
	return nil
}

func (c *retainingChannel) Discard(context.Context, string) {}

func TestAPairingCodeIsExchangedForACredentialExactlyOnce(t *testing.T) {
	h := newHarness(t)
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$`).MatchString(offer.Code) {
		t.Fatalf("pairing code %q is not four groups of four symbols", offer.Code)
	}
	if !offer.ExpiresAt.Equal(h.clock.Now().Wall.Add(gateway.DefaultPairingTTL)) {
		t.Fatalf("offer expires at %v, want %v from now", offer.ExpiresAt, gateway.DefaultPairingTTL)
	}

	channel := &memoryChannel{}
	info, err := h.gw.Exchange(t.Context(), offer.Code, channel, gateway.ExchangeOptions{})
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if info.AuditID != h.gw.ID() || info.Realm != h.gw.Realm() || info.Origin != h.gw.Origin() {
		t.Fatalf("credential info %+v does not describe this audit", info)
	}
	if len(channel.secret) != 43 || channel.credential.Username != info.Username || channel.credential.CredentialID != info.ID {
		t.Fatalf("the channel received %+v", channel.credential)
	}

	// The credential opens the page...
	b := h.browser(laptop, credential{info: info, username: info.Username, secret: channel.secret})
	if res := b.get("/"); res.status != http.StatusOK {
		t.Fatalf("the credential from a pairing = %d", res.status)
	}
	// ...and the code is spent.
	again := &memoryChannel{}
	if _, err = h.gw.Exchange(t.Context(), offer.Code, again, gateway.ExchangeOptions{}); !errors.Is(err, gateway.ErrPairingInvalid) {
		t.Fatalf("second exchange = %v, want ErrPairingInvalid", err)
	}
	if again.secret != "" {
		t.Fatal("a second secret was delivered for one code")
	}
}

func TestPairingCodesAreTypedLeniently(t *testing.T) {
	h := newHarness(t)
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	typed := " " + strings.ToLower(strings.ReplaceAll(offer.Code, "-", " ")) + " "
	if _, err = h.gw.Exchange(t.Context(), typed, &memoryChannel{}, gateway.ExchangeOptions{}); err != nil {
		t.Fatalf("a code typed in lower case with spaces: %v", err)
	}
}

func TestOnlyTheRightCodeIsAccepted(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Limits.PairingFailureBurst = 100 })
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	plain := strings.ReplaceAll(offer.Code, "-", "")
	for _, code := range []string{
		"", "x", "AAAA", plain[:15], offer.Code + "A", strings.Repeat("2", 16),
		offer.Code[:len(offer.Code)-1] + "!", strings.Repeat(offer.Code, 5), "0000-1111-IIII-OOOO",
	} {
		channel := &memoryChannel{}
		if _, err = h.gw.Exchange(t.Context(), code, channel, gateway.ExchangeOptions{}); !errors.Is(err, gateway.ErrPairingInvalid) {
			t.Errorf("code %q = %v, want ErrPairingInvalid", code, err)
		}
		if channel.secret != "" {
			t.Errorf("code %q was given a secret", code)
		}
	}
	// The wrong guesses did not spend the right code.
	if _, err = h.gw.Exchange(t.Context(), offer.Code, &memoryChannel{}, gateway.ExchangeOptions{}); err != nil {
		t.Fatalf("the right code after wrong guesses: %v", err)
	}
}

func TestAnExpiredCodeIsRefusedLikeAWrongOne(t *testing.T) {
	h := newHarness(t)
	offer, err := h.gw.NewPairing(gateway.PairingOptions{TTL: gateway.MinPairingTTL})
	if err != nil {
		t.Fatal(err)
	}
	h.clock.Advance(gateway.MinPairingTTL - time.Second)
	if _, err = h.gw.Exchange(t.Context(), offer.Code, &memoryChannel{}, gateway.ExchangeOptions{}); err != nil {
		t.Fatalf("a code just before it expires: %v", err)
	}
	other, err := h.gw.NewPairing(gateway.PairingOptions{TTL: gateway.MinPairingTTL})
	if err != nil {
		t.Fatal(err)
	}
	h.clock.Advance(gateway.MinPairingTTL)
	if _, err = h.gw.Exchange(t.Context(), other.Code, &memoryChannel{}, gateway.ExchangeOptions{}); !errors.Is(err, gateway.ErrPairingInvalid) {
		t.Fatalf("an expired code = %v, want ErrPairingInvalid", err)
	}
}

func TestGuessingPairingCodesIsRateLimited(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.PairingFailureBurst = 3
		c.Limits.PairingFailureRefill = time.Minute
	})
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for range 3 {
		if _, err = h.gw.Exchange(t.Context(), "AAAA-AAAA-AAAA-AAAA", &memoryChannel{}, gateway.ExchangeOptions{}); !errors.Is(err, gateway.ErrPairingInvalid) {
			t.Fatalf("a wrong guess = %v, want ErrPairingInvalid", err)
		}
	}
	// Past the allowance even the right code is not examined, so a limited
	// answer says nothing about the code.
	_, err = h.gw.Exchange(t.Context(), offer.Code, &memoryChannel{}, gateway.ExchangeOptions{})
	if !errors.Is(err, gateway.ErrPairingRateLimited) {
		t.Fatalf("the right code while limited = %v, want ErrPairingRateLimited", err)
	}
	h.clock.Advance(2 * time.Minute)
	if _, err = h.gw.Exchange(t.Context(), offer.Code, &memoryChannel{}, gateway.ExchangeOptions{}); err != nil {
		t.Fatalf("the right code after the allowance refilled: %v", err)
	}
}

func TestAFailedDeliverySpendsTheCodeAndLeavesNoCredential(t *testing.T) {
	h := newHarness(t)
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	boom := errors.New("disk full")
	_, err = h.gw.Exchange(t.Context(), offer.Code, &memoryChannel{err: boom}, gateway.ExchangeOptions{})
	if !errors.Is(err, gateway.ErrDelivery) || !errors.Is(err, boom) {
		t.Fatalf("failed delivery = %v, want ErrDelivery wrapping the cause", err)
	}
	if status := h.gw.Status(); len(status.Credentials) != 0 {
		t.Fatalf("a credential exists although its secret was never delivered: %+v", status.Credentials)
	}
	if _, err = h.gw.Exchange(t.Context(), offer.Code, &memoryChannel{}, gateway.ExchangeOptions{}); !errors.Is(err, gateway.ErrPairingInvalid) {
		t.Fatalf("the code after a failed delivery = %v, want it spent", err)
	}
	// A full set of places is not used up by failed deliveries either.
	for range gateway.MaxActiveCredentials {
		h.pair()
	}
}

func TestTheSecretIsClearedOnceDelivered(t *testing.T) {
	h := newHarness(t)
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	channel := &retainingChannel{}
	if _, err = h.gw.Exchange(t.Context(), offer.Code, channel, gateway.ExchangeOptions{}); err != nil {
		t.Fatal(err)
	}
	if len(channel.secret) != 43 || !bytes.Equal(channel.secret, make([]byte, 43)) {
		t.Fatalf("the gateway left the secret in memory it handed out: %q", channel.secret)
	}
}

func TestPairingOffersAreFewAndBounded(t *testing.T) {
	h := newHarness(t)
	for _, ttl := range []time.Duration{gateway.MinPairingTTL - time.Second, gateway.MaxPairingTTL + time.Second, -time.Minute} {
		if _, err := h.gw.NewPairing(gateway.PairingOptions{TTL: ttl}); gateway.CodeOf(err) != gateway.CodeInvalidOptions {
			t.Errorf("ttl %v = %v, want invalid_audit_options", ttl, err)
		}
	}
	for range 4 {
		if _, err := h.gw.NewPairing(gateway.PairingOptions{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.gw.NewPairing(gateway.PairingOptions{}); !errors.Is(err, gateway.ErrPairingLimit) {
		t.Fatalf("fifth offer = %v, want ErrPairingLimit", err)
	}
	if got := h.gw.Status().PendingOffers; got != 4 {
		t.Fatalf("pending offers = %d, want 4", got)
	}
	// Expired offers make room.
	h.clock.Advance(gateway.DefaultPairingTTL + time.Second)
	if _, err := h.gw.NewPairing(gateway.PairingOptions{}); err != nil {
		t.Fatalf("offer after the old ones expired: %v", err)
	}
}

func TestOffersNeverOutliveTheAudit(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.TTL = gateway.MinTTL })
	offer, err := h.gw.NewPairing(gateway.PairingOptions{TTL: gateway.MaxPairingTTL})
	if err != nil {
		t.Fatal(err)
	}
	if offer.ExpiresAt.After(h.gw.ExpiresAt()) {
		t.Fatalf("offer expires at %v, after the audit's %v", offer.ExpiresAt, h.gw.ExpiresAt())
	}
	if err = h.gw.Stop(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err = h.gw.Exchange(t.Context(), offer.Code, &memoryChannel{}, gateway.ExchangeOptions{}); !errors.Is(err, gateway.ErrAuditEnded) {
		t.Fatalf("exchange after the audit ended = %v, want ErrAuditEnded", err)
	}
}

func TestCodesAreSpecificToTheirAudit(t *testing.T) {
	first, second := newHarness(t), newHarness(t)
	offer, err := first.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = second.gw.NewPairing(gateway.PairingOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err = second.gw.Exchange(t.Context(), offer.Code, &memoryChannel{}, gateway.ExchangeOptions{}); !errors.Is(err, gateway.ErrPairingInvalid) {
		t.Fatalf("another audit's code = %v, want ErrPairingInvalid", err)
	}
}
