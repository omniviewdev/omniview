package gateway

import (
	"context"
	"errors"
	"net/netip"
	"testing"
	"time"
)

func TestPeerPolicyJudgesEveryCase(t *testing.T) {
	policy := peerPolicy{owner: "owner", localNode: "self", allowSelf: false}
	cases := []struct {
		name string
		peer Peer
		err  error
		want peerDenial
	}{
		{"owner's node", Peer{UserID: "owner", NodeID: "n1", Tagged: false}, nil, peerAllowed},
		{"another user", Peer{UserID: "someone", NodeID: "n1", Tagged: false}, nil, peerNotOwner},
		{"tagged node of the owner", Peer{UserID: "owner", NodeID: "n1", Tagged: true}, nil, peerTagged},
		{"tagged node with no user", Peer{UserID: "", NodeID: "n1", Tagged: true}, nil, peerIncomplete},
		{"no node ID", Peer{UserID: "owner", NodeID: "", Tagged: false}, nil, peerIncomplete},
		{"no user ID", Peer{UserID: "", NodeID: "n1", Tagged: false}, nil, peerIncomplete},
		{"lookup error", Peer{UserID: "owner", NodeID: "n1", Tagged: false}, errors.New("daemon"), peerLookupFailed},
		{"ambiguous", Peer{UserID: "owner", NodeID: "n1", Tagged: false}, ErrPeerAmbiguous, peerAmbiguous},
		{"wrapped ambiguous", Peer{}, errors.Join(errors.New("x"), ErrPeerAmbiguous), peerAmbiguous},
		{"unknown", Peer{}, ErrPeerUnknown, peerLookupFailed},
		{"the local node", Peer{UserID: "owner", NodeID: "self", Tagged: false}, nil, peerSelf},
	}
	for _, tc := range cases {
		if got := policy.judge(tc.peer, tc.err); got != tc.want {
			t.Errorf("%s: %q, want %q", tc.name, got, tc.want)
		}
	}
	policy.allowSelf = true
	if got := policy.judge(Peer{UserID: "owner", NodeID: "self", Tagged: false}, nil); got != peerAllowed {
		t.Errorf("the local node with AllowSelf: %q", got)
	}
	// With no LocalNodeID configured nothing is self.
	policy = peerPolicy{owner: "owner", localNode: "", allowSelf: false}
	if got := policy.judge(Peer{UserID: "owner", NodeID: "", Tagged: false}, nil); got != peerIncomplete {
		t.Errorf("empty node ID without a local node: %q", got)
	}
}

func TestPeerResolverRemembersPerConnectionForAShortTime(t *testing.T) {
	peers := &countingPeers{peer: Peer{UserID: "owner", NodeID: "n1", Tagged: false}}
	clock := newStepClock()
	resolver := newPeerResolver(peers, peerPolicy{owner: "owner"}, clock, time.Second, time.Second)
	conn := netip.MustParseAddrPort("100.64.0.1:50000")
	other := netip.MustParseAddrPort("100.64.0.1:50001")
	ctx := context.Background()

	for range 5 {
		if got := resolver.resolve(ctx, conn); got.denial != peerAllowed {
			t.Fatalf("denial %q", got.denial)
		}
	}
	if peers.lookups.Load() != 1 {
		t.Fatalf("%d lookups for one connection within the cache time, want 1", peers.lookups.Load())
	}
	resolver.resolve(ctx, other)
	if peers.lookups.Load() != 2 {
		t.Fatal("a second connection shared the first one's answer")
	}
	clock.advance(2 * time.Second)
	resolver.resolve(ctx, conn)
	if peers.lookups.Load() != 3 {
		t.Fatal("an answer outlived the cache time")
	}

	// fresh never uses the cache, and does not need to fill it.
	before := peers.lookups.Load()
	resolver.fresh(ctx, conn)
	resolver.fresh(ctx, conn)
	if peers.lookups.Load() != before+2 {
		t.Fatal("fresh used the cache")
	}

	// IPv4 in IPv6 notation is the same connection.
	mapped := netip.MustParseAddrPort("[::ffff:100.64.0.1]:50000")
	before = peers.lookups.Load()
	resolver.resolve(ctx, mapped)
	resolver.resolve(ctx, conn)
	if peers.lookups.Load() != before {
		t.Fatal("an IPv4-mapped address was treated as a different peer")
	}
}

func TestPeerResolverDeniesWhatItCannotAnswerInTime(t *testing.T) {
	peers := &countingPeers{peer: Peer{UserID: "owner", NodeID: "n1", Tagged: false}, delay: make(chan struct{})}
	t.Cleanup(func() { close(peers.delay) })
	resolver := newPeerResolver(peers, peerPolicy{owner: "owner"}, newStepClock(), time.Second, 50*time.Millisecond)
	start := time.Now()
	got := resolver.resolve(context.Background(), netip.MustParseAddrPort("100.64.0.1:1"))
	if got.denial != peerLookupFailed {
		t.Fatalf("a lookup that never answers = %q, want a denial", got.denial)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("a lookup that ignores its context held the request")
	}
	if got = resolver.resolve(context.Background(), netip.AddrPort{}); got.denial != peerBadAddress {
		t.Fatalf("an invalid address = %q", got.denial)
	}
}

func TestPeerResolverCacheIsBounded(t *testing.T) {
	peers := &countingPeers{peer: Peer{UserID: "owner", NodeID: "n1", Tagged: false}}
	resolver := newPeerResolver(peers, peerPolicy{owner: "owner"}, newStepClock(), time.Hour, time.Second)
	for i := range 3 * maxCachedPeers {
		resolver.resolve(context.Background(), netip.AddrPortFrom(netip.AddrFrom4([4]byte{100, 64, byte(i >> 8), byte(i)}), 1))
	}
	resolver.mu.Lock()
	defer resolver.mu.Unlock()
	if len(resolver.entries) > maxCachedPeers {
		t.Fatalf("cache grew to %d entries, bound is %d", len(resolver.entries), maxCachedPeers)
	}
}
