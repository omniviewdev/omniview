//go:build !production

package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/pprof"
	"strings"
	"testing"
	"time"
)

// TestHostPprofConfiguration verifies disabled, invalid and occupied listener settings.
func TestHostPprofConfiguration(t *testing.T) {
	server, err := startHostPprof("")
	if err != nil || server != nil {
		t.Fatalf("unset port must leave listener disabled: server=%v err=%v", server, err)
	}
	for _, port := range []string{"-1", "65536", "localhost:6060", "0.0.0.0:6060", "abc"} {
		if server, err := startHostPprof(port); err == nil || server != nil {
			t.Fatalf("invalid port %q accepted: server=%v err=%v", port, server, err)
		}
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	if server, err := startHostPprof(port); err == nil || server != nil {
		t.Fatalf("occupied port must fail without selecting another: server=%v err=%v", server, err)
	}
}

// TestHostPprofLoopbackRequests exercises captures, access restrictions and shutdown.
func TestHostPprofLoopbackRequests(t *testing.T) {
	server, err := startHostPprof("0")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	host, _, err := net.SplitHostPort(server.Addr)
	if err != nil || host != "127.0.0.1" {
		t.Fatalf("listener must bind IPv4 loopback: %q, %v", server.Addr, err)
	}
	client := &http.Client{Timeout: 5 * time.Second}
	for _, tc := range []struct {
		name, method, path, host, origin string
		status                           int
		contains                         string
		gzipProfile                      bool
	}{
		{name: "index", method: "GET", path: "/debug/pprof/", status: 200, contains: "goroutine"},
		{name: "goroutines", method: "GET", path: "/debug/pprof/goroutine?debug=1", status: 200, contains: "goroutine profile:"},
		{name: "head cpu", method: "HEAD", path: "/debug/pprof/profile", status: 405},
		{name: "head trace", method: "HEAD", path: "/debug/pprof/trace", status: 405},
		{name: "cpu profile", method: "GET", path: "/debug/pprof/profile?seconds=1", status: 200, gzipProfile: true},
		{name: "heap", method: "GET", path: "/debug/pprof/heap?debug=1", status: 200, contains: "heap profile:"},
		{name: "trace", method: "GET", path: "/debug/pprof/trace?seconds=1", status: 200, contains: "go 1."},
		{name: "foreign authority", method: "GET", path: "/debug/pprof/", host: "attacker.example", status: 403},
		{name: "browser origin", method: "GET", path: "/debug/pprof/", origin: "http://attacker.example", status: 403},
		{name: "mutation method", method: "POST", path: "/debug/pprof/profile", status: 405},
		{name: "unrelated path", method: "GET", path: "/", status: 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequest(tc.method, "http://"+server.Addr+tc.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			if tc.host != "" {
				req.Host = tc.host
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatal(err)
			}
			if res.StatusCode != tc.status || !strings.Contains(string(body), tc.contains) {
				t.Fatalf("status=%d body=%q; want status=%d containing %q", res.StatusCode, body, tc.status, tc.contains)
			}
			if tc.gzipProfile {
				assertGzipProfile(t, body)
			}
		})
	}
	if err := server.Close(); err != nil {
		t.Fatal(err)
	}
	if res, err := client.Get("http://" + server.Addr + "/debug/pprof/"); err == nil {
		res.Body.Close()
		t.Fatal("listener remained reachable after close")
	}
}

// TestBoundedPprofCaptures proves oversized captures finish within a short limit
// using the real CPU and trace handlers, not stand-in handlers.
func TestBoundedPprofCaptures(t *testing.T) {
	for _, tc := range []struct {
		name    string
		handler http.HandlerFunc
		seconds string
	}{
		{name: "cpu", handler: pprof.Profile, seconds: "86400"},
		{name: "trace", handler: pprof.Trace, seconds: "86400.5"},
		{name: "infinite trace", handler: pprof.Trace, seconds: "%2BInf"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(boundedPprofHandler(tc.handler, 1))
			defer server.Close()
			client := &http.Client{Timeout: 5 * time.Second}
			started := time.Now()
			res, err := client.Get(server.URL + "?seconds=" + tc.seconds)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatal(err)
			}
			if res.StatusCode != http.StatusOK {
				t.Fatalf("capture failed: status=%d body=%q", res.StatusCode, body)
			}
			if elapsed := time.Since(started); elapsed < time.Second {
				t.Fatalf("capture ended before the clamped interval: %v", elapsed)
			}
			if tc.name == "cpu" {
				assertGzipProfile(t, body)
			} else if !bytes.HasPrefix(body, []byte("go 1.")) {
				t.Fatalf("invalid execution trace header: %q", body)
			}
		})
	}
}

// assertGzipProfile verifies the downloaded binary is a valid gzip stream.
func assertGzipProfile(t *testing.T, body []byte) {
	t.Helper()
	reader, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	if _, err := io.Copy(io.Discard, reader); err != nil {
		t.Fatalf("invalid compressed profile: %v", err)
	}
}
