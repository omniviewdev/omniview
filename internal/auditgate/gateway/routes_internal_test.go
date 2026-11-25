package gateway

import (
	"net/http"
	"net/url"
	"path"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

func classify(target string) routing {
	return classifyRoute(&http.Request{RequestURI: target})
}

func TestRouteTableIsClosed(t *testing.T) {
	want := map[string]routeKind{
		"/wails/runtime":                        routeRuntime,
		"/wails/events":                         routeEvents,
		"/wails/runtime?object=0":               routeRuntime,
		"/wails/events?clientId=abc":            routeEvents,
		"/":                                     routeStatic,
		"/health":                               routeStatic,
		"/wails/custom.js":                      routeStatic,
		"/wails/runtime.js":                     routeStatic,
		"/wails/transport.js":                   routeStatic,
		"/assets/index-AbC123_x-y.js":           routeStatic,
		"/assets/deep/er/file.min.css":          routeStatic,
		"/assets/font.woff2":                    routeStatic,
		"/images/logo.webp":                     routeStatic,
		"/appicon.png":                          routeStatic,
		"/global.css":                           routeStatic,
		"/favicon.ico":                          routeStatic,
		"/_/plugins/kubernetes/assets/entry.js": routeStatic,
		"/_/plugins/k8s-1.2/dist/a/b/c.html":    routeStatic,
		"/_/plugins/x/assets/entry.js.map":      routeStatic,
		"/wails/stream/ws":                      routeDenied,
		"/wails/stream":                         routeDenied,
		"/WAILS/STREAM/ws":                      routeDenied,
		"/wails%2Fstream/poll":                  routeDenied,
		"/wails/eventpayload/abc":               routeDenied,
		"/wails/runtime/":                       routeDenied,
		"/wails/runtime.js/":                    routeDenied,
		"/Wails/runtime":                        routeDenied,
		"/wails%2Fruntime":                      routeDenied,
		"/wails/./runtime":                      routeDenied,
		"//wails/runtime":                       routeDenied,
		"/assets/../x.js":                       routeDenied,
		"/assets/./x.js":                        routeDenied,
		"/assets//x.js":                         routeDenied,
		"/assets/%2e%2e/x.js":                   routeDenied,
		"/assets/x.js%00":                       routeDenied,
		"/assets/x.js;a=b":                      routeDenied,
		"/assets/x y.js":                        routeDenied,
		"/assets/x\\y.js":                       routeDenied,
		"/assets/é.js":                          routeDenied,
		"/assets/.x.js":                         routeDenied,
		"/assets/x.js/":                         routeDenied,
		"/assets/x.exe":                         routeDenied,
		"/assets/x":                             routeDenied,
		"/assets/":                              routeDenied,
		"/other/x.js":                           routeDenied,
		"/index.html":                           routeDenied,
		"/x.html":                               routeDenied,
		"/_/plugins/x/assets/x.html":            routeStatic,
		"/_/plugins/x/assets/x.php":             routeDenied,
		"/_/plugins/x/lib/x.js":                 routeDenied,
		"/_/plugins/x/assets":                   routeDenied,
		"/_/plugins//assets/x.js":               routeDenied,
		"/_/plugins/../assets/x.js":             routeDenied,
		"/_/other/x/assets/x.js":                routeDenied,
		"/#frag":                                routeDenied,
		"":                                      routeDenied,
		"*":                                     routeDenied,
		"http://evil.example/":                  routeDenied,
		"x":                                     routeDenied,
	}
	for target, kind := range want {
		if got := classify(target); got.kind != kind {
			t.Errorf("%q classified as %d, want %d", target, got.kind, kind)
		}
	}
	if got := classify("/wails/stream/ws"); got.reason != auditgate.ReasonStream {
		t.Errorf("stream reason = %q", got.reason)
	}
	if got := classify("/nope"); got.reason != reasonRouteNotAllowed {
		t.Errorf("unlisted route reason = %q", got.reason)
	}
	if got := classify(strings.Repeat("/a", maxTargetBytes)); got.kind != routeDenied {
		t.Error("an oversized target was classified")
	}
}

func TestSplitTargetKeepsEverythingRaw(t *testing.T) {
	path, query, ok := splitTarget("/a%2Fb/c?x=%41&y")
	if !ok || path != "/a%2Fb/c" || query != "x=%41&y" {
		t.Fatalf("splitTarget = %q %q %v, want the raw halves", path, query, ok)
	}
	for _, bad := range []string{"", "a", "*", "http://x/", "/a b", "/a\tb", "/a\x7f", "/\u00e9", "/a#b", "/\n"} {
		if _, _, ok = splitTarget(bad); ok {
			t.Errorf("splitTarget(%q) accepted", bad)
		}
	}
}

func FuzzClassifyRoute(f *testing.F) { //nolint:gocognit // A fuzz target states every invariant in one place.
	for _, seed := range []string{
		"/", "/wails/runtime", "/wails/events?clientId=a", "/wails/stream/ws", "/assets/a.js", "/assets/../a.js",
		"/_/plugins/x/assets/e.js", "/%2e%2e/", "//", "/a?b", "*", "", "/wails%2Fruntime", "/WAILS/events",
		"/assets/a.js\x00", "/assets/\xff.js", "/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q.js",
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, target string) {
		routed := classify(target)
		switch routed.kind {
		case routeDenied:
			if routed.reason == "" {
				t.Fatalf("%q denied without a reason", target)
			}
			return
		case routeRuntime:
			if routed.path != "/wails/runtime" {
				t.Fatalf("%q classified as the runtime route, path %q", target, routed.path)
			}
			return
		case routeEvents:
			if routed.path != "/wails/events" {
				t.Fatalf("%q classified as the events route, path %q", target, routed.path)
			}
			return
		case routeStatic:
		}

		// Everything allowed through as a static route is a plain path that no
		// layer below the gateway would read differently.
		p := routed.path
		if !utf8.ValidString(p) || p[0] != '/' {
			t.Fatalf("%q allowed as %q", target, p)
		}
		if auditgate.ClassifyPath(p) != auditgate.PathOther {
			t.Fatalf("%q allowed although the allowlist classifies it as a special route", p)
		}
		if strings.ContainsAny(p, "%\\;?#:@ \t\r\n\x00") {
			t.Fatalf("%q allowed with a special character", p)
		}
		if cleaned := path.Clean(p); cleaned != p && p != "/" {
			t.Fatalf("%q allowed but cleans to %q", p, cleaned)
		}
		if decoded, err := url.PathUnescape(p); err != nil || decoded != p {
			t.Fatalf("%q allowed but decodes differently", p)
		}
		for _, segment := range strings.Split(strings.TrimPrefix(p, "/"), "/") {
			if p != "/" && (segment == "" || strings.HasPrefix(segment, ".")) {
				t.Fatalf("%q allowed with the segment %q", p, segment)
			}
		}
	})
}
