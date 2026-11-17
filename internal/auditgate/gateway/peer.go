package gateway

import (
	"context"
	"errors"
	"net/netip"
	"sync"
	"time"
)

// Peer is the identity of the node behind an accepted connection.
type Peer struct {
	// UserID is the stable ID of the user that owns the node. It must be the
	// directory's stable ID, never an email address or display name.
	UserID string
	// NodeID is the stable ID of the node. The gateway pins a credential to the
	// first NodeID that authenticates with it.
	NodeID string
	// Tagged reports a node that tags own instead of a user. A tagged node has
	// no owning user and is always denied.
	Tagged bool
}

// Errors a [PeerIdentity] may return. The gateway denies on any error; these
// only let diagnostics tell the cases apart.
var (
	// ErrPeerUnknown is a remote address that maps to no node.
	ErrPeerUnknown = errors.New("gateway: remote address maps to no node")
	// ErrPeerAmbiguous is a remote address that maps to more than one node or
	// more than one owner.
	ErrPeerAmbiguous = errors.New("gateway: remote address maps to more than one node")
)

// PeerIdentity resolves the remote address of an accepted connection to the
// node behind it. The real implementation asks the local Tailscale daemon.
//
// The address is the remote address of the accepted socket, never a header
// value. An implementation must answer for exactly that address, return an
// error rather than a guess when the answer is missing or ambiguous, and honor
// ctx: the gateway bounds every lookup.
type PeerIdentity interface {
	Resolve(ctx context.Context, remote netip.AddrPort) (Peer, error)
}

// peerDenial is why the identity step refused a peer. The values are bounded
// codes for diagnostics.
type peerDenial string

const (
	peerAllowed      peerDenial = ""
	peerBadAddress   peerDenial = "peer_address"
	peerLookupFailed peerDenial = "peer_lookup_failed"
	peerAmbiguous    peerDenial = "peer_ambiguous"
	peerIncomplete   peerDenial = "peer_incomplete"
	peerTagged       peerDenial = "peer_tagged"
	peerNotOwner     peerDenial = "peer_not_owner"
	peerSelf         peerDenial = "peer_self"
)

// peerPolicy decides whether a resolved peer may use the audit.
type peerPolicy struct {
	owner     string
	localNode string
	allowSelf bool
}

func (p peerPolicy) judge(peer Peer, err error) peerDenial {
	switch {
	case errors.Is(err, ErrPeerAmbiguous):
		return peerAmbiguous
	case err != nil:
		return peerLookupFailed
	case peer.UserID == "" || peer.NodeID == "":
		return peerIncomplete
	case peer.Tagged:
		return peerTagged
	case peer.UserID != p.owner:
		return peerNotOwner
	case p.localNode != "" && peer.NodeID == p.localNode && !p.allowSelf:
		return peerSelf
	default:
		return peerAllowed
	}
}

// peerResult is one resolved and judged peer.
type peerResult struct {
	peer   Peer
	denial peerDenial
}

// peerResolver resolves and judges peers, remembering each answer for a short
// time per connection so a page load does not become hundreds of daemon
// lookups. A short lifetime bounds how stale an owner change can be.
type peerResolver struct {
	identity PeerIdentity
	policy   peerPolicy
	clock    Clock
	ttl      time.Duration
	timeout  time.Duration
	max      int

	mu      sync.Mutex
	entries map[netip.AddrPort]cachedPeer
}

type cachedPeer struct {
	result peerResult
	at     time.Duration
}

// maxCachedPeers bounds the per-connection cache. Entries are cheap; when the
// bound is hit the whole cache is dropped and refilled on demand.
const maxCachedPeers = 1024

func newPeerResolver(identity PeerIdentity, policy peerPolicy, clock Clock, ttl, timeout time.Duration) *peerResolver {
	return &peerResolver{
		identity: identity,
		policy:   policy,
		clock:    clock,
		ttl:      ttl,
		timeout:  timeout,
		max:      maxCachedPeers,
		mu:       sync.Mutex{},
		entries:  make(map[netip.AddrPort]cachedPeer),
	}
}

// resolve answers from the cache when the entry is fresh and asks the
// PeerIdentity otherwise.
func (r *peerResolver) resolve(ctx context.Context, remote netip.AddrPort) peerResult {
	if !remote.IsValid() {
		return peerResult{peer: noPeer(), denial: peerBadAddress}
	}
	remote = netip.AddrPortFrom(remote.Addr().Unmap(), remote.Port())
	now := r.clock.Now().Mono
	r.mu.Lock()
	entry, ok := r.entries[remote]
	r.mu.Unlock()
	if ok && now-entry.at < r.ttl {
		return entry.result
	}
	result := r.lookup(ctx, remote)
	r.mu.Lock()
	if len(r.entries) >= r.max {
		clear(r.entries)
	}
	r.entries[remote] = cachedPeer{result: result, at: now}
	r.mu.Unlock()
	return result
}

// fresh bypasses the cache. Live tunnels use it so an owner change is noticed
// within one recheck interval rather than one cache lifetime plus one interval.
func (r *peerResolver) fresh(ctx context.Context, remote netip.AddrPort) peerResult {
	if !remote.IsValid() {
		return peerResult{peer: noPeer(), denial: peerBadAddress}
	}
	return r.lookup(ctx, netip.AddrPortFrom(remote.Addr().Unmap(), remote.Port()))
}

func (r *peerResolver) lookup(ctx context.Context, remote netip.AddrPort) peerResult {
	ctx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	type answer struct {
		peer Peer
		err  error
	}
	// The lookup runs in its own goroutine so an implementation that ignores
	// ctx cannot hold the request past the timeout, and one that panics is a
	// failed lookup instead of a crashed process.
	answered := make(chan answer, 1)
	go func() {
		defer func() {
			if recover() != nil {
				answered <- answer{peer: noPeer(), err: errPeerLookupPanicked}
			}
		}()
		peer, err := r.identity.Resolve(ctx, remote)
		answered <- answer{peer: peer, err: err}
	}()
	select {
	case a := <-answered:
		return peerResult{peer: a.peer, denial: r.policy.judge(a.peer, a.err)}
	case <-ctx.Done():
		return peerResult{peer: noPeer(), denial: peerLookupFailed}
	}
}

// noPeer is the peer of a lookup that produced none.
func noPeer() Peer {
	var none Peer
	return none
}

var errPeerLookupPanicked = errors.New("gateway: the peer lookup panicked")
