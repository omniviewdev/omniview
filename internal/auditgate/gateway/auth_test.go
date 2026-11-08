package gateway_test

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

func basicHeader(username, secret string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+secret))
}

// sameDenial fails unless res is the uniform unauthorized response: the same
// status, challenge, headers and bytes whatever the cause.
func sameDenial(t *testing.T, name string, reference, res response) {
	t.Helper()
	if res.status != reference.status || res.body != reference.body {
		t.Errorf("%s: got %d %q, want the uniform %d %q", name, res.status, res.body, reference.status, reference.body)
	}
	for _, header := range []string{"Www-Authenticate", "Content-Type", "Content-Length", "Cache-Control"} {
		if got, want := res.header.Get(header), reference.header.Get(header); got != want {
			t.Errorf("%s: header %s = %q, want %q", name, header, got, want)
		}
	}
}

func TestEveryCredentialDenialIsTheSameResponse(t *testing.T) {
	// The table makes dozens of failed attempts from one address on purpose.
	h := newHarness(t, func(c *gateway.Config) { c.Limits.FailureBurst = 1000 })
	good := h.pair()
	b := h.browser(laptop, good)

	reference := b.send(request{path: "/", anonymous: true})
	if reference.status != http.StatusUnauthorized {
		t.Fatalf("anonymous request = %d, want 401", reference.status)
	}
	if !strings.Contains(reference.header.Get("WWW-Authenticate"), `realm="`+h.gw.Realm()+`"`) {
		t.Fatalf("challenge %q does not carry the audit realm", reference.header.Get("WWW-Authenticate"))
	}
	if !strings.Contains(reference.body, "audit_unauthorized") {
		t.Fatalf("body %q does not carry the stable code", reference.body)
	}

	valid := b.basic()
	zeroUser := "0123456789abcdef"
	// The last character of a secret carries only four of its bits, so "A" is
	// the real one for one secret in sixteen: use another character then.
	lastOff := "A"
	if strings.HasSuffix(good.secret, "A") {
		lastOff = "E"
	}
	cases := map[string]http.Header{
		"unknown user":            {"Authorization": {basicHeader(zeroUser, good.secret)}},
		"wrong secret":            {"Authorization": {basicHeader(good.username, strings.Repeat("A", 43))}},
		"last character off":      {"Authorization": {basicHeader(good.username, good.secret[:42]+lastOff)}},
		"upper case user":         {"Authorization": {basicHeader(strings.ToUpper(good.username), good.secret)}},
		"secret outside alphabet": {"Authorization": {basicHeader(good.username, strings.Repeat("+", 43))}},
		"short secret":            {"Authorization": {basicHeader(good.username, good.secret[:20])}},
		"long secret":             {"Authorization": {basicHeader(good.username, good.secret+"A")}},
		"swapped fields":          {"Authorization": {basicHeader(good.secret[:16], good.username)}},
		"bearer scheme":           {"Authorization": {"Bearer " + good.secret}},
		"digest scheme":           {"Authorization": {`Digest username="` + good.username + `", response="x"`}},
		"bare scheme":             {"Authorization": {"Basic"}},
		"not base64":              {"Authorization": {"Basic !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"}},
		"padding appended":        {"Authorization": {valid + "="}},
		"two spaces":              {"Authorization": {strings.Replace(valid, "Basic ", "Basic  ", 1)}},
		"duplicate header":        {"Authorization": {valid, valid}},
		"oversized header":        {"Authorization": {valid + strings.Repeat("A", 20<<10)}},
		"proxy authorization":     {"Proxy-Authorization": {valid}},
		"credential in cookie":    {"Cookie": {"auth=" + good.secret}},
		"credential in custom":    {"X-Audit-Token": {good.secret}},
	}
	for name, header := range cases {
		res := b.send(request{path: "/", header: header, anonymous: true})
		sameDenial(t, name, reference, res)
	}

	// A credential in the query string or the path is not a credential.
	sameDenial(t, "query password", reference,
		b.send(request{path: "/?password=" + good.secret, anonymous: true}))
	sameDenial(t, "query token", reference,
		b.send(request{path: "/assets/app.js?access_token=" + good.secret, anonymous: true}))

	if hits := h.up.Hits(); hits != 0 {
		t.Fatalf("%d denied requests reached the upstream", hits)
	}
	if res := b.get("/"); res.status != http.StatusOK {
		t.Fatalf("the real credential no longer works after the denials: %d", res.status)
	}
}

func TestBasicSchemeNameIsCaseInsensitive(t *testing.T) {
	h := newHarness(t)
	good := h.pair()
	b := h.browser(laptop, good)
	for _, scheme := range []string{"basic", "BASIC", "bAsIc"} {
		header := http.Header{"Authorization": {scheme + " " + strings.TrimPrefix(b.basic(), "Basic ")}}
		if res := b.send(request{path: "/", header: header, anonymous: true}); res.status != http.StatusOK {
			t.Errorf("scheme %q = %d, want 200", scheme, res.status)
		}
	}
}

func TestPeerDenialsLookLikeCredentialDenials(t *testing.T) {
	cases := map[string]struct {
		peer         gateway.Peer
		err          error
		unregistered bool
	}{
		"another user's node": {peer: gateway.Peer{UserID: otherUserID, NodeID: "node-x"}},
		"tagged node":         {peer: gateway.Peer{UserID: ownerID, NodeID: "node-tag", Tagged: true}},
		"tagged without user": {peer: gateway.Peer{UserID: "", NodeID: "node-tag", Tagged: true}},
		"no node ID":          {peer: gateway.Peer{UserID: ownerID, NodeID: ""}},
		"no user ID":          {peer: gateway.Peer{UserID: "", NodeID: "node-x"}},
		"ambiguous mapping":   {err: gateway.ErrPeerAmbiguous},
		"daemon error":        {err: errors.New("local daemon unreachable")},
		"unknown address":     {unregistered: true},
	}
	h := newHarness(t)
	good := h.pair()
	reference := h.browser(laptop, good).send(request{path: "/", anonymous: true})
	for name, tc := range cases {
		b := h.browser(tc.peer, good)
		b.err, b.unregistered = tc.err, tc.unregistered
		sameDenial(t, name, reference, b.send(request{path: "/"}))
	}
	if hits := h.up.Hits(); hits != 0 {
		t.Fatalf("%d requests from denied peers reached the upstream", hits)
	}

	// A denied peer neither pins the credential nor uses up its one-node binding.
	if res := h.browser(laptop, good).get("/"); res.status != http.StatusOK {
		t.Fatalf("the owner's node was refused after the denials: %d", res.status)
	}
	status := h.gw.Status()
	if len(status.Credentials) != 1 || status.Credentials[0].Node != laptop.NodeID {
		t.Fatalf("credential should be pinned to the first allowed node, got %+v", status.Credentials)
	}
}

func TestSelfPeerIsRefusedUnlessAllowed(t *testing.T) {
	for _, allow := range []bool{false, true} {
		t.Run(fmt.Sprintf("allow=%v", allow), func(t *testing.T) {
			h := newHarness(t, func(c *gateway.Config) {
				c.LocalNodeID = laptop.NodeID
				c.AllowSelf = allow
			})
			b := h.browser(laptop, h.pair())
			want := http.StatusUnauthorized
			if allow {
				want = http.StatusOK
			}
			if res := b.get("/"); res.status != want {
				t.Fatalf("self peer with AllowSelf=%v = %d, want %d", allow, res.status, want)
			}
		})
	}
}

func TestAuthorityDenialsLookLikeCredentialDenials(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Limits.FailureBurst = 1000 })
	good := h.pair()
	b := h.browser(laptop, good)
	reference := b.send(request{path: "/", anonymous: true})
	authorization := "Authorization: " + b.basic() + "\r\n"
	authority := h.authority()
	// get builds a GET for / with the given Host line and request target.
	get := func(target, host string) string {
		return "GET " + target + " HTTP/1.1\r\nHost: " + host + "\r\n" + authorization + "Connection: close\r\n\r\n"
	}

	raws := map[string]string{
		"other host":             get("/", "evil.example"),
		"ip literal":             get("/", net.JoinHostPort("127.0.0.1", strconv.Itoa(h.port))),
		"port missing":           get("/", serverName),
		"wrong port":             get("/", net.JoinHostPort(serverName, "1")),
		"trailing dot":           get("/", h.authorityFor(serverName+".")),
		"suffix alias":           get("/", h.authorityFor(serverName+".evil.example")),
		"absolute form":          get("https://"+authority+"/", authority),
		"absolute form userinfo": get("https://u:p@"+authority+"/", authority),
		"connect":                "CONNECT " + authority + " HTTP/1.1\r\nHost: " + authority + "\r\n" + authorization + "Connection: close\r\n\r\n",
		"asterisk":               "OPTIONS * HTTP/1.1\r\nHost: " + authority + "\r\n" + authorization + "Connection: close\r\n\r\n",
	}
	for name, text := range raws {
		status, header, body := b.raw(text)
		got := response{status: status, header: header, body: body}
		sameDenial(t, name, reference, got)
	}
	// net/http refuses a Host header with userinfo before the gateway runs.
	if status, _, _ := b.raw(get("/", "user@"+authority)); status != http.StatusBadRequest {
		t.Fatalf("Host with userinfo = %d, want net/http's 400", status)
	}
	if hits := h.up.Hits(); hits != 0 {
		t.Fatalf("%d requests with a wrong authority reached the upstream", hits)
	}

	// The configured name matches whatever its case.
	if status, _, _ := b.raw(get("/", h.authorityFor(strings.ToUpper(serverName)))); status != http.StatusOK {
		t.Fatalf("upper-case host name = %d, want 200", status)
	}
}

func TestCredentialIsPinnedToTheFirstNode(t *testing.T) {
	h := newHarness(t)
	good := h.pair()
	reference := h.browser(laptop, good).send(request{path: "/", anonymous: true})
	first := h.browser(laptop, good)
	second := h.browser(phone, good)

	if res := first.get("/"); res.status != http.StatusOK {
		t.Fatalf("first node = %d, want 200", res.status)
	}
	hits := h.up.Hits()
	sameDenial(t, "second node", reference, second.send(request{path: "/"}))
	if h.up.Hits() != hits {
		t.Fatal("a request from a node the credential is not pinned to reached the upstream")
	}
	if res := first.get("/"); res.status != http.StatusOK {
		t.Fatalf("pinned node = %d after the other node was refused, want 200", res.status)
	}
	if got := h.events.count(gateway.EventCredentialPinned); got != 1 {
		t.Fatalf("credential_pinned events = %d, want 1", got)
	}
	for _, event := range h.events.all() {
		if event.Kind == gateway.EventCredentialPinned && event.NodeID != laptop.NodeID {
			t.Fatalf("pinned to %q, want %q", event.NodeID, laptop.NodeID)
		}
	}
}

func TestPinningIsDecidedOnceWhenNodesRace(t *testing.T) {
	for range 5 {
		h := newHarness(t)
		good := h.pair()
		nodes := []*browser{h.browser(laptop, good), h.browser(phone, good)}
		var wg sync.WaitGroup
		var mu sync.Mutex
		winners := map[string]int{}
		for _, node := range nodes {
			for range 6 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					res, err := node.sendErr(request{path: "/health"})
					if err == nil && res.status == http.StatusOK {
						mu.Lock()
						winners[node.peer.NodeID]++
						mu.Unlock()
					}
				}()
			}
		}
		wg.Wait()
		if len(winners) != 1 {
			t.Fatalf("both nodes authenticated with one credential: %v", winners)
		}
	}
}

func TestCredentialFromAnotherAuditIsRefused(t *testing.T) {
	first := newHarness(t)
	stolen := first.pair()
	second := newHarness(t)
	b := second.browser(laptop, stolen)
	if res := b.get("/"); res.status != http.StatusUnauthorized {
		t.Fatalf("a credential of another audit = %d, want 401", res.status)
	}
	if first.gw.Realm() == second.gw.Realm() {
		t.Fatal("two audits share a realm")
	}
}

func TestRevokedCredentialIsRefusedEvenWhenCached(t *testing.T) {
	h := newHarness(t)
	good := h.pair()
	b := h.browser(laptop, good)
	if res := b.get("/"); res.status != http.StatusOK {
		t.Fatalf("before revoke = %d", res.status)
	}
	if err := h.gw.Revoke(t.Context(), good.info.ID); err != nil {
		t.Fatal(err)
	}
	if res := b.get("/"); res.status != http.StatusUnauthorized {
		t.Fatalf("revoked credential = %d, want 401", res.status)
	}
	// A new credential works; the old one stays dead.
	fresh := h.browser(laptop, h.pair())
	if res := fresh.get("/"); res.status != http.StatusOK {
		t.Fatalf("replacement credential = %d", res.status)
	}
	if res := b.get("/"); res.status != http.StatusUnauthorized {
		t.Fatalf("revoked credential came back: %d", res.status)
	}
	if err := h.gw.Revoke(t.Context(), "no-such-credential"); !errors.Is(err, gateway.ErrCredentialNotFound) {
		t.Fatalf("revoking an unknown credential = %v, want ErrCredentialNotFound", err)
	}
}

func TestAtMostEightCredentialsAreActive(t *testing.T) {
	h := newHarness(t)
	var issued []credential
	for range gateway.MaxActiveCredentials {
		issued = append(issued, h.pair())
	}
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	channel := &memoryChannel{}
	if _, err = h.gw.Exchange(t.Context(), offer.Code, channel, gateway.ExchangeOptions{}); !errors.Is(err, gateway.ErrCredentialLimit) {
		t.Fatalf("ninth credential = %v, want ErrCredentialLimit", err)
	}
	if channel.secret != "" {
		t.Fatal("a secret was delivered although the credential was refused")
	}
	// The refused exchange did not spend the code: free a place and retry.
	if err = h.gw.Revoke(t.Context(), issued[0].info.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = h.gw.Exchange(t.Context(), offer.Code, channel, gateway.ExchangeOptions{}); err != nil {
		t.Fatalf("exchange after freeing a place: %v", err)
	}
}

func TestFailedAttemptsAreRateLimitedWhateverTheCredential(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.FailureBurst = 3
		c.Limits.FailureRefill = time.Minute
	})
	good := h.pair()
	b := h.browser(laptop, good)
	wrong := http.Header{"Authorization": {basicHeader(good.username, strings.Repeat("B", 43))}}
	for i := range 3 {
		if res := b.send(request{path: "/", header: wrong, anonymous: true}); res.status != http.StatusUnauthorized {
			t.Fatalf("attempt %d = %d, want 401", i, res.status)
		}
	}
	limited := b.send(request{path: "/", header: wrong, anonymous: true})
	if limited.status != http.StatusTooManyRequests {
		t.Fatalf("fourth failed attempt = %d, want 429", limited.status)
	}
	// While limited, the right credential is refused the same way, so the
	// limiter shows nothing about the credential.
	right := b.send(request{path: "/"})
	if right.status != http.StatusTooManyRequests || right.body != limited.body {
		t.Fatalf("correct credential while limited = %d %q, want %d %q", right.status, right.body, limited.status, limited.body)
	}
	// A request with no credential at all is not an attempt, but is refused
	// while the address is limited.
	h.clock.Advance(2 * time.Minute)
	if res := b.get("/"); res.status != http.StatusOK {
		t.Fatalf("after the limiter refilled = %d, want 200", res.status)
	}
}

func TestRequestsWithoutCredentialsCountAsRefusedAttempts(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.FailureBurst = 2
		c.Limits.FailureRefill = 10 * time.Minute
	})
	b := h.browser(laptop, h.pair())
	// A browser makes one credential-less request before it prompts. It costs
	// one place of a burst, so the owner is not locked out by it, but a peer
	// that sends nothing but credential-less requests is bounded like one that
	// guesses.
	for i := range 2 {
		if res := b.send(request{path: "/", anonymous: true}); res.status != http.StatusUnauthorized {
			t.Fatalf("credential-less request %d = %d, want 401", i, res.status)
		}
	}
	limited := b.send(request{path: "/", anonymous: true})
	if limited.status != http.StatusTooManyRequests || !strings.Contains(limited.body, "audit_unauthorized") {
		t.Fatalf("third credential-less request = %d %q, want 429", limited.status, limited.body)
	}
	// While the address is limited even the right credential waits.
	if res := b.get("/"); res.status != http.StatusTooManyRequests {
		t.Fatalf("credentialed request while limited = %d, want 429", res.status)
	}
	if h.peers.lookups.Load() > 3 {
		t.Fatalf("%d peer lookups: a limited request must not cost one", h.peers.lookups.Load())
	}
	h.clock.Advance(25 * time.Minute) // two tokens back, and still inside the audit's hour
	if res := b.get("/"); res.status != http.StatusOK {
		t.Fatalf("credentialed request after the allowance refilled = %d, want 200", res.status)
	}
}

func TestRequestsThatAuthenticateAreNeverCounted(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.FailureBurst = 2
		c.Limits.FailureRefill = time.Hour
	})
	b := h.browser(laptop, h.pair())
	for i := range 50 {
		if res := b.get("/health"); res.status != http.StatusOK {
			t.Fatalf("authenticated request %d = %d, want 200", i, res.status)
		}
	}
}

func TestUnauthenticatedWorkIsBoundedPerAddress(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.MaxUnauthenticatedPerAddress = 1
		c.Timeouts.PeerLookup = 5 * time.Second
	})
	good := h.pair()
	b := h.browser(laptop, good)
	if res := b.get("/health"); res.status != http.StatusOK {
		t.Fatal("warm-up request failed")
	}
	release := h.peers.hold()
	defer release()
	lookups := h.peers.lookups.Load()

	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = h.browser(laptop, good).sendErr(request{path: "/"})
	}()
	eventually(t, 5*time.Second, "a lookup in flight", func() bool { return h.peers.lookups.Load() > lookups })

	// The place of this address is taken: the next request from it is refused
	// before it costs a lookup, though the audit as a whole has room.
	res := h.browser(laptop, good).send(request{path: "/", anonymous: true})
	if res.status != http.StatusTooManyRequests || !strings.Contains(res.body, "audit_unauthorized") {
		t.Fatalf("second request from one address = %d %q, want 429", res.status, res.body)
	}
	if h.peers.lookups.Load() != lookups+1 {
		t.Fatalf("lookups = %d, want only the held one (%d)", h.peers.lookups.Load(), lookups+1)
	}
	release()
	<-done
}

func TestUnauthenticatedWorkIsBounded(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Limits.MaxUnauthenticated = 2
		c.Timeouts.PeerLookup = 5 * time.Second
	})
	good := h.pair()
	b := h.browser(laptop, good)
	if res := b.get("/health"); res.status != http.StatusOK {
		t.Fatal("warm-up request failed")
	}
	release := h.peers.hold()
	defer release()

	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			other := h.browser(laptop, good)
			_, _ = other.sendErr(request{path: "/"})
		}()
	}
	eventually(t, 5*time.Second, "two lookups in flight", func() bool { return h.peers.lookups.Load() >= 3 })

	third := h.browser(laptop, good)
	res := third.send(request{path: "/", anonymous: true})
	if res.status != http.StatusTooManyRequests || !strings.Contains(res.body, "audit_unauthorized") {
		t.Fatalf("request over the unauthenticated limit = %d %q", res.status, res.body)
	}
	release()
	wg.Wait()
}
