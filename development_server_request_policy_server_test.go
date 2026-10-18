//go:build server

package main

import (
	"context"
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

// Removing any provenance or authority check must permit an otherwise forbidden
// state transition, not merely change a response from a mock RPC endpoint.
func TestDevelopmentServerRequestPolicy(t *testing.T) {
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
			middleware := developmentServerMiddleware(instance.Profile{Descriptor: devcontract.InstanceDescriptor{
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
				upgrade bool
				path    string
				simple  bool
				want    int
			}{
				{name: "same-origin browser RPC", origins: []string{origin}, fetch: "same-origin", want: http.StatusNoContent},
				{name: "same-origin event path without client marker", origins: []string{origin}, method: http.MethodGet, simple: true, want: http.StatusNoContent},
				{name: "same-origin WebSocket upgrade without client marker", origins: []string{origin}, method: http.MethodGet, upgrade: true, simple: true, want: http.StatusNoContent},
				{name: "hostile WebSocket upgrade", origins: []string{"https://untrusted.invalid"}, method: http.MethodGet, upgrade: true, want: http.StatusForbidden},
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
					if method == http.MethodGet {
						path = "/wails/events"
					}
					if test.upgrade {
						path = "/wails/stream/ws"
					}
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
					if test.upgrade {
						req.Header.Set("Connection", "Upgrade")
						req.Header.Set("Upgrade", "websocket")
					}
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

func TestDevelopmentServerRequestPolicyRequiresLoopbackListener(t *testing.T) {
	for _, test := range []struct {
		name string
		addr any
	}{
		{name: "missing listener context"},
		{name: "invalid listener context", addr: "127.0.0.1:34352"},
		{name: "nil listener", addr: (*net.TCPAddr)(nil)},
		{name: "wildcard listener", addr: &net.TCPAddr{IP: net.IPv4zero, Port: 34352}},
		{name: "nonloopback listener", addr: &net.TCPAddr{IP: net.ParseIP("192.0.2.1"), Port: 34352}},
		{name: "invalid listener port", addr: &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0}},
	} {
		t.Run(test.name, func(t *testing.T) {
			var state int
			middleware := developmentServerMiddleware(instance.Profile{Descriptor: devcontract.InstanceDescriptor{Kind: "development"}})
			handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				state++
				w.WriteHeader(http.StatusNoContent)
			}))
			request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:34352/wails/runtime", strings.NewReader("advance"))
			if test.addr != nil {
				request = request.WithContext(context.WithValue(request.Context(), http.LocalAddrContextKey, test.addr))
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden || state != 0 {
				t.Fatalf("invalid listener permitted request: status=%d state=%d", response.Code, state)
			}
		})
	}
}

func TestDevelopmentServerRequestPolicyProductionUnchanged(t *testing.T) {
	for _, kind := range []string{"production", ""} {
		if middleware := developmentServerMiddleware(instance.Profile{Descriptor: devcontract.InstanceDescriptor{Kind: kind}}); middleware != nil {
			t.Fatalf("profile kind %q unexpectedly acquired development request policy", kind)
		}
	}
}

func TestDevelopmentServerRequestPolicyIPv6Listener(t *testing.T) {
	listener, err := net.Listen("tcp6", "[::1]:0")
	if err != nil {
		t.Skipf("IPv6 loopback unavailable: %v", err)
	}
	var state atomic.Int64
	middleware := developmentServerMiddleware(instance.Profile{Descriptor: devcontract.InstanceDescriptor{Kind: "development"}})
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
	request, err := http.NewRequest(http.MethodGet, server.URL+"/wails/stream/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", server.URL)
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "websocket")
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent || state.Load() != 1 {
		t.Fatalf("same-origin IPv6 upgrade request rejected: status=%d state=%d", response.StatusCode, state.Load())
	}
}
