package gateway

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"strings"
	"sync"
	"time"
)

// Pairing lifetime bounds. A pairing code is short-lived: it is read off the
// host once and typed or carried to wherever the credential is wanted.
const (
	MinPairingTTL     = 30 * time.Second
	DefaultPairingTTL = 5 * time.Minute
	MaxPairingTTL     = 15 * time.Minute

	maxPairingOffers = 4
	// pairingCodeLength is the number of symbols in a code. Each symbol carries
	// five bits, so a code has 80 bits of entropy.
	pairingCodeLength = 16
	pairingGroup      = 4
	// pairingAlphabet has 32 symbols and leaves out 0, 1, I and O, which are
	// easy to confuse.
	pairingAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	bitsPerSymbol   = 5
	// maxTypedCodeLength bounds the text a caller may pass as a code: a code
	// with separators between every symbol, and some slack.
	maxTypedCodeLength = 4 * pairingCodeLength
)

// SecretChannel is the private channel over which a freshly issued credential
// reaches its owner. It is the only place the secret ever appears. Deliver
// must not log, return or keep the secret, and must copy anything it keeps:
// the gateway clears Secret as soon as Deliver returns.
type SecretChannel interface {
	Deliver(ctx context.Context, credential IssuedCredential) error
	// Discard removes whatever Deliver stored for the credential. The gateway
	// calls it when the credential does not become active after all: Deliver
	// failed, or the credential was revoked, expired or lost with its audit
	// while the secret was being delivered. It is best effort, must be safe to
	// call for a credential that was never delivered, and cannot erase copies
	// already made.
	Discard(ctx context.Context, credentialID string)
}

// IssuedCredential is a credential as the secret channel receives it.
type IssuedCredential struct {
	AuditID      string
	CredentialID string
	Username     string
	// Secret is the password: 43 base64url characters.
	Secret    []byte
	Realm     string
	Origin    string
	ExpiresAt time.Time
}

// String formats the credential without its secret, so printing one with %v or
// %+v never writes the password to a log.
func (c IssuedCredential) String() string {
	return "audit credential " + c.CredentialID + " (secret withheld)"
}

// GoString is String for %#v.
func (c IssuedCredential) GoString() string { return c.String() }

// CredentialInfo describes a credential without its secret.
type CredentialInfo struct {
	AuditID   string
	ID        string
	Username  string
	Realm     string
	Origin    string
	CreatedAt time.Time
	ExpiresAt time.Time
}

// PairingOptions configure [Gateway.NewPairing].
type PairingOptions struct {
	// TTL is how long the code stays valid, from MinPairingTTL to
	// MaxPairingTTL and never past the audit. Zero is DefaultPairingTTL.
	TTL time.Duration
}

// PairingOffer is a pairing code and when it stops working. Code is shown to
// the owner once; the gateway keeps only a keyed digest of it.
type PairingOffer struct {
	ID        string
	Code      string
	ExpiresAt time.Time
}

// ExchangeOptions configure [Gateway.Exchange].
type ExchangeOptions struct {
	// CredentialTTL is how long the credential lasts. Zero, or anything past
	// the end of the audit, means until the audit ends.
	CredentialTTL time.Duration
}

type pairingOffer struct {
	// live marks an occupied slot.
	live    bool
	id      string
	digest  [sha256.Size]byte
	expires deadline
}

// pairingFailures bounds failed exchange attempts. Like the credential
// limiter it is checked before the code is examined, so a refusal says nothing
// about the code.
type pairingFailures struct {
	mu     sync.Mutex
	bucket bucket
}

func newPairingFailures(limits Limits, now time.Duration) *pairingFailures {
	return &pairingFailures{
		mu:     sync.Mutex{},
		bucket: newBucket(limits.PairingFailureBurst, limits.PairingFailureRefill, now),
	}
}

func (p *pairingFailures) available(now time.Duration) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.bucket.available(now)
}

func (p *pairingFailures) fail(now time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.bucket.spend(now)
}

// NewPairing creates a single-use pairing code. The owner redeems it once with
// [Gateway.Exchange]; it expires on its own and dies with the audit. Up to four
// offers may be outstanding.
func (g *Gateway) NewPairing(opts PairingOptions) (PairingOffer, error) {
	ttl := opts.TTL
	if ttl == 0 {
		ttl = DefaultPairingTTL
	}
	if ttl < MinPairingTTL || ttl > MaxPairingTTL {
		return PairingOffer{}, invalidOption("pairing ttl must be between 30s and 15m")
	}
	code, err := newPairingCode()
	if err != nil {
		return PairingOffer{}, err
	}
	id, err := randomHex(idBytes)
	if err != nil {
		return PairingOffer{}, err
	}
	digest := g.keyedDigest(pairingDomain, g.id, code)
	now := g.cfg.Clock.Now()
	if !g.observe(now) {
		return PairingOffer{}, ErrAuditEnded
	}

	g.mu.Lock()
	if g.state != StateActive {
		g.mu.Unlock()
		return PairingOffer{}, ErrAuditEnded
	}
	if ttl = min(ttl, g.expires.remaining(now)); ttl <= 0 {
		g.mu.Unlock()
		return PairingOffer{}, ErrAuditEnded
	}
	slot := -1
	for i := range g.offers {
		if g.offers[i].live && g.offers[i].expires.reached(now) {
			g.offers[i] = emptyOffer()
		}
		if !g.offers[i].live && slot < 0 {
			slot = i
		}
	}
	if slot < 0 {
		g.mu.Unlock()
		return PairingOffer{}, ErrPairingLimit
	}
	expires := deadlineAfter(now, ttl)
	g.offers[slot] = pairingOffer{live: true, id: id, digest: digest, expires: expires}
	g.mu.Unlock()

	g.emit(g.event(EventPairingOffered, "", "", "", ""))
	return PairingOffer{ID: id, Code: groupPairingCode(code), ExpiresAt: expires.wall}, nil
}

// Exchange redeems a pairing code for a new credential and hands the secret to
// channel. It is the only way a credential is created.
//
// The code is checked against every outstanding offer in constant time, and a
// code that is wrong, expired, already used or malformed produces the same
// [ErrPairingInvalid]. Failed attempts are rate limited, and when the limit is
// hit the code is not examined at all. A code is spent the moment it is
// accepted: if delivery then fails there is no credential and the owner pairs
// again. The secret is cleared after delivery; the gateway keeps a keyed
// digest only. A credential is never created at the cost of the eight-active
// limit while its offer is left unspent: [ErrCredentialLimit] leaves the offer
// valid.
func (g *Gateway) Exchange(
	ctx context.Context, code string, channel SecretChannel, opts ExchangeOptions,
) (CredentialInfo, error) {
	now := g.cfg.Clock.Now()
	if !g.observe(now) {
		return CredentialInfo{}, ErrAuditEnded
	}
	if !g.pairing.available(now.Mono) {
		g.emit(g.event(EventPairingRejected, "rate_limited", "", "", ""))
		return CredentialInfo{}, ErrPairingRateLimited
	}
	normalized, wellFormed := normalizePairingCode(code)
	digest := g.keyedDigest(pairingDomain, g.id, normalized)

	secret, err := g.mint()
	if err != nil {
		return CredentialInfo{}, err
	}
	defer clear(secret.secret)

	var events []Event
	g.mu.Lock()
	index, found := g.matchOfferLocked(&digest)
	if !found || !wellFormed || g.offers[index].expires.reached(now) {
		g.mu.Unlock()
		g.pairing.fail(now.Mono)
		g.emit(g.event(EventPairingRejected, "invalid", "", "", ""))
		return CredentialInfo{}, ErrPairingInvalid
	}
	place, err := g.placeLocked(now, opts.CredentialTTL, &secret, &events)
	if err != nil {
		g.mu.Unlock()
		g.emitAll(events)
		return CredentialInfo{}, err
	}
	g.offers[index] = emptyOffer()
	g.mu.Unlock()
	g.emitAll(events)

	issued := IssuedCredential{
		AuditID:      g.id,
		CredentialID: secret.id,
		Username:     secret.username,
		Secret:       secret.secret,
		Realm:        g.realm,
		Origin:       g.origin,
		ExpiresAt:    place.expires.wall,
	}
	if err = channel.Deliver(ctx, issued); err != nil {
		g.abandon(secret.id, place.index)
		channel.Discard(ctx, secret.id)
		return CredentialInfo{}, errors.Join(ErrDelivery, err)
	}
	if err = g.activate(secret.id, place.index); err != nil {
		// The credential ended while its secret was being delivered: the
		// secret is dead, so do not leave it lying around.
		channel.Discard(ctx, secret.id)
		return CredentialInfo{}, err
	}
	g.emit(g.event(EventPairingRedeemed, "", secret.id, "", ""))
	g.emit(g.event(EventCredentialIssued, "", secret.id, "", ""))
	return CredentialInfo{
		AuditID:   g.id,
		ID:        secret.id,
		Username:  secret.username,
		Realm:     g.realm,
		Origin:    g.origin,
		CreatedAt: place.created,
		ExpiresAt: place.expires.wall,
	}, nil
}

// matchOfferLocked compares a digest with every offer slot, in constant time
// per slot and whatever the outcome, and returns the matching slot's index and
// whether any slot matched. g.mu must be held.
func (g *Gateway) matchOfferLocked(digest *[sha256.Size]byte) (int, bool) {
	hit, selected := 0, 0
	for i := range g.offers {
		offer := &g.offers[i]
		live := subtle.ConstantTimeByteEq(boolByte(offer.live), 1)
		equal := subtle.ConstantTimeCompare(digest[:], offer.digest[:]) & live
		selected = subtle.ConstantTimeSelect(equal, i, selected)
		hit |= equal
	}
	return selected, hit == 1
}

func boolByte(b bool) uint8 {
	if b {
		return 1
	}
	return 0
}

// newPairingCode draws pairingCodeLength symbols from pairingAlphabet. The
// alphabet has exactly 32 symbols, so taking five bits per symbol is uniform.
func newPairingCode() (string, error) {
	raw := make([]byte, pairingCodeLength)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	code := make([]byte, pairingCodeLength)
	for i, b := range raw {
		code[i] = pairingAlphabet[int(b)&(1<<bitsPerSymbol-1)]
	}
	return string(code), nil
}

// groupPairingCode formats a code as dash-separated groups for reading aloud
// and typing.
func groupPairingCode(code string) string {
	var out strings.Builder
	for i := 0; i < len(code); i += pairingGroup {
		if i > 0 {
			out.WriteByte('-')
		}
		out.WriteString(code[i:min(i+pairingGroup, len(code))])
	}
	return out.String()
}

// normalizePairingCode accepts a code as typed: any case, with dashes and
// spaces ignored. A text that is not exactly one code returns false, together
// with a placeholder of the right shape so the caller does the same work for
// every input.
func normalizePairingCode(input string) (string, bool) {
	if len(input) > maxTypedCodeLength {
		return placeholderCode(), false
	}
	var out strings.Builder
	for i := range len(input) {
		c := input[i]
		switch {
		case c == '-' || c == ' ':
			continue
		case c >= 'a' && c <= 'z':
			c -= 'a' - 'A'
		}
		if strings.IndexByte(pairingAlphabet, c) < 0 {
			return placeholderCode(), false
		}
		out.WriteByte(c)
	}
	if out.Len() != pairingCodeLength {
		return placeholderCode(), false
	}
	return out.String(), true
}

// placeholderCode is what a malformed code is replaced with, so the caller
// does the same digest and comparison work for every input.
func placeholderCode() string {
	return strings.Repeat(string(pairingAlphabet[0]), pairingCodeLength)
}

// emptyOffer is a free offer slot.
func emptyOffer() pairingOffer {
	var none pairingOffer
	return none
}
