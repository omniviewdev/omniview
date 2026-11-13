package gateway

import (
	"net"
	"net/netip"
	"sync"
)

// addressListener limits what one remote address can do before any TLS or HTTP
// work happens: it holds at most a fixed number of open connections and may
// open them only at a bounded rate. A connection over either limit is closed
// at once. The global connection bound sits outside this wrapper, so a refused
// connection never takes one of its places.
//
// Pre-authentication resources are reachable by every peer that can open a
// TCP connection to the audit's port, and the limits here only share them
// out; restrict the port to the owner's devices with the tailnet's access
// controls.
type addressListener struct {
	net.Listener
	clock Clock
	max   int

	mu      sync.Mutex
	open    map[netip.Addr]int
	buckets addressBuckets
}

func newAddressListener(inner net.Listener, clock Clock, limits Limits) *addressListener {
	return &addressListener{
		Listener: inner,
		clock:    clock,
		max:      limits.MaxConnectionsPerAddress,
		mu:       sync.Mutex{},
		open:     make(map[netip.Addr]int),
		buckets:  newAddressBuckets(limits.AcceptBurst, limits.AcceptRefill),
	}
}

// Accept returns the next connection that is within the limits of its address.
func (l *addressListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		addr := connAddress(conn)
		if !l.admit(addr) {
			_ = conn.Close()
			continue
		}
		return &addressConn{
			Conn:    conn,
			release: sync.OnceFunc(func() { l.release(addr) }),
		}, nil
	}
}

func (l *addressListener) admit(addr netip.Addr) bool {
	now := l.clock.Now().Mono
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.open[addr] >= l.max {
		return false
	}
	bucket := l.buckets.get(addr, now)
	if !bucket.available(now) {
		return false
	}
	bucket.spend(now)
	l.open[addr]++
	return true
}

func (l *addressListener) release(addr netip.Addr) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.open[addr]--; l.open[addr] <= 0 {
		delete(l.open, addr)
	}
}

// openConnections is the number of connections currently held by addr.
func (l *addressListener) openConnections(addr netip.Addr) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.open[addr]
}

// connAddress is the unmapped remote IP of conn, or the zero address for a
// connection that has none; those share one set of limits.
func connAddress(conn net.Conn) netip.Addr {
	tcp, ok := conn.RemoteAddr().(*net.TCPAddr)
	if !ok {
		return netip.Addr{}
	}
	return tcp.AddrPort().Addr().Unmap()
}

// addressConn gives its address's place back when it closes.
type addressConn struct {
	net.Conn
	release func()
}

func (c *addressConn) Close() error {
	err := c.Conn.Close()
	c.release()
	return err
}
