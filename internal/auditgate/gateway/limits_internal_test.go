package gateway

import (
	"net"
	"net/netip"
	"testing"
	"time"
)

func TestFailureLimiterIsPerAddressAndRefills(t *testing.T) {
	limits := Limits{}.withDefaults()
	limits.FailureBurst = 3
	limits.FailureRefill = 10 * time.Second
	limits.GlobalFailureBurst = 1000
	limiter := newFailureLimiter(limits, 0)
	now := time.Duration(0)
	noisy, quiet := netip.MustParseAddr("100.64.0.1"), netip.MustParseAddr("100.64.0.2")

	for range 3 {
		if !limiter.available(noisy, now) {
			t.Fatal("limited before the burst was used")
		}
		limiter.fail(noisy, now)
	}
	if limiter.available(noisy, now) {
		t.Fatal("not limited after the burst")
	}
	if !limiter.available(quiet, now) {
		t.Fatal("one address's failures limited another")
	}
	now += 9 * time.Second
	if limiter.available(noisy, now) {
		t.Fatal("refilled early")
	}
	now += 2 * time.Second
	if !limiter.available(noisy, now) {
		t.Fatal("not refilled after one refill interval")
	}
	limiter.fail(noisy, now)
	if limiter.available(noisy, now) {
		t.Fatal("a refilled attempt was not spent")
	}
}

func TestFailureLimiterHasAGlobalCeiling(t *testing.T) {
	limits := Limits{}.withDefaults()
	limits.FailureBurst = 1000
	limits.GlobalFailureBurst = 5
	limits.GlobalFailureRefill = time.Minute
	limiter := newFailureLimiter(limits, 0)
	for i := range 5 {
		limiter.fail(netip.AddrFrom4([4]byte{100, 64, 0, byte(i)}), 0)
	}
	if limiter.available(netip.MustParseAddr("100.64.9.9"), 0) {
		t.Fatal("an address that never failed was not limited once the global allowance was gone")
	}
	if !limiter.available(netip.MustParseAddr("100.64.9.9"), 2*time.Minute) {
		t.Fatal("the global allowance did not refill")
	}
}

func TestFailureLimiterMemoryIsBounded(t *testing.T) {
	limits := Limits{}.withDefaults()
	limits.GlobalFailureBurst = 1 << 20
	limiter := newFailureLimiter(limits, 0)
	for i := range 4 * maxLimiterKeys {
		limiter.fail(netip.AddrFrom4([4]byte{10, byte(i >> 16), byte(i >> 8), byte(i)}), 0)
	}
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	if len(limiter.addresses.byAddr) > maxLimiterKeys {
		t.Fatalf("the per-address table grew to %d entries, bound is %d", len(limiter.addresses.byAddr), maxLimiterKeys)
	}
}

func TestAdmissionBoundsConcurrentWorkOverallAndPerAddress(t *testing.T) {
	admit := newAdmission(3, 2)
	a, b := netip.MustParseAddr("100.64.0.1"), netip.MustParseAddr("100.64.0.2")

	first, ok := admit.enter(a)
	if !ok {
		t.Fatal("first place refused")
	}
	second, ok := admit.enter(a)
	if !ok {
		t.Fatal("second place of one address refused")
	}
	if _, ok = admit.enter(a); ok {
		t.Fatal("a third place went to an address with a limit of two")
	}
	third, ok := admit.enter(b)
	if !ok {
		t.Fatal("another address was refused a free place")
	}
	if _, ok = admit.enter(b); ok {
		t.Fatal("a place was granted past the overall limit")
	}

	first()
	first() // releasing twice must not free a place twice
	fourth, ok := admit.enter(b)
	if !ok {
		t.Fatal("a released place was not reusable")
	}
	if _, ok = admit.enter(b); ok {
		t.Fatal("a double release freed a second place")
	}
	second()
	third()
	fourth()

	admit.mu.Lock()
	defer admit.mu.Unlock()
	if admit.total != 0 || len(admit.byAddr) != 0 {
		t.Fatalf("places leaked: total %d, %d addresses", admit.total, len(admit.byAddr))
	}
}

func TestLimitsDefaults(t *testing.T) {
	got := Limits{}.withDefaults()
	if got.MaxTunnelsPerCredential != 2 || got.MaxTunnels != 4 || got.MaxEventSocketOpens != 16 {
		t.Fatalf("tunnel defaults %+v: the host retains state per socket, so they must stay small", got)
	}
	if got.MaxUnauthenticatedPerAddress >= got.MaxUnauthenticated || got.MaxConnectionsPerAddress >= got.MaxConnections {
		t.Fatalf("per-address defaults %+v must be a share of the overall limits", got)
	}
	if got.TunnelQueueBytes <= 0 || got.AcceptBurst <= 0 || got.AcceptRefill <= 0 {
		t.Fatalf("a bound defaults to zero, which would mean no bound: %+v", got)
	}
	kept := Limits{MaxTunnels: 9}.withDefaults()
	if kept.MaxTunnels != 9 {
		t.Fatal("an explicit limit was overwritten")
	}
}

// fakeListener hands out the connections it is given.
type fakeListener struct {
	conns  chan net.Conn
	closed chan struct{}
}

func newFakeListener() *fakeListener {
	return &fakeListener{conns: make(chan net.Conn, 64), closed: make(chan struct{})}
}

func (l *fakeListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.conns:
		return c, nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}

func (l *fakeListener) Close() error   { close(l.closed); return nil }
func (l *fakeListener) Addr() net.Addr { return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 1} }

// fakeConn is a connection from a chosen remote address.
type fakeConn struct {
	net.Conn
	remote  *net.TCPAddr
	closed  chan struct{}
	closeFn func()
}

func newFakeConn(ip string, port int) *fakeConn {
	server, client := net.Pipe()
	_ = client.Close()
	c := &fakeConn{Conn: server, remote: &net.TCPAddr{IP: net.ParseIP(ip), Port: port}, closed: make(chan struct{})}
	c.closeFn = func() { close(c.closed) }
	return c
}

func (c *fakeConn) RemoteAddr() net.Addr { return c.remote }

func (c *fakeConn) Close() error {
	select {
	case <-c.closed:
	default:
		c.closeFn()
	}
	return c.Conn.Close()
}

func (c *fakeConn) isClosed() bool {
	select {
	case <-c.closed:
		return true
	default:
		return false
	}
}

func TestAddressListenerCapsOpenConnectionsPerAddress(t *testing.T) {
	inner := newFakeListener()
	limits := Limits{}.withDefaults()
	limits.MaxConnectionsPerAddress = 2
	limits.AcceptBurst = 100
	listener := newAddressListener(inner, newStepClock(), limits)
	address := netip.MustParseAddr("100.64.0.1")

	first, second, third := newFakeConn("100.64.0.1", 1), newFakeConn("100.64.0.1", 2), newFakeConn("100.64.0.1", 3)
	other := newFakeConn("100.64.0.2", 4)
	for _, c := range []*fakeConn{first, second, third, other} {
		inner.conns <- c
	}
	accepted := make([]net.Conn, 0, 3)
	for range 3 {
		c, err := listener.Accept()
		if err != nil {
			t.Fatal(err)
		}
		accepted = append(accepted, c)
	}
	if !third.isClosed() {
		t.Fatal("a third connection from one address was not closed")
	}
	if first.isClosed() || second.isClosed() || other.isClosed() {
		t.Fatal("a connection within its limits was closed")
	}
	if got := listener.openConnections(address); got != 2 {
		t.Fatalf("open connections = %d, want 2", got)
	}

	// A closed connection gives its place back, and a double close gives back
	// only one.
	_ = accepted[0].Close()
	_ = accepted[0].Close()
	if got := listener.openConnections(address); got != 1 {
		t.Fatalf("open connections after closing one = %d, want 1", got)
	}
	again := newFakeConn("100.64.0.1", 5)
	inner.conns <- again
	c, err := listener.Accept()
	if err != nil || again.isClosed() {
		t.Fatalf("a freed place was not reusable: %v", err)
	}
	_ = c.Close()
}

func TestAddressListenerLimitsHowFastAnAddressMayConnect(t *testing.T) {
	inner := newFakeListener()
	clock := newStepClock()
	limits := Limits{}.withDefaults()
	limits.AcceptBurst = 3
	limits.AcceptRefill = time.Second
	limits.MaxConnectionsPerAddress = 100
	listener := newAddressListener(inner, clock, limits)

	var conns []*fakeConn
	for i := range 5 {
		c := newFakeConn("100.64.0.1", i+1)
		conns = append(conns, c)
		inner.conns <- c
	}
	for range 3 {
		if _, err := listener.Accept(); err != nil {
			t.Fatal(err)
		}
	}
	// The fourth and fifth were over the burst: closed without being returned.
	accepted := make(chan net.Conn, 1)
	go func() {
		c, _ := listener.Accept()
		accepted <- c
	}()
	eventually(t, 5*time.Second, "the connections over the accept rate to be closed", func() bool {
		return conns[3].isClosed() && conns[4].isClosed()
	})
	// After the allowance refills, the next connection is served.
	clock.advance(2 * time.Second)
	next := newFakeConn("100.64.0.1", 9)
	inner.conns <- next
	select {
	case c := <-accepted:
		if c == nil || next.isClosed() {
			t.Fatal("the refilled allowance did not admit a connection")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no connection was accepted after the allowance refilled")
	}
	_ = inner.Close()
}

func TestAddressListenerSharesOneLimitAmongUnknownAddresses(t *testing.T) {
	if connAddress(newFakeConn("100.64.0.1", 1)).String() != "100.64.0.1" {
		t.Fatal("a TCP address was not read")
	}
	mapped := newFakeConn("::ffff:100.64.0.1", 1)
	if connAddress(mapped) != netip.MustParseAddr("100.64.0.1") {
		t.Fatal("an IPv4-mapped address was not unmapped")
	}
	pipe, other := net.Pipe()
	defer other.Close()
	defer pipe.Close()
	if connAddress(pipe).IsValid() {
		t.Fatal("a connection with no TCP address got a real address")
	}
}
