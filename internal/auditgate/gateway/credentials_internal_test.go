package gateway

import (
	"crypto/sha256"
	"strings"
	"testing"
	"time"
)

func TestMatchExaminesEverySlotWhateverTheOutcome(t *testing.T) {
	var table credentialTable
	// Fill alternating slots with distinct credentials.
	for i := 0; i < credentialSlots; i += 2 {
		s := &table.slots[i]
		s.state = slotActive
		copy(s.username[:], strings.Repeat(string(rune('a'+i/2)), usernameLength))
		s.digest = sha256.Sum256([]byte{byte(i)})
	}

	probe := func(name string, user [usernameLength]byte, digest [sha256.Size]byte, wantFound bool, wantIndex int) {
		t.Helper()
		index, found, compared := table.match(&user, &digest)
		if compared != credentialSlots {
			t.Errorf("%s: compared %d slots, want all %d", name, compared, credentialSlots)
		}
		if found != wantFound || (found && index != wantIndex) {
			t.Errorf("%s: found=%v index=%d, want found=%v index=%d", name, found, index, wantFound, wantIndex)
		}
	}
	for i := 0; i < credentialSlots; i += 2 {
		probe("every position", table.slots[i].username, table.slots[i].digest, true, i)
	}
	var zeroUser [usernameLength]byte
	var zeroDigest [sha256.Size]byte
	known := table.slots[4]
	probe("unknown user and digest", [usernameLength]byte([]byte("zzzzzzzzzzzzzzzz")), sha256.Sum256([]byte("x")), false, 0)
	probe("right user, wrong digest", known.username, sha256.Sum256([]byte("x")), false, 0)
	probe("wrong user, right digest", [usernameLength]byte([]byte("zzzzzzzzzzzzzzzz")), known.digest, false, 0)
	probe("a different slot's digest", known.username, table.slots[6].digest, false, 0)
	// A free slot's zero values are not a credential.
	probe("zero user and digest", zeroUser, zeroDigest, false, 0)
}

func TestVerificationDoesTheSameWorkForEveryOutcome(t *testing.T) {
	gw, clock := newTestGateway(t)
	username, secret := issueForTest(t, gw, clock)
	_, otherSecret := issueForTest(t, gw, clock)
	now := clock.Now()

	type attempt struct {
		name     string
		username string
		secret   string
		node     string
		eligible bool
		want     string
		wantOK   bool
	}
	attempts := []attempt{
		{"right credential", username, secret, "node-1", true, "", true},
		{"unknown user", "0123456789abcdef", secret, "node-1", true, denyCredentialUnknown, false},
		{"wrong secret", username, otherSecret, "node-1", true, denyCredentialUnknown, false},
		{"right credential, ineligible peer", username, secret, "node-1", false, denyCredentialIneligible, false},
		{"right credential, other node", username, secret, "node-2", true, denyCredentialNode, false},
	}
	for _, a := range attempts {
		check, compared := gw.verifyCounted(a.username, a.secret, a.node, a.eligible, now)
		if compared != credentialSlots {
			t.Errorf("%s: examined %d slots, want %d", a.name, compared, credentialSlots)
		}
		if check.ok != a.wantOK || check.denial != a.want {
			t.Errorf("%s: ok=%v denial=%q, want ok=%v denial=%q", a.name, check.ok, check.denial, a.wantOK, a.want)
		}
	}
}

func TestADigestMeansNothingInAnotherAuditOrWithAnotherKey(t *testing.T) {
	first, _ := newTestGateway(t)
	second, _ := newTestGateway(t)
	a := first.credentialDigest(testUsername, testSecret)
	if a != first.credentialDigest(testUsername, testSecret) {
		t.Fatal("a digest is not stable")
	}
	if a == second.credentialDigest(testUsername, testSecret) {
		t.Fatal("two audits produce the same digest for one credential")
	}
	if a == first.credentialDigest(testUsername, testSecret[:42]+"B") || a == first.credentialDigest("fedcba9876543210", testSecret) {
		t.Fatal("a digest does not cover both the username and the secret")
	}
	if first.keyedDigest(credentialDomain, first.id, "x", "y") == first.keyedDigest(pairingDomain, first.id, "x", "y") {
		t.Fatal("credential and pairing digests are not domain separated")
	}
}

func TestACredentialThatNeverGetsItsSecretFreesItsPlace(t *testing.T) {
	gw, clock := newTestGateway(t)
	for i := range MaxActiveCredentials {
		m, err := gw.mint()
		if err != nil {
			t.Fatal(err)
		}
		var events []Event
		gw.mu.Lock()
		place, placeErr := gw.placeLocked(clock.Now(), 0, &m, &events)
		gw.mu.Unlock()
		if placeErr != nil {
			t.Fatalf("credential %d: %v", i, placeErr)
		}
		// A pending credential holds its place but cannot authenticate.
		check := gw.verifyCredential(m.username, string(m.secret), "node", true, clock.Now())
		if check.ok {
			t.Fatal("a credential that was not activated authenticated")
		}
		if i < MaxActiveCredentials-1 {
			if err = gw.activate(m.id, place.index); err != nil {
				t.Fatal(err)
			}
			continue
		}
		// The last one is abandoned, as a failed delivery does.
		gw.abandon(m.id, place.index)
	}
	m, err := gw.mint()
	if err != nil {
		t.Fatal(err)
	}
	var events []Event
	gw.mu.Lock()
	_, err = gw.placeLocked(clock.Now(), 0, &m, &events)
	gw.mu.Unlock()
	if err != nil {
		t.Fatalf("a place was not freed by the abandoned credential: %v", err)
	}
}

func TestEndedCredentialsAreReusedOldestFirstAndNeverCountAsActive(t *testing.T) {
	gw, clock := newTestGateway(t)
	var ids []string
	// Each credential lives a minute and has ended before the next is made, so
	// more credentials pass through the table than it has slots.
	for i := range credentialSlots + 2 {
		m, err := gw.mint()
		if err != nil {
			t.Fatal(err)
		}
		var events []Event
		gw.mu.Lock()
		place, placeErr := gw.placeLocked(clock.Now(), time.Minute, &m, &events)
		gw.mu.Unlock()
		if placeErr != nil {
			t.Fatalf("credential %d: %v", i, placeErr)
		}
		if err = gw.activate(m.id, place.index); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, m.id)
		clock.advance(2 * time.Minute)
	}
	gw.mu.Lock()
	defer gw.mu.Unlock()
	if held := gw.table.holding(clock.Now()); held != 0 {
		t.Fatalf("%d expired credentials still count as active", held)
	}
	// The two oldest were overwritten; the newest are still remembered.
	for i, id := range ids {
		if remembered := gw.table.find(id) >= 0; remembered != (i >= 2) {
			t.Errorf("credential %d remembered=%v, want %v", i, remembered, i >= 2)
		}
	}
}

func TestACredentialPastItsDeadlineNeverAuthenticatesOrHoldsAPlace(t *testing.T) {
	now := Instant{Wall: time.Date(2026, time.November, 8, 12, 0, 0, 0, time.UTC), Mono: time.Hour}
	slot := credentialSlot{state: slotActive, expires: deadlineAfter(now, time.Minute)}
	if !slot.live(now) || !slot.holdsPlace(now) {
		t.Fatal("a fresh credential is not usable")
	}
	later := Instant{Wall: now.Wall.Add(time.Minute), Mono: now.Mono}
	if slot.live(later) || slot.holdsPlace(later) {
		t.Fatal("a credential whose state still says active outlived its deadline")
	}
	for _, state := range []slotState{slotPending, slotRevoked, slotExpired, slotFree} {
		slot.state = state
		if slot.live(now) {
			t.Errorf("state %d authenticates", state)
		}
	}
}
