package gateway

import (
	"context"
	"net/netip"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// stepClock is a Clock for white-box tests.
type stepClock struct {
	mu   sync.Mutex
	wall time.Time
	mono time.Duration
}

func newStepClock() *stepClock {
	return &stepClock{wall: time.Date(2026, time.November, 8, 12, 0, 0, 0, time.UTC), mono: time.Hour}
}

func (c *stepClock) Now() Instant {
	c.mu.Lock()
	defer c.mu.Unlock()
	return Instant{Wall: c.wall, Mono: c.mono}
}

func (c *stepClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.wall = c.wall.Add(d)
	c.mono += d
}

// countingPeers answers every lookup with one peer and counts the lookups. If
// delay is set, a lookup waits for it to be closed and ignores its context.
type countingPeers struct {
	peer    Peer
	err     error
	delay   chan struct{}
	lookups atomic.Int64
}

func (p *countingPeers) Resolve(_ context.Context, _ netip.AddrPort) (Peer, error) {
	p.lookups.Add(1)
	if p.delay != nil {
		<-p.delay
	}
	return p.peer, p.err
}

// loopbackUpstream is an Upstream with a fixed address that always verifies.
type loopbackUpstream struct{}

func (loopbackUpstream) Address() netip.AddrPort { return netip.MustParseAddrPort("127.0.0.1:34115") }

func (loopbackUpstream) Verify(context.Context) error { return nil }

// newTestGateway builds a gateway with no listener for white-box tests.
func newTestGateway(t *testing.T, adjust ...func(*Config)) (*Gateway, *stepClock) {
	t.Helper()
	clock := newStepClock()
	cfg := Config{
		ServerName:  "audit.example.ts.net",
		Port:        8443,
		OwnerID:     "owner",
		LocalNodeID: "host-node",
		Peers:       &countingPeers{peer: Peer{UserID: "owner", NodeID: "node", Tagged: false}},
		Upstream:    loopbackUpstream{},
		Clock:       clock,
		Timeouts:    Timeouts{Watch: time.Hour},
	}
	for _, change := range adjust {
		change(&cfg)
	}
	gw, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = gw.Stop(context.Background()) })
	return gw, clock
}

// issueForTest puts an active credential in the table and returns its username
// and secret, in that order, bypassing pairing.
func issueForTest(t *testing.T, gw *Gateway, clock Clock) (string, string) {
	t.Helper()
	m, err := gw.mint()
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	now := clock.Now()
	var events []Event
	gw.mu.Lock()
	place, err := gw.placeLocked(now, 0, &m, &events)
	gw.mu.Unlock()
	if err != nil {
		t.Fatalf("placeLocked: %v", err)
	}
	if err = gw.activate(m.id, place.index); err != nil {
		t.Fatalf("activate: %v", err)
	}
	return m.username, string(m.secret)
}
