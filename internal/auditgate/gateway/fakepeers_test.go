package gateway_test

import (
	"context"
	"net"
	"net/netip"
	"sync"
	"sync/atomic"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
)

const (
	ownerID     = "user-owner"
	otherUserID = "user-other"
	// hostNodeID is the node the gateway itself runs on.
	hostNodeID = "node-host"
)

// Identities the tests use. The fake directory knows nodes by the local address
// of the connection a test client dialed.
var (
	laptop = gateway.Peer{UserID: ownerID, NodeID: "node-laptop", Tagged: false} //nolint:gochecknoglobals // Test fixture.
	phone  = gateway.Peer{UserID: ownerID, NodeID: "node-phone", Tagged: false}  //nolint:gochecknoglobals // Test fixture.
)

type peerAnswer struct {
	peer gateway.Peer
	err  error
}

// fakePeers is a PeerIdentity backed by a table filled in as test clients
// connect. A connection from an address it was never told about is an unknown
// node.
type fakePeers struct {
	mu      sync.Mutex
	answers map[netip.AddrPort]peerAnswer
	gate    chan struct{}
	lookups atomic.Int64
}

func newFakePeers() *fakePeers {
	return &fakePeers{answers: make(map[netip.AddrPort]peerAnswer)}
}

func (f *fakePeers) Resolve(ctx context.Context, remote netip.AddrPort) (gateway.Peer, error) {
	f.lookups.Add(1)
	f.mu.Lock()
	gate := f.gate
	answer, ok := f.answers[remote]
	f.mu.Unlock()
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return gateway.Peer{}, ctx.Err()
		}
	}
	if !ok {
		return gateway.Peer{}, gateway.ErrPeerUnknown
	}
	return answer.peer, answer.err
}

// set records the answer for one connection's local address.
func (f *fakePeers) set(addr net.Addr, peer gateway.Peer, err error) {
	remote := tcpAddr(addr).AddrPort()
	f.mu.Lock()
	f.answers[remote] = peerAnswer{peer: peer, err: err}
	f.mu.Unlock()
}

// setAll changes the answer for every connection already known, as an owner or
// ACL change on the tailnet would.
func (f *fakePeers) setAll(peer gateway.Peer, err error) {
	f.mu.Lock()
	for remote := range f.answers {
		f.answers[remote] = peerAnswer{peer: peer, err: err}
	}
	f.mu.Unlock()
}

// hold makes every lookup wait until the returned function is called, as a
// slow daemon would.
func (f *fakePeers) hold() func() {
	gate := make(chan struct{})
	f.mu.Lock()
	f.gate = gate
	f.mu.Unlock()
	var once sync.Once
	return func() { once.Do(func() { close(gate) }) }
}
