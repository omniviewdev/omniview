package gateway_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

// rawGet builds a request with the browser's credential and a same-origin
// Host, for targets and methods net/http's client would not send as written.
func (b *browser) rawRequest(method, target string, extra ...string) string {
	lines := []string{
		method + " " + target + " HTTP/1.1",
		"Host: " + b.h.authority(),
		"Authorization: " + b.basic(),
		"Connection: close",
	}
	lines = append(lines, extra...)
	return strings.Join(lines, "\r\n") + "\r\n\r\n"
}

func deniedWith(t *testing.T, name string, status int, body, reason string) {
	t.Helper()
	if status != http.StatusForbidden {
		t.Errorf("%s: status %d, want 403 (body %q)", name, status, body)
		return
	}
	if !strings.Contains(body, `"code":"audit_denied"`) || !strings.Contains(body, `"reason":"`+reason+`"`) {
		t.Errorf("%s: body %q, want code audit_denied with reason %s", name, body, reason)
	}
}

func TestOnlyTheListedRoutesReachTheUpstream(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())

	allowed := []string{
		"/", "/health", "/wails/custom.js", "/wails/runtime.js", "/wails/transport.js",
		"/assets/app.js", "/_/plugins/demo/assets/entry.js",
	}
	for _, path := range allowed {
		before := h.up.pathHits(path)
		res := b.get(path)
		if res.status != http.StatusOK || res.body == "" {
			t.Errorf("GET %s = %d %q, want 200 with the upstream's body", path, res.status, res.body)
		}
		if h.up.pathHits(path) != before+1 {
			t.Errorf("GET %s did not reach the upstream exactly once", path)
		}
	}
	head := b.send(request{method: http.MethodHead, path: "/"})
	if head.status != http.StatusOK || head.body != "" {
		t.Errorf("HEAD / = %d %q, want 200 with no body", head.status, head.body)
	}

	type refusal struct{ method, target, reason string }
	refusals := []refusal{
		// The Wails stream transport is unused by the host and never reachable.
		{"GET", "/wails/stream/ws", "stream_denied"},
		{"GET", "/wails/stream/poll", "stream_denied"},
		{"POST", "/wails/stream/send", "stream_denied"},
		{"GET", "/wails/Stream/ws", "stream_denied"},
		{"GET", "/wails%2Fstream/ws", "stream_denied"},
		// Webview-only delivery of large events; the browser socket never uses it.
		{"GET", "/wails/eventpayload/0123456789abcdef0123456789abcdef", "route_not_allowed"},
		// Spellings of an allowed route that are not that route.
		{"POST", "/wails%2Fruntime", "route_not_allowed"},
		{"POST", "/wails/runtime/", "route_not_allowed"},
		{"POST", "/wails//runtime", "route_not_allowed"},
		{"POST", "/wails/./runtime", "route_not_allowed"},
		{"POST", "/wails/runtime;x=1", "route_not_allowed"},
		{"POST", "/Wails/runtime", "route_not_allowed"},
		{"GET", "/wails/Runtime.js", "route_not_allowed"},
		{"GET", "/wails/runtime.js/", "route_not_allowed"},
		{"GET", "/health/", "route_not_allowed"},
		{"GET", "//assets/app.js", "route_not_allowed"},
		{"GET", "/assets//app.js", "route_not_allowed"},
		{"GET", "/assets/../assets/app.js", "route_not_allowed"},
		{"GET", "/assets/%2e%2e/secret.js", "route_not_allowed"},
		{"GET", "/assets/app.js%00", "route_not_allowed"},
		{"GET", "/assets/app.js;v=1", "route_not_allowed"},
		{"GET", "/assets/app.js/", "route_not_allowed"},
		{"GET", "/assets/.hidden.js", "route_not_allowed"},
		{"GET", "/assets/app.php", "route_not_allowed"},
		{"GET", "/assets/app.js.map", "route_not_allowed"},
		// Things the host serves or proxies that an audit has no use for.
		{"GET", "/index.html", "route_not_allowed"},
		{"GET", "/.env", "route_not_allowed"},
		{"GET", "/@fs/etc/passwd.js", "route_not_allowed"},
		{"GET", "/node_modules/.vite/deps/react.js", "route_not_allowed"},
		{"GET", "/src/main.tsx", "route_not_allowed"},
		{"GET", "/internal/debug/pprof", "route_not_allowed"},
		{"GET", "/_/anything", "route_not_allowed"},
		{"GET", "/_/plugins/demo/other/entry.js", "route_not_allowed"},
		{"GET", "/_/plugins/demo/assets/run.sh", "route_not_allowed"},
		{"GET", "/_/plugins//assets/entry.js", "route_not_allowed"},
		{"GET", "/_/plugins/demo/assets/../../x.js", "route_not_allowed"},
		{"GET", "/_/plugins/../assets/entry.js", "route_not_allowed"},
		// Queries never reach a static route.
		{"GET", "/assets/app.js?v=1", "query_forbidden"},
		{"GET", "/?x=1", "query_forbidden"},
		{"GET", "/health?verbose=1", "query_forbidden"},
		// Only reads.
		{"POST", "/assets/app.js", "http_method_not_allowed"},
		{"PUT", "/assets/app.js", "http_method_not_allowed"},
		{"DELETE", "/", "http_method_not_allowed"},
		{"PATCH", "/health", "http_method_not_allowed"},
		{"OPTIONS", "/assets/app.js", "http_method_not_allowed"},
		{"TRACE", "/", "http_method_not_allowed"},
		// The runtime route is POST only; the events route needs an upgrade.
		{"GET", "/wails/runtime", "http_method_not_allowed"},
		{"PUT", "/wails/runtime", "http_method_not_allowed"},
		{"GET", "/wails/events", "upgrade_invalid"},
	}
	hits := h.up.Hits()
	for _, tc := range refusals {
		status, _, body := b.raw(b.rawRequest(tc.method, tc.target))
		deniedWith(t, tc.method+" "+tc.target, status, body, tc.reason)
	}
	if h.up.Hits() != hits {
		t.Fatalf("%d refused requests reached the upstream", h.up.Hits()-hits)
	}
}

func TestStaticRequestsCarryNothingFromTheClient(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	header := http.Header{
		"Cookie":               {"session=abc; other=def"},
		"Forwarded":            {"for=203.0.113.9"},
		"X-Forwarded-For":      {"203.0.113.9"},
		"X-Forwarded-Host":     {"evil.example"},
		"X-Real-Ip":            {"203.0.113.9"},
		"Tailscale-User-Login": {"someone@example.com"},
		"Tailscale-User-Name":  {"Someone"},
		"X-Wails-Window-Name":  {"main"},
		"X-Wails-Window-Id":    {"1"},
		"X-Wails-Client-Id":    {"page"},
		"Proxy-Authorization":  {"Basic Zm9vOmJhcg=="},
		"Sec-Fetch-Site":       {"same-origin"},
		"Referer":              {"https://elsewhere.example/"},
		"Range":                {"bytes=0-1"},
		"If-None-Match":        {`"x"`},
		"Accept-Encoding":      {"gzip"},
	}
	res := b.send(request{path: "/assets/app.js", header: header})
	if res.status != http.StatusOK || res.body != "console.log('app');" {
		t.Fatalf("GET = %d %q, want the whole upstream body", res.status, res.body)
	}
	seen := h.up.headerFor("/assets/app.js")
	for name, values := range seen {
		switch name {
		case "User-Agent":
			// Added by Go's HTTP client, not by the remote.
		default:
			t.Errorf("the upstream saw request header %s: %q", name, values)
		}
	}
}

func TestRemoteResponsesCarryOnlyWhatTheGatewayChooses(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	res := b.get("/assets/leaky.js")
	if res.status != http.StatusOK || res.body != "leak" {
		t.Fatalf("GET = %d %q", res.status, res.body)
	}
	for _, name := range []string{
		"Set-Cookie", "Www-Authenticate", "Strict-Transport-Security", "Location",
		"Access-Control-Allow-Origin", "X-Powered-By",
	} {
		if value := res.header.Get(name); value != "" {
			t.Errorf("response carries upstream header %s: %q", name, value)
		}
	}
	want := map[string]string{
		"Content-Type":           "application/javascript",
		"Cache-Control":          "no-store",
		"Referrer-Policy":        "no-referrer",
		"X-Frame-Options":        "DENY",
		"X-Content-Type-Options": "nosniff",
	}
	for name, value := range want {
		if got := res.header.Get(name); got != value {
			t.Errorf("%s = %q, want %q", name, got, value)
		}
	}
	if csp := res.header.Get("Content-Security-Policy"); !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Errorf("Content-Security-Policy = %q, want frame-ancestors 'none'", csp)
	}

	// No response, of any kind, asks the browser to pin the host name, and
	// none leaves the browser free to guess its type.
	for _, res := range []response{
		b.get("/"),
		b.send(request{path: "/", anonymous: true}),
		b.get("/no-such-route"),
		b.call("page", "{}"),
	} {
		if res.header.Get("Strict-Transport-Security") != "" {
			t.Error("a response carries Strict-Transport-Security")
		}
		if res.header.Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("a %d response does not forbid content sniffing", res.status)
		}
	}
}

func TestUpstreamRedirectsAreNeverFollowedOrPassedOn(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	res := b.get("/assets/redirect.js")
	if res.status != http.StatusBadGateway || !strings.Contains(res.body, "audit_unavailable") {
		t.Fatalf("upstream redirect = %d %q, want a fixed 502", res.status, res.body)
	}
	if res.header.Get("Location") != "" {
		t.Fatalf("Location leaked: %q", res.header.Get("Location"))
	}
}

func TestResponsesAreBounded(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Limits.MaxStaticResponseBytes = 1 << 20 })
	b := h.browser(laptop, h.pair())

	// A response that declares too much is refused before any of it is sent.
	declared := b.get("/assets/huge.js")
	if declared.status != http.StatusBadGateway || !strings.Contains(declared.body, "response_too_large") {
		t.Fatalf("oversized declared response = %d %q", declared.status, declared.body)
	}

	// One that outgrows the limit while streaming ends the connection instead
	// of passing off a truncated body as a complete one.
	res, err := b.sendErr(request{path: "/assets/stream.js"})
	if err == nil {
		t.Fatalf("a streamed response over the limit ended cleanly: %d, %d bytes", res.status, len(res.body))
	}
}

func TestNonBrowserContextsAreRefused(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	origin := b.origin()
	sibling := "https://other.example.ts.net:" + strings.TrimPrefix(origin, "https://"+serverName+":")

	type probe struct {
		name   string
		method string
		path   string
		header http.Header
		reason string
	}
	runtime := func(name string, header http.Header, reason string) probe {
		header.Set("Content-Type", "application/json")
		header.Set("X-Wails-Client-Id", "page")
		return probe{name: name, method: http.MethodPost, path: "/wails/runtime", header: header, reason: reason}
	}
	probes := []probe{
		runtime("runtime without origin", http.Header{}, "origin"),
		runtime("runtime null origin", http.Header{"Origin": {"null"}}, "origin"),
		runtime("runtime empty origin", http.Header{"Origin": {""}}, "origin"),
		runtime("runtime cross origin", http.Header{"Origin": {"https://evil.example"}}, "origin"),
		runtime("runtime sibling origin", http.Header{"Origin": {sibling}}, "origin"),
		runtime("runtime http origin", http.Header{"Origin": {"http://" + serverName}}, "origin"),
		runtime("runtime duplicate origin", http.Header{"Origin": {origin, origin}}, "origin"),
		runtime("runtime origin list", http.Header{"Origin": {origin + ", " + origin}}, "origin"),
		runtime("runtime cross-site fetch", http.Header{"Origin": {origin}, "Sec-Fetch-Site": {"cross-site"}}, "fetch_metadata"),
		runtime("runtime same-site fetch", http.Header{"Origin": {origin}, "Sec-Fetch-Site": {"same-site"}}, "fetch_metadata"),
		runtime("runtime typed-url fetch", http.Header{"Origin": {origin}, "Sec-Fetch-Site": {"none"}}, "fetch_metadata"),
		runtime("runtime two fetch values", http.Header{"Origin": {origin}, "Sec-Fetch-Site": {"same-origin", "cross-site"}}, "fetch_metadata"),
		{name: "page from another origin", method: http.MethodGet, path: "/", header: http.Header{"Origin": {"https://evil.example"}}, reason: "origin"},
		{name: "cross-site subresource", method: http.MethodGet, path: "/assets/app.js", header: http.Header{"Sec-Fetch-Site": {"cross-site"}}, reason: "fetch_metadata"},
		{name: "same-site subresource", method: http.MethodGet, path: "/assets/app.js", header: http.Header{"Sec-Fetch-Site": {"same-site"}}, reason: "fetch_metadata"},
	}
	hits := h.up.Hits()
	for _, p := range probes {
		body := ""
		if p.method == http.MethodPost {
			body = "{}"
		}
		res := b.send(request{method: p.method, path: p.path, header: p.header, body: body})
		deniedWith(t, p.name, res.status, res.body, p.reason)
	}
	if h.up.Hits() != hits {
		t.Fatalf("%d requests from a hostile browser context reached the upstream", h.up.Hits()-hits)
	}

	// Reads that carry no Origin, or say same-origin or none (the owner typed
	// the address), are what a page makes.
	for _, header := range []http.Header{{}, {"Sec-Fetch-Site": {"same-origin"}}, {"Sec-Fetch-Site": {"none"}}, {"Origin": {origin}}} {
		if res := b.send(request{path: "/assets/app.js", header: header}); res.status != http.StatusOK {
			t.Errorf("same-origin read with %v = %d, want 200", header, res.status)
		}
	}
}

func TestUpgradeAndBodiesAreRefusedOnReadRoutes(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	hits := h.up.Hits()

	status, _, body := b.raw(b.rawRequest("GET", "/assets/app.js", "Upgrade: websocket", "Connection: Upgrade"))
	deniedWith(t, "upgrade on a static route", status, body, "upgrade_forbidden")

	status, _, body = b.raw(b.rawRequest("GET", "/assets/app.js", "Content-Length: 2", "", "{}"))
	deniedWith(t, "body on a static route", status, body, "body_forbidden")

	status, _, body = b.raw(b.rawRequest("GET", "/assets/app.js", "Transfer-Encoding: chunked", "", "0", ""))
	deniedWith(t, "chunked body on a static route", status, body, "body_forbidden")

	if h.up.Hits() != hits {
		t.Fatalf("%d refused requests reached the upstream", h.up.Hits()-hits)
	}
}
