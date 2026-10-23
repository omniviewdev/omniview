//go:build server

package hostruntime

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
)

// These exercise the application asset boundary over actual TCP/TLS listeners.
// Stock's outer mux/runtime verb checks are verified separately at integration;
// this handler records whether a forbidden request reached application state.
func TestDevelopmentAssetRequestPolicy(t *testing.T) {
	for _, tls := range []bool{false, true} {
		name := "http"
		if tls {
			name = "https"
		}
		t.Run(name, func(t *testing.T) {
			var state atomic.Int64
			transition := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPost {
					body, err := io.ReadAll(r.Body)
					if err != nil || string(body) != "advance" {
						http.Error(w, "invalid transition", http.StatusBadRequest)
						return
					}
				}
				state.Add(1)
				w.WriteHeader(http.StatusNoContent)
			})
			middleware := DevelopmentServerMiddleware(instance.Profile{Descriptor: devcontract.InstanceDescriptor{
				Kind: "development", WorkspaceID: "795f17ee-a4df-49e8-b461-145d344e9563",
			}})
			if middleware == nil {
				t.Fatal("named development server has no request policy")
			}
			server := httptest.NewUnstartedServer(middleware(transition))
			if tls {
				server.StartTLS()
			} else {
				server.Start()
			}
			defer server.Close()
			authority := server.Listener.Addr().String()
			_, port, err := net.SplitHostPort(authority)
			if err != nil {
				t.Fatal(err)
			}
			wrongPort := "1"
			if port == wrongPort {
				wrongPort = "2"
			}
			origin := name + "://" + authority
			otherScheme := "https"
			if tls {
				otherScheme = "http"
			}
			tests := []struct {
				name    string
				host    string
				origins []string
				fetch   string
				method  string
				path    string
				simple  bool
				want    int
			}{
				{name: "same-origin browser RPC", origins: []string{origin}, fetch: "same-origin", want: http.StatusNoContent},
				{name: "nonbrowser arbitrary nonsecret client marker", want: http.StatusNoContent},
				{name: "nonbrowser runtime GET arbitrary client marker", method: http.MethodGet, path: "/wails/runtime?object=0&method=0&args=%7B%7D", want: http.StatusNoContent},
				{name: "same-origin browser runtime GET", origins: []string{origin}, fetch: "same-origin", method: http.MethodGet, path: "/wails/runtime?object=0&method=0&args=%7B%7D", want: http.StatusNoContent},
				{name: "legacy browser runtime GET without provenance", method: http.MethodGet, path: "/wails/runtime?object=0&method=0&args=%7B%7D", simple: true, want: http.StatusForbidden},
				{name: "escaped legacy browser runtime GET", method: http.MethodGet, path: "/wails/%72untime?object=0&method=0&args=%7B%7D", simple: true, want: http.StatusForbidden},
				{name: "escaped slash legacy browser runtime GET", method: http.MethodGet, path: "/wails%2fruntime?object=0&method=0&args=%7B%7D", simple: true, want: http.StatusForbidden},
				{name: "duplicate slash legacy browser runtime GET", method: http.MethodGet, path: "/wails//runtime?object=0&method=0&args=%7B%7D", simple: true, want: http.StatusForbidden},
				{name: "dot segment legacy browser runtime GET", method: http.MethodGet, path: "/wails/./runtime?object=0&method=0&args=%7B%7D", simple: true, want: http.StatusForbidden},
				{name: "trailing slash legacy browser runtime GET", method: http.MethodGet, path: "/wails/runtime/?object=0&method=0&args=%7B%7D", simple: true, want: http.StatusForbidden},
				{name: "runtime script remains loadable without marker", method: http.MethodGet, path: "/wails/runtime.js", simple: true, want: http.StatusNoContent},
				{name: "asset remains loadable without marker", method: http.MethodGet, path: "/index.html", simple: true, want: http.StatusNoContent},
				{name: "localhost browser", host: "localhost:" + port, origins: []string{name + "://localhost:" + port}, want: http.StatusNoContent},
				{name: "IPv6 loopback authority", host: "[::1]:" + port, origins: []string{name + "://[::1]:" + port}, want: http.StatusNoContent},
				{name: "hostile simple text POST", origins: []string{"https://untrusted.invalid"}, simple: true, want: http.StatusForbidden},
				{name: "hostile origin despite client marker", origins: []string{"https://untrusted.invalid"}, want: http.StatusForbidden},
				{name: "null origin", origins: []string{"null"}, want: http.StatusForbidden},
				{name: "empty origin", origins: []string{""}, want: http.StatusForbidden},
				{name: "userinfo origin", origins: []string{name + "://user@" + authority}, want: http.StatusForbidden},
				{name: "origin path", origins: []string{origin + "/"}, want: http.StatusForbidden},
				{name: "origin query", origins: []string{origin + "?"}, want: http.StatusForbidden},
				{name: "origin fragment", origins: []string{origin + "#"}, want: http.StatusForbidden},
				{name: "wrong origin scheme", origins: []string{otherScheme + "://" + authority}, want: http.StatusForbidden},
				{name: "other loopback origin", origins: []string{name + "://localhost:" + port}, want: http.StatusForbidden},
				{name: "origin list", origins: []string{origin + " https://untrusted.invalid"}, want: http.StatusForbidden},
				{name: "duplicate origin headers", origins: []string{origin, origin}, want: http.StatusForbidden},
				{name: "DNS rebinding host", host: "rebind.invalid:" + port, origins: []string{name + "://rebind.invalid:" + port}, want: http.StatusForbidden},
				{name: "nonloopback literal", host: "192.0.2.1:" + port, want: http.StatusForbidden},
				{name: "wrong listener port", host: "127.0.0.1:" + wrongPort, want: http.StatusForbidden},
				{name: "missing explicit port", host: "localhost", want: http.StatusForbidden},
				{name: "invalid port", host: "localhost:invalid", want: http.StatusForbidden},
				{name: "fetch metadata only cross-site GET", fetch: "cross-site", method: http.MethodGet, want: http.StatusForbidden},
				{name: "same-site other-port runtime GET", fetch: "same-site", method: http.MethodGet, path: "/wails/runtime?object=0&method=0&args=%7B%7D", want: http.StatusForbidden},
				{name: "same-site simple runtime GET", fetch: "same-site", method: http.MethodGet, path: "/wails/runtime?object=0&method=0&args=%7B%7D", simple: true, want: http.StatusForbidden},
				{name: "cross-site contradicts origin", origins: []string{origin}, fetch: "cross-site", want: http.StatusForbidden},
			}
			for _, test := range tests {
				t.Run(test.name, func(t *testing.T) {
					method := test.method
					if method == "" {
						method = http.MethodPost
					}
					path := "/wails/runtime"
					if test.path != "" {
						path = test.path
					}
					var body io.Reader
					if method == http.MethodPost {
						body = strings.NewReader("advance")
					}
					req, err := http.NewRequest(method, server.URL+path, body)
					if err != nil {
						t.Fatal(err)
					}
					if test.host != "" {
						req.Host = test.host
					}
					// Forwarded authority must not repair invalid provenance.
					req.Header.Set("X-Forwarded-Host", authority)
					req.Header.Set("X-Forwarded-Proto", name)
					req.Header.Set("Forwarded", "host="+authority+";proto="+name)
					if !test.simple {
						req.Header.Set("x-wails-client-id", "arbitrary-nonsecret-value")
					}
					for _, value := range test.origins {
						req.Header.Add("Origin", value)
					}
					if test.fetch != "" {
						req.Header.Set("Sec-Fetch-Site", test.fetch)
					}
					// A simple request reaches a server without a CORS preflight.
					req.Header.Set("Content-Type", "text/plain")
					before := state.Load()
					response, err := server.Client().Do(req)
					if err != nil {
						t.Fatal(err)
					}
					defer response.Body.Close()
					if response.StatusCode != test.want {
						t.Fatalf("status = %d, want %d", response.StatusCode, test.want)
					}
					if response.Header.Get("X-Frame-Options") != "DENY" {
						t.Fatal("protected response did not prohibit framing")
					}
					wantState := before
					if test.want == http.StatusNoContent {
						wantState++
					}
					if got := state.Load(); got != wantState {
						t.Fatalf("state = %d, want %d; rejected requests must not transition state", got, wantState)
					}
				})
			}
		})
	}
}

func TestDevelopmentAssetRequestPolicyIPv6Listener(t *testing.T) {
	listener, err := net.Listen("tcp6", "[::1]:0")
	if err != nil {
		t.Skipf("IPv6 loopback unavailable: %v", err)
	}
	var state atomic.Int64
	middleware := DevelopmentServerMiddleware(instance.Profile{Descriptor: devcontract.InstanceDescriptor{Kind: "development"}})
	server := httptest.NewUnstartedServer(middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		state.Add(1)
		w.WriteHeader(http.StatusNoContent)
	})))
	if err := server.Listener.Close(); err != nil {
		t.Fatal(err)
	}
	server.Listener = listener
	server.Start()
	defer server.Close()
	request, err := http.NewRequest(http.MethodPost, server.URL+"/wails/runtime", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", server.URL)
	request.Header.Set("x-wails-client-id", "arbitrary-nonsecret-value")
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent || state.Load() != 1 {
		t.Fatalf("same-origin IPv6 runtime request rejected: status=%d state=%d", response.StatusCode, state.Load())
	}
}
