package gateway_test

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"io"
	"math/big"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

const serverName = "audit.example.ts.net"

// testCertificate is a self-signed certificate for serverName that also serves
// as its own trust root.
func testCertificate(t *testing.T, names ...string) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: names[0]},
		DNSNames:              names,
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(leaf)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key, Leaf: leaf}, pool
}

// eventLog collects the gateway's diagnostics.
type eventLog struct {
	mu     sync.Mutex
	events []gateway.Event
}

func (l *eventLog) add(event gateway.Event) {
	l.mu.Lock()
	l.events = append(l.events, event)
	l.mu.Unlock()
}

func (l *eventLog) all() []gateway.Event {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]gateway.Event(nil), l.events...)
}

func (l *eventLog) count(kind gateway.EventKind) int {
	n := 0
	for _, event := range l.all() {
		if event.Kind == kind {
			n++
		}
	}
	return n
}

// harness is a gateway serving over real TLS on a loopback port, in front of a
// fake Wails server.
type harness struct {
	t      *testing.T
	clock  *fakeClock
	peers  *fakePeers
	up     *fakeWails
	gw     *gateway.Gateway
	events *eventLog
	ln     net.Listener
	port   int
	pool   *x509.CertPool
	served chan error
	certs  int
	mu     sync.Mutex
}

// fastTimeouts keep the background checks quick in tests; deadlines the tests
// are not about stay generous.
func fastTimeouts() gateway.Timeouts {
	return gateway.Timeouts{
		ReadHeader:   2 * time.Second,
		Read:         5 * time.Second,
		Idle:         5 * time.Second,
		RuntimeCall:  10 * time.Second,
		Static:       10 * time.Second,
		UpstreamDial: time.Second,
		TunnelWrite:  2 * time.Second,
		TunnelPing:   time.Minute,
		TunnelPong:   time.Second,
		Watch:        10 * time.Millisecond,
		Verify:       time.Second,
		PeerLookup:   time.Second,
		PeerCache:    -1,
		PeerRecheck:  10 * time.Millisecond,
		CloseGrace:   500 * time.Millisecond,
		BindWait:     -1,
		CallDrain:    500 * time.Millisecond,
		Shutdown:     5 * time.Second,
	}
}

func newHarness(t *testing.T, adjust ...func(*gateway.Config)) *harness {
	t.Helper()
	cert, pool := testCertificate(t, serverName)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{
		t: t, clock: newFakeClock(), peers: newFakePeers(), up: newFakeWails(t),
		events: &eventLog{}, ln: ln, port: tcpAddr(ln.Addr()).Port, pool: pool,
		served: make(chan error, 1),
	}
	cfg := gateway.Config{
		ServerName:  serverName,
		Port:        h.port,
		OwnerID:     ownerID,
		LocalNodeID: hostNodeID,
		Peers:       h.peers,
		Upstream:    h.up,
		Clock:       h.clock,
		TTL:         time.Hour,
		Timeouts:    fastTimeouts(),
		Events:      h.events.add,
		// Every test client connects from 127.0.0.1, so the per-address
		// limits that tests are not about must not get in their way.
		Limits: gateway.Limits{
			MaxConnectionsPerAddress: 10000, MaxUnauthenticatedPerAddress: 10000,
			AcceptBurst: 1 << 20, AcceptRefill: time.Microsecond,
		},
	}
	for _, change := range adjust {
		change(&cfg)
	}
	gw, err := gateway.New(context.Background(), cfg)
	if err != nil {
		_ = ln.Close()
		t.Fatal(err)
	}
	h.gw = gw
	getCert := func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
		h.mu.Lock()
		h.certs++
		h.mu.Unlock()
		return &cert, nil
	}
	go func() { h.served <- gw.Serve(ln, getCert) }()
	t.Cleanup(h.close)
	return h
}

func (h *harness) close() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = h.gw.Stop(ctx)
	select {
	case <-h.served:
	case <-time.After(10 * time.Second):
		h.t.Error("Serve did not return after the audit ended")
	}
}

// certificateCalls is how many times the certificate callback ran.
func (h *harness) certificateCalls() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.certs
}

// memoryChannel is a SecretChannel that keeps the credential for the test.
type memoryChannel struct {
	credential gateway.IssuedCredential
	secret     string
	err        error
	discarded  []string
}

func (m *memoryChannel) Deliver(_ context.Context, credential gateway.IssuedCredential) error {
	if m.err != nil {
		return m.err
	}
	m.credential = credential
	m.secret = string(credential.Secret)
	m.credential.Secret = nil
	return nil
}

func (m *memoryChannel) Discard(_ context.Context, credentialID string) {
	m.discarded = append(m.discarded, credentialID)
}

// credential is what a browser would be given.
type credential struct {
	info     gateway.CredentialInfo
	username string
	secret   string
}

// pair issues a credential the way the owner does: a pairing code, exchanged
// once.
func (h *harness) pair() credential {
	h.t.Helper()
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		h.t.Fatalf("NewPairing: %v", err)
	}
	channel := &memoryChannel{}
	info, err := h.gw.Exchange(context.Background(), offer.Code, channel, gateway.ExchangeOptions{})
	if err != nil {
		h.t.Fatalf("Exchange: %v", err)
	}
	return credential{info: info, username: info.Username, secret: channel.secret}
}

// browser is a client on one tailnet node. Every connection it opens is
// registered with the fake peer directory as that node.
type browser struct {
	t      *testing.T
	h      *harness
	peer   gateway.Peer
	cred   credential
	client *http.Client
	// err is what the fake directory answers for this node's connections.
	err error
	// unregistered leaves the node out of the directory: an unknown address.
	unregistered bool
}

func (h *harness) browser(peer gateway.Peer, cred credential) *browser {
	b := &browser{t: h.t, h: h, peer: peer, cred: cred, err: nil, client: nil}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return b.dial(ctx)
		},
		TLSClientConfig:   &tls.Config{RootCAs: h.pool, ServerName: serverName, MinVersion: tls.VersionTLS13},
		DisableKeepAlives: false,
	}
	b.client = &http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Timeout: 20 * time.Second,
	}
	h.t.Cleanup(transport.CloseIdleConnections)
	return b
}

// dial connects to the gateway and records the connection's local address as
// this browser's node.
func (b *browser) dial(ctx context.Context) (net.Conn, error) {
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", b.h.ln.Addr().String())
	if err != nil {
		return nil, err
	}
	if !b.unregistered {
		b.h.peers.set(conn.LocalAddr(), b.peer, b.err)
	}
	return conn, nil
}

func (b *browser) url(path string) string {
	return "https://" + b.h.authority() + path
}

func (b *browser) origin() string { return "https://" + b.h.authority() }

// authority is the Host a page uses: the configured name and the test port.
func (h *harness) authority() string { return h.authorityFor(serverName) }

func (h *harness) authorityFor(name string) string {
	return net.JoinHostPort(name, strconv.Itoa(h.port))
}

// request is a request a test builds; send fills in credentials unless told not to.
type request struct {
	method string
	path   string
	header http.Header
	body   string
	// anonymous leaves the Authorization header off.
	anonymous bool
}

type response struct {
	status int
	header http.Header
	body   string
}

func (b *browser) send(r request) response {
	b.t.Helper()
	res, err := b.sendErr(r)
	if err != nil {
		b.t.Fatalf("%s %s: %v", r.method, r.path, err)
	}
	return res
}

func (b *browser) sendErr(r request) (response, error) {
	method := r.method
	if method == "" {
		method = http.MethodGet
	}
	var body io.Reader
	if r.body != "" {
		body = strings.NewReader(r.body)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, b.url(r.path), body)
	if err != nil {
		return response{}, err
	}
	for name, values := range r.header {
		req.Header[name] = values
	}
	if !r.anonymous && req.Header.Get("Authorization") == "" {
		req.SetBasicAuth(b.cred.username, b.cred.secret)
	}
	res, err := b.client.Do(req)
	if err != nil {
		return response{}, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	return response{status: res.StatusCode, header: res.Header, body: string(data)}, err
}

// get is an authenticated same-origin GET, as the page's subresource loads are.
func (b *browser) get(path string) response {
	b.t.Helper()
	return b.send(request{path: path})
}

// call posts a runtime call as the page's own client ID, same-origin.
func (b *browser) call(clientID, body string) response {
	b.t.Helper()
	header := http.Header{
		"Content-Type":      {"application/json"},
		"X-Wails-Client-Id": {clientID},
		"Origin":            {b.origin()},
		"Sec-Fetch-Site":    {"same-origin"},
	}
	return b.send(request{method: http.MethodPost, path: "/wails/runtime", header: header, body: body})
}

// socket is the page's events socket. A background reader plays the browser's
// part: it answers the server's pings and close handshake and keeps what
// arrives for the test to read. A socket opened with openEventsNoRead has no
// reader: it stops reading at once, as a stalled page does.
type socket struct {
	conn *websocket.Conn
	resp *http.Response
	msgs chan socketMessage
	done chan struct{}

	mu       sync.Mutex
	closeErr error
}

type socketMessage struct {
	kind websocket.MessageType
	data []byte
}

func newSocket(conn *websocket.Conn, resp *http.Response, reading bool) *socket {
	s := &socket{
		conn: conn, resp: resp, msgs: make(chan socketMessage, 4096), done: make(chan struct{}),
		mu: sync.Mutex{}, closeErr: nil,
	}
	if !reading {
		return s
	}
	go func() {
		defer close(s.done)
		for {
			kind, data, err := conn.Read(context.Background())
			if err != nil {
				s.mu.Lock()
				s.closeErr = err
				s.mu.Unlock()
				return
			}
			s.msgs <- socketMessage{kind: kind, data: data}
		}
	}()
	return s
}

// closeStatus is the status of the close frame the server sent, or -1 when
// the socket ended some other way or has not ended.
func (s *socket) closeStatus() websocket.StatusCode {
	s.mu.Lock()
	defer s.mu.Unlock()
	return websocket.CloseStatus(s.closeErr)
}

// openEvents opens the page's events WebSocket as a same-origin page would.
func (b *browser) openEvents(clientID string, anonymous bool) (*socket, error) {
	return b.openEventsMode(clientID, anonymous, true)
}

// openEventsNoRead opens it and never reads from it.
func (b *browser) openEventsNoRead(clientID string) (*socket, error) {
	return b.openEventsMode(clientID, false, false)
}

func (b *browser) openEventsMode(clientID string, anonymous, reading bool) (*socket, error) {
	header := http.Header{"Origin": {b.origin()}}
	if !anonymous {
		req, _ := http.NewRequest(http.MethodGet, b.url("/"), nil)
		req.SetBasicAuth(b.cred.username, b.cred.secret)
		header.Set("Authorization", req.Header.Get("Authorization"))
	}
	return b.openEventsWith("/wails/events?clientId="+clientID, header, reading)
}

func (b *browser) openEventsWith(path string, header http.Header, reading bool) (*socket, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, "wss://"+b.h.authority()+path, &websocket.DialOptions{
		HTTPClient: b.client,
		HTTPHeader: header,
	})
	if err != nil {
		return &socket{conn: nil, resp: resp, msgs: nil, done: nil, mu: sync.Mutex{}, closeErr: nil}, err
	}
	conn.SetReadLimit(64 << 20)
	return newSocket(conn, resp, reading), nil
}

// read waits for the next message, or reports that the socket closed first.
func (s *socket) read(t *testing.T, timeout time.Duration) (websocket.MessageType, []byte, error) {
	t.Helper()
	select {
	case m := <-s.msgs:
		return m.kind, m.data, nil
	case <-s.done:
		select {
		case m := <-s.msgs:
			return m.kind, m.data, nil
		default:
			return 0, nil, io.EOF
		}
	case <-time.After(timeout):
		return 0, nil, context.DeadlineExceeded
	}
}

// expectClosed fails unless the socket closes within timeout.
func (s *socket) expectClosed(t *testing.T, timeout time.Duration) {
	t.Helper()
	select {
	case <-s.done:
	case <-time.After(timeout):
		t.Fatalf("socket did not close within %v", timeout)
	}
}

// raw sends hand-built bytes over TLS as this browser's node and returns the
// status, headers and body of the first response. It is how requests net/http
// would never write are tested.
func (b *browser) raw(request string) (int, http.Header, string) {
	b.t.Helper()
	conn, err := b.dial(context.Background())
	if err != nil {
		b.t.Fatal(err)
	}
	tlsConn := tls.Client(conn, &tls.Config{RootCAs: b.h.pool, ServerName: serverName, MinVersion: tls.VersionTLS13})
	defer tlsConn.Close()
	_ = tlsConn.SetDeadline(time.Now().Add(10 * time.Second))
	if _, err = tlsConn.Write([]byte(request)); err != nil {
		b.t.Fatal(err)
	}
	res, err := http.ReadResponse(bufio.NewReader(tlsConn), nil)
	if err != nil {
		return 0, nil, err.Error()
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	return res.StatusCode, res.Header, string(data)
}

// basic is the Authorization header value for the browser's credential.
func (b *browser) basic() string {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.SetBasicAuth(b.cred.username, b.cred.secret)
	return req.Header.Get("Authorization")
}

// eventually polls until check passes.
func eventually(t *testing.T, timeout time.Duration, what string, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func ended(gw *gateway.Gateway) bool {
	select {
	case <-gw.Ended():
		return true
	default:
		return false
	}
}
