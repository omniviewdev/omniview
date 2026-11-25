package gateway_test

import (
	"bufio"
	"context"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

// handshake performs a client TLS handshake to the gateway and returns the
// error, using config over a fresh connection registered as the laptop.
func handshake(t *testing.T, h *harness, config *tls.Config) (*tls.Conn, error) {
	t.Helper()
	conn, err := net.Dial("tcp", h.ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	h.peers.set(conn.LocalAddr(), laptop, nil)
	client := tls.Client(conn, config)
	_ = client.SetDeadline(time.Now().Add(5 * time.Second))
	if err = client.Handshake(); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return client, nil
}

func TestOnlyTLS13ForTheConfiguredNameIsSpoken(t *testing.T) {
	h := newHarness(t)
	h.pair()
	good := &tls.Config{RootCAs: h.pool, ServerName: serverName, MinVersion: tls.VersionTLS13}

	conn, err := handshake(t, h, good)
	if err != nil {
		t.Fatalf("the configured name: %v", err)
	}
	if conn.ConnectionState().Version != tls.VersionTLS13 {
		t.Fatalf("negotiated version %x, want TLS 1.3", conn.ConnectionState().Version)
	}
	_ = conn.Close()
	served := h.certificateCalls()

	refused := map[string]*tls.Config{
		"TLS 1.2 only":      {RootCAs: h.pool, ServerName: serverName, MaxVersion: tls.VersionTLS12},
		"another name":      {InsecureSkipVerify: true, ServerName: "evil.example"},
		"no name":           {InsecureSkipVerify: true, ServerName: ""},
		"a suffix":          {InsecureSkipVerify: true, ServerName: serverName + ".evil.example"},
		"another case-fold": {InsecureSkipVerify: true, ServerName: "x" + serverName},
		// U+017F, the long s, folds to "s" under Unicode case folding, which
		// is not how DNS compares names.
		"a unicode case-fold": {InsecureSkipVerify: true, ServerName: strings.Replace(serverName, "ts", "t\u017f", 1)},
	}
	for name, config := range refused {
		if conn, err = handshake(t, h, config); err == nil {
			_ = conn.Close()
			t.Errorf("%s: the handshake succeeded", name)
		}
	}
	if got := h.certificateCalls(); got != served {
		t.Fatalf("the certificate callback ran %d times for refused names; it must run only for the configured name", got-served)
	}
	if h.up.Hits() != 0 {
		t.Fatal("a refused handshake reached the upstream")
	}

	// Case does not change the name.
	upper := &tls.Config{RootCAs: h.pool, ServerName: strings.ToUpper(serverName), MinVersion: tls.VersionTLS13}
	if conn, err = handshake(t, h, upper); err != nil {
		t.Fatalf("the configured name in upper case: %v", err)
	}
	_ = conn.Close()
}

func TestHTTP2IsNotSpoken(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) { return b.dial(ctx) },
		TLSClientConfig: &tls.Config{
			RootCAs: h.pool, ServerName: serverName, NextProtos: []string{"h2", "http/1.1"},
		},
		ForceAttemptHTTP2: true,
	}
	client := &http.Client{Transport: transport}
	defer transport.CloseIdleConnections()
	req, _ := http.NewRequest(http.MethodGet, b.url("/"), nil)
	req.SetBasicAuth(b.cred.username, b.cred.secret)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	if res.ProtoMajor != 1 || res.TLS.NegotiatedProtocol != "http/1.1" {
		t.Fatalf("negotiated %s over %q", res.Proto, res.TLS.NegotiatedProtocol)
	}

	conn, err := handshake(t, h, &tls.Config{RootCAs: h.pool, ServerName: serverName, NextProtos: []string{"h2"}})
	if err == nil {
		_ = conn.Close()
		t.Fatal("a client offering only h2 was served")
	}
}

func TestPlainHTTPToTheTLSPortReachesNothing(t *testing.T) {
	h := newHarness(t)
	h.pair()
	conn, err := net.Dial("tcp", h.ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	_, _ = io.WriteString(conn, "GET / HTTP/1.1\r\nHost: "+h.authority()+"\r\n\r\n")
	reply, _ := io.ReadAll(conn)
	if strings.Contains(string(reply), "__OMNIVIEW_INSTANCE__") || h.up.Hits() != 0 {
		t.Fatalf("a plaintext request got through: %q", reply)
	}
}

func TestOversizedHeadersAreRefusedBeforeTheHandler(t *testing.T) {
	h := newHarness(t)
	b := h.browser(laptop, h.pair())
	status, _, _ := b.raw(b.rawRequest("GET", "/", "X-Padding: "+strings.Repeat("a", 64<<10)))
	if status != http.StatusRequestHeaderFieldsTooLarge {
		t.Fatalf("64 KiB of headers = %d, want 431", status)
	}
	if h.up.Hits() != 0 {
		t.Fatal("an oversized request reached the upstream")
	}
}

func TestSlowHeadersAndSilentConnectionsAreCutOff(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Timeouts.ReadHeader = 150 * time.Millisecond
		c.Timeouts.Read = 300 * time.Millisecond
	})
	b := h.browser(laptop, h.pair())

	// A connection that never speaks TLS.
	silent, err := net.Dial("tcp", h.ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer silent.Close()

	// One that finishes the handshake and then trickles a request.
	conn, err := b.dial(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	tlsConn := tls.Client(conn, &tls.Config{RootCAs: h.pool, ServerName: serverName, MinVersion: tls.VersionTLS13})
	if err = tlsConn.Handshake(); err != nil {
		t.Fatal(err)
	}
	defer tlsConn.Close()
	_, _ = io.WriteString(tlsConn, "GET / HTTP/1.1\r\nHost: "+h.authority()+"\r\nX-Slow: ")

	for name, c := range map[string]net.Conn{"silent connection": silent, "slow headers": tlsConn} {
		_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
		if _, err = c.Read(make([]byte, 1)); err == nil {
			t.Errorf("%s: the server sent data instead of closing", name)
		} else if isTimeout(err) {
			t.Errorf("%s: still open after 3s", name)
		}
	}
	if h.up.Hits() != 0 {
		t.Fatal("an incomplete request reached the upstream")
	}
}

func TestIdleKeepAliveConnectionsAreClosed(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Timeouts.Idle = 150 * time.Millisecond })
	b := h.browser(laptop, h.pair())
	conn, err := b.dial(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	tlsConn := tls.Client(conn, &tls.Config{RootCAs: h.pool, ServerName: serverName, MinVersion: tls.VersionTLS13})
	defer tlsConn.Close()
	_, _ = io.WriteString(tlsConn, "GET /health HTTP/1.1\r\nHost: "+h.authority()+"\r\nAuthorization: "+b.basic()+"\r\n\r\n")
	reader := bufio.NewReader(tlsConn)
	res, err := http.ReadResponse(reader, nil)
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("first request: %v %v", res, err)
	}
	_, _ = io.Copy(io.Discard, res.Body)
	_ = tlsConn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err = reader.ReadByte(); err == nil {
		t.Fatal("data on an idle connection")
	} else if isTimeout(err) {
		t.Fatal("an idle keep-alive connection stayed open")
	}
}

func TestLongLivedTunnelsOutliveTheRequestDeadlines(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) {
		c.Timeouts.ReadHeader = 150 * time.Millisecond
		c.Timeouts.Read = 300 * time.Millisecond
		c.Timeouts.Idle = 300 * time.Millisecond
	})
	b := h.browser(laptop, h.pair())
	s := mustOpen(t, b, "page")
	time.Sleep(900 * time.Millisecond)
	h.up.broadcast(1, event(allowedEvent, "late"))
	if _, _, err := s.read(t, 5*time.Second); err != nil {
		t.Fatalf("the tunnel did not survive past the request deadlines: %v", err)
	}
}

func TestConnectionsAreBounded(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Limits.MaxConnections = 2 })
	b := h.browser(laptop, h.pair())
	var idle []net.Conn
	for range 2 {
		conn, err := net.Dial("tcp", h.ln.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		idle = append(idle, conn)
	}
	// Both places are held by connections that have not spoken, so a third
	// client is not served.
	b.client.Timeout = 400 * time.Millisecond
	if _, err := b.sendErr(request{path: "/health"}); err == nil {
		t.Fatal("a third connection was served past the limit")
	}
	for _, conn := range idle {
		_ = conn.Close()
	}
	b.client.Timeout = 10 * time.Second
	eventually(t, 5*time.Second, "a place to free up", func() bool {
		res, err := b.sendErr(request{path: "/health"})
		return err == nil && res.status == http.StatusOK
	})
}

// TestASlowRequestBodyIsCutOff stalls a runtime call's body after its headers
// promised more. The whole-request deadline ends it.
func TestASlowRequestBodyIsCutOff(t *testing.T) {
	h := newHarness(t, func(c *gateway.Config) { c.Timeouts.Read = 500 * time.Millisecond })
	b := h.browser(laptop, h.pair())
	mustOpen(t, b, "page")
	conn, err := b.dial(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	tlsConn := tls.Client(conn, &tls.Config{RootCAs: h.pool, ServerName: serverName, MinVersion: tls.VersionTLS13})
	defer tlsConn.Close()
	_, _ = io.WriteString(tlsConn, "POST /wails/runtime HTTP/1.1\r\nHost: "+h.authority()+
		"\r\nAuthorization: "+b.basic()+"\r\nContent-Type: application/json\r\nX-Wails-Client-Id: page\r\nOrigin: "+
		b.origin()+"\r\nContent-Length: 100\r\n\r\n{\"obj")
	_ = tlsConn.SetReadDeadline(time.Now().Add(4 * time.Second))
	res, err := http.ReadResponse(bufio.NewReader(tlsConn), nil)
	if err != nil {
		if isTimeout(err) {
			t.Fatal("a stalled request body held the connection open")
		}
		return
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK {
		t.Fatal("a call with a truncated body succeeded")
	}
	if len(h.up.runtimeRecords()) != 0 {
		t.Fatal("a truncated call reached the upstream")
	}
}
