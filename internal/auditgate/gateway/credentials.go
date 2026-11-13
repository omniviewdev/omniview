package gateway

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"time"

	"github.com/omniviewdev/omniview/internal/devsession"
)

const (
	// MaxActiveCredentials is how many credentials one audit may have at once.
	MaxActiveCredentials = 8
	// credentialSlots is the fixed size of the credential table: the active
	// credentials plus room to keep recently ended ones until their slot is
	// needed. Every verification compares against every slot.
	credentialSlots = 2 * MaxActiveCredentials

	idBytes = 8
	// auditIDBytes is the size of an audit's ID: twice a credential's.
	auditIDBytes = 2 * idBytes
	// usernameBytes is the random bytes behind a username's hex digits.
	usernameBytes = usernameLength / 2

	credentialDomain = "omniview-audit-credential-v1" //nolint:gosec // G101: a digest domain label, not a credential.
	pairingDomain    = "omniview-audit-pairing-v1"
)

type slotState uint8

const (
	slotFree slotState = iota
	// slotPending is a credential whose secret has not yet been delivered. It
	// holds a place but cannot authenticate.
	slotPending
	slotActive
	slotRevoked
	slotExpired
)

// credentialSlot is one credential. It holds a keyed digest of the secret,
// never the secret.
type credentialSlot struct {
	state    slotState
	id       string
	username [usernameLength]byte
	digest   [sha256.Size]byte
	created  time.Time
	expires  deadline
	// node is the node that first authenticated with the credential. The
	// credential never authenticates from another node.
	node     string
	firstUse time.Time
	// opens limits how fast the credential may open events sockets.
	opens bucket
}

// live reports whether the credential can authenticate at now.
func (s *credentialSlot) live(now Instant) bool {
	return s.state == slotActive && !s.expires.reached(now)
}

// holdsPlace reports whether the credential counts toward
// MaxActiveCredentials: it is pending or active and has not reached its
// deadline.
func (s *credentialSlot) holdsPlace(now Instant) bool {
	return (s.state == slotPending || s.state == slotActive) && !s.expires.reached(now)
}

type credentialTable struct {
	slots [credentialSlots]credentialSlot
}

func (t *credentialTable) holding(now Instant) int {
	count := 0
	for i := range t.slots {
		if t.slots[i].holdsPlace(now) {
			count++
		}
	}
	return count
}

// claim returns a slot that can be overwritten: a free one, or else the
// oldest credential that no longer holds a place. Callers have already
// checked the limit, so one always exists.
func (t *credentialTable) claim(now Instant) (int, bool) {
	best := -1
	for i := range t.slots {
		s := &t.slots[i]
		if s.state == slotFree {
			return i, true
		}
		if s.holdsPlace(now) {
			continue
		}
		if best < 0 || s.created.Before(t.slots[best].created) {
			best = i
		}
	}
	return best, best >= 0
}

func (t *credentialTable) find(id string) int {
	for i := range t.slots {
		if t.slots[i].state != slotFree && t.slots[i].id == id {
			return i
		}
	}
	return -1
}

// match finds the slot with this username and digest. It compares against
// every slot, in constant time per slot and whatever the outcome, so neither
// the time taken nor the position of a record shows whether a username exists.
// compared reports the number of slots examined (always credentialSlots).
func (t *credentialTable) match(
	username *[usernameLength]byte, digest *[sha256.Size]byte,
) (int, bool, int) {
	hit, selected, compared := 0, 0, 0
	for i := range t.slots {
		s := &t.slots[i]
		inUse := 1 ^ subtle.ConstantTimeByteEq(byte(s.state), byte(slotFree))
		equal := subtle.ConstantTimeCompare(username[:], s.username[:]) &
			subtle.ConstantTimeCompare(digest[:], s.digest[:]) & inUse
		selected = subtle.ConstantTimeSelect(equal, i, selected)
		hit |= equal
		compared++
	}
	return selected, hit == 1, compared
}

// credentialDigest is the keyed digest stored in place of a secret. The key is
// random per audit and the audit ID is part of the message, so a digest means
// nothing in any other audit.
func (g *Gateway) credentialDigest(username, secret string) [sha256.Size]byte {
	return g.keyedDigest(credentialDomain, g.id, username, secret)
}

func (g *Gateway) keyedDigest(domain string, parts ...string) [sha256.Size]byte {
	mac := hmac.New(sha256.New, g.key[:])
	mac.Write([]byte(domain))
	for _, part := range parts {
		mac.Write([]byte{0})
		mac.Write([]byte(part))
	}
	var sum [sha256.Size]byte
	mac.Sum(sum[:0])
	return sum
}

func randomHex(n int) (string, error) {
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

// minted is a new credential before it is placed in the table.
type minted struct {
	id       string
	username string
	secret   []byte
	digest   [sha256.Size]byte
}

// mint creates the identity and the 256-bit secret of a credential. The
// secret is shaped like the control and supervisor tokens: the unpadded
// base64url text of 32 random bytes.
func (g *Gateway) mint() (minted, error) {
	id, err := randomHex(idBytes)
	if err != nil {
		return minted{}, err
	}
	username, err := randomHex(usernameBytes)
	if err != nil {
		return minted{}, err
	}
	secret, err := devsession.GenerateToken()
	if err != nil {
		return minted{}, err
	}
	return minted{
		id:       id,
		username: username,
		secret:   secret,
		digest:   g.credentialDigest(username, string(secret)),
	}, nil
}

// placement is a credential's place in the table while its secret is being
// delivered.
type placement struct {
	index   int
	expires deadline
	created time.Time
}

// placeLocked puts a new credential in the table as pending. The credential
// expires after ttl, or at the end of the audit if that comes first; a zero
// ttl means the rest of the audit. g.mu must be held.
func (g *Gateway) placeLocked(now Instant, ttl time.Duration, m *minted, events *[]Event) (placement, error) {
	if g.state != StateActive {
		return placement{}, ErrAuditEnded
	}
	g.expireCredentialsLocked(now, events)
	if g.table.holding(now) >= MaxActiveCredentials {
		return placement{}, ErrCredentialLimit
	}
	remaining := g.expires.remaining(now)
	if ttl <= 0 || ttl > remaining {
		ttl = remaining
	}
	if ttl <= 0 {
		return placement{}, ErrAuditEnded
	}
	index, ok := g.table.claim(now)
	if !ok {
		return placement{}, ErrCredentialLimit
	}
	slot := &g.table.slots[index]
	*slot = credentialSlot{
		state:    slotPending,
		id:       m.id,
		username: [usernameLength]byte([]byte(m.username)),
		digest:   m.digest,
		created:  now.Wall,
		expires:  deadlineAfter(now, ttl),
		node:     "",
		firstUse: time.Time{},
		opens:    newBucket(g.cfg.Limits.TunnelOpenBurst, g.cfg.Limits.TunnelOpenRefill, now.Mono),
	}
	return placement{index: index, expires: slot.expires, created: now.Wall}, nil
}

// activate makes a delivered credential usable. It fails if the audit ended
// ([ErrAuditEnded]) or if the credential was revoked, expired or lost its
// place while its secret was being delivered ([ErrCredentialEnded]).
//
// Delivery can take any time, and the sweep that marks an expired credential
// runs on its own schedule, so the deadline is checked here against the clock
// as it is now, whatever state the slot still claims.
func (g *Gateway) activate(id string, index int) error {
	now := g.cfg.Clock.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	slot := &g.table.slots[index]
	switch {
	case g.state != StateActive:
		return ErrAuditEnded
	case slot.state != slotPending || slot.id != id || slot.expires.reached(now):
		return ErrCredentialEnded
	}
	slot.state = slotActive
	return nil
}

// abandon frees the place of a credential whose secret was never delivered.
func (g *Gateway) abandon(id string, index int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	slot := &g.table.slots[index]
	if slot.state == slotPending && slot.id == id {
		var empty credentialSlot
		*slot = empty
	}
}

// expireCredentialsLocked ends credentials that reached their deadline and
// closes what they were serving. g.mu must be held.
func (g *Gateway) expireCredentialsLocked(now Instant, events *[]Event) {
	for i := range g.table.slots {
		slot := &g.table.slots[i]
		if (slot.state != slotActive && slot.state != slotPending) || !slot.expires.reached(now) {
			continue
		}
		wasActive := slot.state == slotActive
		slot.state = slotExpired
		g.cancelCredentialLocked(slot.id, errCredentialExpired)
		if wasActive {
			*events = append(*events, g.event(EventCredentialExpired, "", slot.id, slot.node, ""))
		}
	}
}

// credentialCheck is the outcome of verifying a presented credential.
type credentialCheck struct {
	ok         bool
	credential string
	// pinned is true when this call pinned the credential to its first node.
	pinned bool
	// denial is a bounded reason for diagnostics; empty when ok.
	denial string
}

// Credential denial reasons, for diagnostics only.
//
//nolint:gosec // G101: these are diagnostic codes, not credentials.
const (
	denyCredentialMalformed  = "credential_malformed"
	denyCredentialUnknown    = "credential_unknown"
	denyCredentialInactive   = "credential_inactive"
	denyCredentialNode       = "credential_node"
	denyCredentialIneligible = "credential_ineligible"
)

// verifyCredential checks a presented username and secret.
//
// It always computes one digest and compares it with every slot, whether or
// not the username exists, so the work does not depend on which factor is
// wrong. eligible says the earlier steps (peer identity, authority) passed;
// when they did not, the comparison still runs but the result is discarded
// and nothing is pinned.
func (g *Gateway) verifyCredential(username, secret, node string, eligible bool, now Instant) credentialCheck {
	check, _ := g.verifyCounted(username, secret, node, eligible, now)
	return check
}

// verifyCounted is verifyCredential that also reports how many slots the
// comparison examined, which is always all of them.
func (g *Gateway) verifyCounted(
	username, secret, node string, eligible bool, now Instant,
) (credentialCheck, int) {
	var name [usernameLength]byte
	copy(name[:], username)
	digest := g.credentialDigest(username, secret)

	g.mu.Lock()
	defer g.mu.Unlock()
	index, found, compared := g.table.match(&name, &digest)
	slot := &g.table.slots[index]
	switch {
	case !found:
		return credentialCheck{ok: false, credential: "", pinned: false, denial: denyCredentialUnknown}, compared
	case g.state != StateActive || !slot.live(now):
		return credentialCheck{ok: false, credential: slot.id, pinned: false, denial: denyCredentialInactive}, compared
	case !eligible || node == "":
		return credentialCheck{ok: false, credential: slot.id, pinned: false, denial: denyCredentialIneligible}, compared
	case slot.node != "" && slot.node != node:
		return credentialCheck{ok: false, credential: slot.id, pinned: false, denial: denyCredentialNode}, compared
	}
	pinned := slot.node == ""
	if pinned {
		slot.node = node
		slot.firstUse = now.Wall
	}
	return credentialCheck{ok: true, credential: slot.id, pinned: pinned, denial: ""}, compared
}
