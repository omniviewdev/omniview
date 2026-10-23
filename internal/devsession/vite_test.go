package devsession

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestProbeViteHMRUsesActualInjectedPathPortAndToken(t *testing.T) {
	for _, message := range []string{`{"type":"connected"}`, `{"type":"unrelated"}`} {
		t.Run(message, func(t *testing.T) {
			ws := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/actual-hmr" || r.URL.Query().Get("token") != "actual secret token" {
					http.Error(w, "wrong target", 401)
					return
				}
				connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"vite-hmr"}, InsecureSkipVerify: true})
				if err != nil {
					return
				}
				defer connection.CloseNow()
				_ = connection.Write(r.Context(), websocket.MessageText, []byte(message))
				_, _, _ = connection.Read(r.Context())
			}))
			defer ws.Close()
			socketURL, _ := url.Parse(ws.URL)
			module := fmt.Sprintf("const socketProtocol = \"ws\" || (importMetaUrl.protocol === \"https:\" ? \"wss\" : \"ws\");\nconst hmrPort = %q;\nconst socketHost = `${\"127.0.0.1\" || importMetaUrl.hostname}:${hmrPort || importMetaUrl.port}${\"/actual-hmr\"}`;\nconst wsToken = \"actual secret token\";\n", socketURL.Port())
			source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/base/@vite/client" {
					http.NotFound(w, r)
					return
				}
				w.Header().Set("Content-Type", "application/javascript")
				fmt.Fprint(w, module)
			}))
			defer source.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			endpoint, err := ProbeViteHMR(ctx, source.URL+"/base/")
			if message == `{"type":"connected"}` {
				if err != nil {
					t.Fatal(err)
				}
				if endpoint != "ws://"+socketURL.Host+"/actual-hmr" {
					t.Fatalf("guessed rather than observed HMR URL: %s", endpoint)
				}
				if strings.Contains(endpoint, "token") {
					t.Fatal("secret returned")
				}
			} else if err == nil {
				t.Fatal("unrelated protocol was advertised as ready")
			}
		})
	}
}

func TestProbeViteHMRRejectsHTTPTextAndDoesNotLeakToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "WebSocket connected") }))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := ProbeViteHMR(ctx, server.URL); err == nil {
		t.Fatal("plain HTTP accepted as HMR")
	}
	for _, address := range []string{"http://example.invalid:1234/", "http://127.0.0.1:1234/?token=secret", "http://user:secret@127.0.0.1:1234/"} {
		_, err := ProbeViteHMR(ctx, address)
		if err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("invalid address accepted or leaked: %v", err)
		}
	}
}

func TestProbeViteHMRBoundsSilentUpgradedPeer(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/@vite/client" {
			endpoint, _ := url.Parse(server.URL)
			fmt.Fprintf(w, "const socketProtocol = \"ws\" || (importMetaUrl.protocol === \"https:\" ? \"wss\" : \"ws\");\nconst hmrPort = %q;\nconst socketHost = `${\"127.0.0.1\" || importMetaUrl.hostname}:${hmrPort || importMetaUrl.port}${\"/silent\"}`;\nconst wsToken = \"silent-peer-secret\";\n", endpoint.Port())
			return
		}
		connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"vite-hmr"}, InsecureSkipVerify: true})
		if err != nil {
			return
		}
		defer connection.CloseNow()
		_, _, _ = connection.Read(r.Context()) // Deliberately never send connected.
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()
	started := time.Now()
	endpoint, err := ProbeViteHMR(ctx, server.URL)
	if err == nil || endpoint != "" {
		t.Fatal("silent upgraded peer was accepted")
	}
	if ctx.Err() != nil || time.Since(started) > 5*time.Second {
		t.Fatal("probe was not bounded independently of host lifetime context")
	}
	if strings.Contains(err.Error(), "silent-peer-secret") {
		t.Fatal("websocket token leaked in error")
	}
}
