package gateway_test

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

// addressOnly is an Upstream that reports an address and nothing else.
type addressOnly struct{ addr string }

func (a addressOnly) Address() netip.AddrPort { return netip.MustParseAddrPort(a.addr) }

func (addressOnly) Verify(context.Context) error { return nil }

// hangingUpstream verifies normally until told to hang, and then never
// returns, ignoring its context, as a wedged control plane would.
type hangingUpstream struct {
	*fakeWails
	hang    atomic.Bool
	release chan struct{}
}

func (h *hangingUpstream) Verify(ctx context.Context) error {
	if h.hang.Load() {
		<-h.release
	}
	return h.fakeWails.Verify(ctx)
}

func fmtValue(v any) string { return fmt.Sprintf("%+v", v) }

// plainServer serves a gateway through net/http's own TLS server instead of
// [gateway.Gateway.Serve]: it does not enforce the server name in the
// handshake and the audit's end does not close its connections. It stands for
// an owner that serves the handler itself, and shows what the handler enforces
// on its own.
type plainServer struct {
	gw         *gateway.Gateway
	up         *fakeWails
	peers      *fakePeers
	pool       *x509.CertPool
	port       int
	credential credential
	addr       string
}

func startPlainServer(t *testing.T, adjust ...func(*gateway.Config)) *plainServer {
	t.Helper()
	cert, pool := testCertificate(t, serverName)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &plainServer{
		up: newFakeWails(t), peers: newFakePeers(), pool: pool,
		port: tcpAddr(ln.Addr()).Port, addr: ln.Addr().String(),
	}
	cfg := gateway.Config{
		ServerName: serverName, Port: s.port, OwnerID: ownerID, LocalNodeID: hostNodeID, Peers: s.peers, Upstream: s.up, Clock: newFakeClock(),
		Timeouts: fastTimeouts(),
	}
	for _, change := range adjust {
		change(&cfg)
	}
	if s.gw, err = gateway.New(t.Context(), cfg); err != nil {
		t.Fatal(err)
	}
	offer, err := s.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	channel := &memoryChannel{}
	info, err := s.gw.Exchange(t.Context(), offer.Code, channel, gateway.ExchangeOptions{})
	if err != nil {
		t.Fatal(err)
	}
	s.credential = credential{info: info, username: info.Username, secret: channel.secret}

	server := httptest.NewUnstartedServer(s.gw)
	_ = server.Listener.Close()
	server.Listener = ln
	server.TLS = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13}
	server.StartTLS()
	t.Cleanup(server.Close)
	t.Cleanup(func() { _ = s.gw.Stop(context.Background()) })
	return s
}

func (s *plainServer) authority() string {
	return net.JoinHostPort(serverName, strconv.Itoa(s.port))
}

// authorization is the Authorization header value for the server's credential.
func (s *plainServer) authorization() string {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.SetBasicAuth(s.credential.username, s.credential.secret)
	return req.Header.Get("Authorization")
}

// dial connects as the owner's laptop, with the given SNI.
func (s *plainServer) dial(t *testing.T, sni string) (*tls.Conn, net.Conn) {
	t.Helper()
	conn, err := net.Dial("tcp", s.addr)
	if err != nil {
		t.Fatal(err)
	}
	s.peers.set(conn.LocalAddr(), laptop, nil)
	config := &tls.Config{RootCAs: s.pool, ServerName: sni, MinVersion: tls.VersionTLS13}
	if sni != serverName {
		config = &tls.Config{InsecureSkipVerify: true, ServerName: sni, MinVersion: tls.VersionTLS13} //nolint:gosec // The test is about what the handler does with the name.
	}
	client := tls.Client(conn, config)
	_ = client.SetDeadline(time.Now().Add(10 * time.Second))
	if err = client.Handshake(); err != nil {
		_ = conn.Close()
		t.Fatalf("handshake with SNI %q: %v", sni, err)
	}
	return client, conn
}

// get sends one GET / with the server's credential and the given Host line.
func (s *plainServer) get(t *testing.T, sni, host string) int {
	t.Helper()
	client, conn := s.dial(t, sni)
	defer conn.Close()
	_, _ = io.WriteString(client, "GET / HTTP/1.1\r\nHost: "+host+"\r\nAuthorization: "+s.authorization()+"\r\nConnection: close\r\n\r\n")
	res, err := http.ReadResponse(bufio.NewReader(client), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	return res.StatusCode
}

// tcpAddr is addr as the TCP address every test connection has.
func tcpAddr(addr net.Addr) *net.TCPAddr {
	tcp, ok := addr.(*net.TCPAddr)
	if !ok {
		panic(fmt.Sprintf("not a TCP address: %T", addr))
	}
	return tcp
}

// isTimeout reports whether err is a network timeout.
func isTimeout(err error) bool {
	var timeout net.Error
	return errors.As(err, &timeout) && timeout.Timeout()
}

// tlsOver starts a TLS client on conn that trusts the test certificate.
func (b *browser) tlsOver(conn net.Conn) *tls.Conn {
	return tls.Client(conn, &tls.Config{RootCAs: b.h.pool, ServerName: serverName, MinVersion: tls.VersionTLS13})
}
