package gateway_test

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/omniviewdev/omniview/internal/auditgate"
	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

const (
	instanceInfo = "main.AppService.GetInstanceInfo"
	createShell  = "github.com/omniviewdev/omniview/backend/pkg/plugin/exec.ServiceWrapper.CreateTerminal"
)

// call builds a runtime call body for a bound method.
func callBody(callID, method string, args string) string {
	return fmt.Sprintf(`{"object":0,"method":0,"args":{"call-id":%q,"methodName":%q,"args":[%s]}}`, callID, method, args)
}

// mustOpen opens the page's events socket and closes it when the test ends.
func mustOpen(t *testing.T, b *browser, label string) *socket {
	t.Helper()
	s, err := b.openEvents(label, false)
	if err != nil {
		body := ""
		if s != nil && s.resp != nil {
			body = s.resp.Status
		}
		t.Fatalf("open events socket %q: %v (%s)", label, err, body)
	}
	t.Cleanup(func() { _ = s.conn.CloseNow() })
	return s
}

func runtimeHeader(b *browser, label string) http.Header {
	return http.Header{
		"Content-Type":      {"application/json"},
		"X-Wails-Client-Id": {label},
		"Origin":            {b.origin()},
		"Sec-Fetch-Site":    {"same-origin"},
	}
}

func TestRuntimeCallsAreRebuiltAndSentUnderTheIssuedClientID(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	mustOpen(t, b, "pageA")

	// Valid but untidy: reordered keys, spaces, the method named by its ID.
	id := auditgate.MethodID(instanceInfo)
	messy := fmt.Sprintf(` { "method" : 0 , "object":0, "args": { "args": [ ], "methodID": %d, "call-id": "call1" } } `, id)
	header := runtimeHeader(b, "pageA")
	header.Set("Cookie", "sid=remote")
	header.Set("X-Forwarded-For", "203.0.113.9")
	header.Set("Forwarded", "for=203.0.113.9")
	header.Set("Tailscale-User-Login", "someone@example.com")
	header.Set("Referer", "https://elsewhere.example/")
	res := b.send(request{method: http.MethodPost, path: "/wails/runtime", header: header, body: messy})
	if res.status != http.StatusOK || !strings.Contains(res.body, `"ok":true`) {
		t.Fatalf("call = %d %q", res.status, res.body)
	}

	records := h.up.runtimeRecords()
	if len(records) != 1 {
		t.Fatalf("upstream saw %d calls, want 1", len(records))
	}
	got := records[0]
	canonical := regexp.MustCompile(
		`^\{"object":0,"method":0,"args":\{"call-id":"[0-9a-f]{16}\.call1",` +
			`"methodName":"main\.AppService\.GetInstanceInfo","args":\[\]\}\}$`)
	if !canonical.Match(got.Body) {
		t.Fatalf("the upstream received %q, not the gateway's canonical body", got.Body)
	}
	if strings.Contains(string(got.Body), " ") || string(got.Body) == messy {
		t.Fatal("the client's bytes reached the upstream")
	}
	if got.FQN != instanceInfo {
		t.Fatalf("the upstream ran %q, want %q", got.FQN, instanceInfo)
	}
	for _, name := range []string{
		"Authorization", "Cookie", "Forwarded", "X-Forwarded-For", "Tailscale-User-Login", "Referer",
		"X-Wails-Window-Name", "X-Wails-Window-Id", "Sec-Fetch-Site", "Proxy-Authorization",
	} {
		if got.Header.Get(name) != "" {
			t.Errorf("the upstream received %s: %q", name, got.Header.Get(name))
		}
	}
	upstreamID := got.Header.Get("X-Wails-Client-Id")
	if upstreamID == "" || upstreamID == "pageA" || !auditgate.ValidClientID(upstreamID) {
		t.Fatalf("the upstream received client ID %q, want one the gateway issued", upstreamID)
	}
	if ids := h.up.clientIDs(); len(ids) != 1 || ids[0] != upstreamID {
		t.Fatalf("events socket registered %v, call used %q", ids, upstreamID)
	}
	if want := "http://" + h.up.Address().String(); got.Header.Get("Origin") != want {
		t.Errorf("upstream Origin = %q, want %q", got.Header.Get("Origin"), want)
	}
	if !strings.HasPrefix(got.Window, "browser-") {
		t.Fatalf("the call ran as window %q, want the page's browser window", got.Window)
	}
}

func TestRefusedCallsNeverReachTheUpstream(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	mustOpen(t, b, "page")
	good := callBody("c1", instanceInfo, "")

	type probe struct {
		name   string
		body   string
		mutate func(http.Header)
		method string
		path   string
		reason string
	}
	with := func(name, body, reason string) probe { return probe{name: name, body: body, reason: reason} }
	probes := []probe{
		with("a method that opens a shell", callBody("c1", createShell, ""), "method_denied"),
		with("the same method by ID", fmt.Sprintf(
			`{"object":0,"method":0,"args":{"call-id":"c1","methodID":%d,"args":[]}}`, auditgate.MethodID(createShell)), "method_denied"),
		with("an unknown method", callBody("c1", "main.AppService.Nope", ""), "unknown_method"),
		with("a duplicate key", `{"object":0,"object":2,"method":0,"args":{"call-id":"c1","methodName":"`+instanceInfo+`","args":[]}}`, "duplicate_key"),
		with("a case-folded key", `{"object":0,"Object":2,"method":0,"args":{"call-id":"c1","methodName":"`+instanceInfo+`","args":[]}}`, "case_folded_key"),
		with("name and ID together", `{"object":0,"method":0,"args":{"call-id":"c1","methodName":"`+instanceInfo+`","methodID":1,"args":[]}}`, "method_selector"),
		with("an unknown runtime object", `{"object":2,"method":2}`, "runtime_denied"),
		with("Application.Quit", `{"object":2,"method":2}`, "runtime_denied"),
		with("Events.Emit", `{"object":3,"method":0,"args":{"name":"mcp/x"}}`, "runtime_denied"),
		with("malformed JSON", `{"object":`, "malformed_json"),
		with("an empty body", ``, "empty_body"),
		{name: "a query-string call", body: ``, path: "/wails/runtime?object=0&method=0&args=%7B%7D", reason: "query_forbidden"},
		{name: "a chunked body", body: good, reason: "chunked_forbidden", mutate: func(h http.Header) { h.Set("X-Wails-Chunk-Id", "x") }},
		{name: "a text body", body: good, reason: "content_type", mutate: func(h http.Header) { h.Set("Content-Type", "text/plain") }},
		{name: "a window name", body: good, reason: "window_header_forbidden", mutate: func(h http.Header) { h.Set("X-Wails-Window-Name", "main") }},
		{name: "a window ID", body: good, reason: "window_header_forbidden", mutate: func(h http.Header) { h.Set("X-Wails-Window-Id", "1") }},
		{name: "no client ID", body: good, reason: "client_id", mutate: func(h http.Header) { h.Del("X-Wails-Client-Id") }},
		{name: "an invalid client ID", body: good, reason: "client_id", mutate: func(h http.Header) { h.Set("X-Wails-Client-Id", "bad id!") }},
		{name: "two client IDs", body: good, reason: "client_id", mutate: func(h http.Header) { h.Add("X-Wails-Client-Id", "other") }},
		{name: "a GET", body: ``, method: http.MethodGet, reason: "http_method_not_allowed"},
		{name: "a body over a mebibyte", body: callBody("c1", instanceInfo, `"`+strings.Repeat("x", auditgate.MaxRuntimeBodyBytes)+`"`), reason: "body_too_large"},
	}
	for _, p := range probes {
		header := runtimeHeader(b, "page")
		if p.mutate != nil {
			p.mutate(header)
		}
		method, path := p.method, p.path
		if method == "" {
			method = http.MethodPost
		}
		if path == "" {
			path = "/wails/runtime"
		}
		before := len(h.up.runtimeRecords())
		res := b.send(request{method: method, path: path, header: header, body: p.body})
		deniedWith(t, p.name, res.status, res.body, p.reason)
		if len(h.up.runtimeRecords()) != before {
			t.Errorf("%s reached the upstream", p.name)
		}
	}
	if n := h.up.dangerousCalls(); n != 0 {
		t.Fatalf("%d denied methods ran", n)
	}

	// None of that harmed the page: the plain call still works.
	if res := b.call("page", good); res.status != http.StatusOK {
		t.Fatalf("call after the refusals = %d %q", res.status, res.body)
	}
}

func TestRefusedPolicyDecisionsAreRecordedByCategory(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	mustOpen(t, b, "page")
	b.call("page", callBody("c1", createShell, ""))
	denied := h.events.count(gateway.EventPolicyDenied)
	if denied != 1 {
		t.Fatalf("policy_denied events = %d, want 1", denied)
	}
	for _, event := range h.events.all() {
		if event.Kind == gateway.EventPolicyDenied && event.Subject != createShell {
			t.Fatalf("policy_denied subject = %q, want the resolved method", event.Subject)
		}
	}
	if h.gw.Status().Denials[gateway.DenialPolicy] == 0 {
		t.Fatal("status does not count the policy denial")
	}
}

func TestCallsRunOnlyThroughAnOpenEventsSocket(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	good := callBody("c1", instanceInfo, "")

	// Nothing is bound yet: a client ID the remote made up runs nothing.
	res := b.call("page", good)
	deniedWith(t, "a call before any socket", res.status, res.body, "client_unbound")
	if len(h.up.runtimeRecords()) != 0 {
		t.Fatal("an unbound call reached the upstream")
	}

	socket := mustOpen(t, b, "page")
	if res = b.call("page", good); res.status != http.StatusOK {
		t.Fatalf("call with a bound client ID = %d %q", res.status, res.body)
	}
	// Another page's ID is not this page's.
	res = b.call("elsewhere", good)
	deniedWith(t, "another client ID", res.status, res.body, "client_unbound")

	if err := socket.conn.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Logf("close: %v", err)
	}
	eventually(t, 5*time.Second, "the gateway to notice the closed socket", func() bool {
		return h.gw.Status().Tunnels == 0
	})
	records := len(h.up.runtimeRecords())
	res = b.call("page", good)
	deniedWith(t, "a call after the socket closed", res.status, res.body, "client_unbound")
	if len(h.up.runtimeRecords()) != records {
		t.Fatal("a call after the events socket closed reached the upstream")
	}
}

func TestACallWaitsForItsPageToBindThenRunsBound(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Timeouts.BindWait = 3 * time.Second })
	b := h.browser(laptop, h.pair())
	good := callBody("c1", instanceInfo, "")

	done := make(chan response, 1)
	go func() { done <- b.call("late", good) }()
	// The page's first call races its events socket.
	time.Sleep(150 * time.Millisecond)
	if len(h.up.runtimeRecords()) != 0 {
		t.Fatal("the call ran before its page had a socket")
	}
	mustOpen(t, b, "late")
	select {
	case res := <-done:
		if res.status != http.StatusOK {
			t.Fatalf("held call = %d %q", res.status, res.body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the held call never ran")
	}
	records := h.up.runtimeRecords()
	if len(records) != 1 || !strings.HasPrefix(records[0].Window, "browser-") {
		t.Fatalf("held call ran as %+v, want the page's browser window", records)
	}
}

func TestACallWithNoSocketIsRefusedAfterTheWait(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Timeouts.BindWait = 200 * time.Millisecond })
	b := h.browser(laptop, h.pair())
	start := time.Now()
	res := b.call("never", callBody("c1", instanceInfo, ""))
	deniedWith(t, "a call that never gets a socket", res.status, res.body, "client_unbound")
	if time.Since(start) < 150*time.Millisecond {
		t.Fatal("the call was refused without waiting")
	}
	if len(h.up.runtimeRecords()) != 0 {
		t.Fatal("the call reached the upstream")
	}
}

func TestClientIDsAreNeverSharedBetweenCredentials(t *testing.T) {
	h := newHarness(t)
	a := h.browser(laptop, h.pair())
	c := h.browser(phone, h.pair())
	mustOpen(t, a, "page")
	mustOpen(t, c, "page")
	good := callBody("c1", instanceInfo, "")

	if res := a.call("page", good); res.status != http.StatusOK {
		t.Fatalf("a = %d", res.status)
	}
	if res := c.call("page", good); res.status != http.StatusOK {
		t.Fatalf("c = %d", res.status)
	}
	records := h.up.runtimeRecords()
	if len(records) != 2 {
		t.Fatalf("calls = %d", len(records))
	}
	first, second := records[0].Header.Get("X-Wails-Client-Id"), records[1].Header.Get("X-Wails-Client-Id")
	if first == second || records[0].Window == records[1].Window {
		t.Fatalf("two credentials' pages with the same ID share a host window: %q %q (%s, %s)",
			first, second, records[0].Window, records[1].Window)
	}

	// A third credential cannot use a label the others bound.
	other := h.browser(laptop, h.pair())
	res := other.call("page", good)
	deniedWith(t, "another credential using a bound label", res.status, res.body, "client_unbound")
}

func TestCallIDsAreScopedPerPageWithADelimiter(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	mustOpen(t, b, "pageA")
	mustOpen(t, b, "pageB")

	for _, page := range []string{"pageA", "pageB"} {
		if res := b.call(page, callBody("same", instanceInfo, "")); res.status != http.StatusOK {
			t.Fatalf("%s call = %d %q", page, res.status, res.body)
		}
		// A page may only cancel through its own prefix.
		cancel := `{"object":10,"method":0,"args":{"call-id":"same"}}`
		if res := b.call(page, cancel); res.status != http.StatusOK {
			t.Fatalf("%s cancel = %d %q", page, res.status, res.body)
		}
	}
	prefixed := regexp.MustCompile(`"call-id":"([0-9a-f]{16}\.)same"`)
	var prefixes []string
	for _, record := range h.up.runtimeRecords() {
		match := prefixed.FindSubmatch(record.Body)
		if match == nil {
			t.Fatalf("call ID is not prefixed with a delimiter: %s", record.Body)
		}
		prefixes = append(prefixes, string(match[1]))
	}
	if len(prefixes) != 4 {
		t.Fatalf("records = %d, want 4", len(prefixes))
	}
	if prefixes[0] != prefixes[1] || prefixes[2] != prefixes[3] || prefixes[0] == prefixes[2] {
		t.Fatalf("prefixes %v: want one per page, the same for a call and its cancel", prefixes)
	}
}

func TestRelayedAnswersAreTheUpstreamsOwn(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	mustOpen(t, b, "page")
	res := b.call("page", `{"object":6,"method":18}`)
	// Wails answers a string result as plain text, and the gateway passes that
	// through: status, the validated type and the body, nothing rewritten.
	if res.status != http.StatusOK || !regexp.MustCompile(`^browser-[0-9]+$`).MatchString(res.body) {
		t.Fatalf("Window.Name = %d %q, want the browser window's name", res.status, res.body)
	}
	if res.header.Get("Content-Type") != "text/plain" {
		t.Fatalf("Content-Type = %q, want the upstream's text/plain", res.header.Get("Content-Type"))
	}
}

func TestEveryRuntimeCallIsServedExactlyOnceUnderConcurrency(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	mustOpen(t, b, "page")
	var wg sync.WaitGroup
	for i := range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res := b.call("page", callBody(fmt.Sprintf("c%d", i), instanceInfo, ""))
			if res.status != http.StatusOK {
				t.Errorf("call %d = %d %q", i, res.status, res.body)
			}
		}()
	}
	wg.Wait()
	if n := len(h.up.runtimeRecords()); n != 20 {
		t.Fatalf("upstream served %d calls, want 20", n)
	}
}
