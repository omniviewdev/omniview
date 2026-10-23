package instance

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestBootIdentityPrecedesThemeForEmbeddedAndProxyHTML(t *testing.T) {
	identity := devcontract.BootIdentity{SchemaVersion: 1, InstanceID: fixtureID, DisplayName: "</script><script>alert('x')</script>\u2028&", Kind: "development"}
	for _, proxy := range []bool{false, true} {
		serve := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("ETag", "old")
			io.WriteString(w, "<!doctype html><html><head><script>localStorage.getItem('theme')</script></head><body>shell</body></html>")
		})
		var next http.Handler = serve
		if proxy {
			upstream := httptest.NewServer(serve)
			defer upstream.Close()
			next = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				resp, err := http.Get(upstream.URL)
				if err != nil {
					t.Fatal(err)
				}
				defer resp.Body.Close()
				for k, v := range resp.Header {
					w.Header()[k] = v
				}
				io.Copy(w, resp.Body)
			})
		}
		result := httptest.NewRecorder()
		BootMiddleware(identity)(next).ServeHTTP(result, httptest.NewRequest(http.MethodGet, "/", nil))
		body := result.Body.String()
		if !strings.HasPrefix(body, "<!doctype html>") {
			t.Fatal("doctype moved")
		}
		boot := strings.Index(body, "window.__OMNIVIEW_INSTANCE__=")
		theme := strings.Index(body, "localStorage")
		if boot < 0 || boot > theme {
			t.Fatal("identity missing before cached theme script")
		}
		if strings.Contains(body, "<script>alert") || strings.Contains(body, "\u2028") {
			t.Fatal("identity not safely escaped")
		}
		start := boot + len("window.__OMNIVIEW_INSTANCE__=")
		end := strings.Index(body[start:], ";</script>")
		var decoded devcontract.BootIdentity
		if end < 0 || json.Unmarshal([]byte(body[start:start+end]), &decoded) != nil || decoded != identity {
			t.Fatal("boot identity did not round trip")
		}
		if result.Header().Get("ETag") != "" || result.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("identity HTML remained cacheable")
		}
	}
}

func TestBootMiddlewarePreservesNonHTMLResponses(t *testing.T) {
	handler := BootMiddleware(devcontract.BootIdentity{InstanceID: fixtureID})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		w.WriteHeader(http.StatusAccepted)
		io.WriteString(w, "const value = '<head>'; ")
	}))
	result := httptest.NewRecorder()
	handler.ServeHTTP(result, httptest.NewRequest(http.MethodGet, "/asset.js", nil))
	if result.Code != http.StatusAccepted || result.Body.String() != "const value = '<head>'; " {
		t.Fatalf("non-HTML changed: %s", result.Body.String())
	}
}
