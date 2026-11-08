package gateway

import (
	"net/netip"
	"sync"
	"time"
)

// Limits bound the work a remote party can cause. A zero field takes its
// default.
type Limits struct {
	// MaxUnauthenticated bounds requests that are still in the identity,
	// authority and credential steps. Default 32.
	MaxUnauthenticated int
	// MaxUnauthenticatedPerAddress bounds the same requests from one remote
	// address, so one peer cannot hold every place. Default 4.
	MaxUnauthenticatedPerAddress int
	// MaxInFlight bounds authenticated HTTP requests being served at once.
	// Default 64.
	MaxInFlight int
	// MaxBindWaiters bounds runtime calls waiting for their page's events
	// socket to open (see Timeouts.BindWait). Default 8.
	MaxBindWaiters int
	// MaxTunnels bounds open events WebSocket tunnels across the audit.
	// Default 4.
	MaxTunnels int
	// MaxTunnelsPerCredential bounds open events tunnels per credential.
	// Each tunnel is a Wails browser window on the host, and the host never
	// retires the state a window creates, so the bound is small. Default 2.
	MaxTunnelsPerCredential int
	// MaxEventSocketOpens bounds how many events sockets the audit may open
	// upstream over its whole life. The host keeps per-window state (realm
	// scopes, metric and activity sessions) in tables of 64 to 128 entries
	// that a closed socket does not free, and the owner's own windows share
	// them, so an audit may use only a small share. Default 16.
	MaxEventSocketOpens int
	// TunnelOpenBurst and TunnelOpenRefill bound how fast one credential may
	// open events sockets: a reconnecting page is slowed down instead of
	// wearing out MaxEventSocketOpens. Defaults 3 and 5s.
	TunnelOpenBurst  int
	TunnelOpenRefill time.Duration
	// TunnelQueueBytes and TunnelQueueMessages bound what one tunnel may hold
	// for a page that reads slower than the host sends; a page that falls
	// behind either bound, or by more than Timeouts.TunnelLag, is cut off.
	// Defaults 16 MiB and 4096.
	TunnelQueueBytes    int
	TunnelQueueMessages int
	// MaxConnections bounds TCP connections accepted by [Gateway.Serve],
	// handshakes included. Default 128.
	MaxConnections int
	// MaxConnectionsPerAddress bounds the same connections from one remote
	// address; a further one is closed before any TLS work. Default 16.
	MaxConnectionsPerAddress int
	// AcceptBurst and AcceptRefill bound how fast one remote address may open
	// connections, which bounds the TLS handshakes it can cause. Defaults 20
	// and 100ms.
	AcceptBurst  int
	AcceptRefill time.Duration
	// FailureBurst is how many refused requests (a missing, wrong or
	// otherwise unusable credential) one remote address may make before
	// further requests are refused with 429. Default 10.
	FailureBurst int
	// FailureRefill is the time to earn back one attempt. Default 2s.
	FailureRefill time.Duration
	// GlobalFailureBurst and GlobalFailureRefill bound refused requests across
	// all addresses. Defaults 50 and 100ms.
	GlobalFailureBurst  int
	GlobalFailureRefill time.Duration
	// PairingFailureBurst and PairingFailureRefill bound failed pairing
	// attempts. Defaults 5 and 15s.
	PairingFailureBurst  int
	PairingFailureRefill time.Duration
	// MaxRuntimeResponseBytes bounds a /wails/runtime response. Default 32 MiB.
	MaxRuntimeResponseBytes int64
	// MaxStaticResponseBytes bounds a static asset response. Default 64 MiB.
	MaxStaticResponseBytes int64
}

// Default limits.
const (
	defaultMaxUnauthenticated           = 32
	defaultMaxUnauthenticatedPerAddress = 4
	defaultMaxInFlight                  = 64
	defaultMaxBindWaiters               = 8
	defaultMaxTunnels                   = 4
	defaultMaxTunnelsPerCredential      = 2
	defaultMaxEventSocketOpens          = 16
	defaultTunnelOpenBurst              = 3
	defaultTunnelOpenRefill             = 5 * time.Second
	defaultTunnelQueueBytes             = 16 << 20
	defaultTunnelQueueMessages          = 4096
	defaultMaxConnections               = 128
	defaultMaxConnectionsPerAddress     = 16
	defaultAcceptBurst                  = 20
	defaultAcceptRefill                 = 100 * time.Millisecond
	defaultFailureBurst                 = 10
	defaultFailureRefill                = 2 * time.Second
	defaultGlobalFailureBurst           = 50
	defaultGlobalFailureRefill          = 100 * time.Millisecond
	defaultPairingFailureBurst          = 5
	defaultPairingFailureRefill         = 15 * time.Second
	defaultMaxRuntimeResponse           = 32 << 20
	defaultMaxStaticResponse            = 64 << 20
)

func orInt(value, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}

func orInt64(value, fallback int64) int64 {
	if value <= 0 {
		return fallback
	}
	return value
}

func (l Limits) withDefaults() Limits {
	l.MaxUnauthenticated = orInt(l.MaxUnauthenticated, defaultMaxUnauthenticated)
	l.MaxUnauthenticatedPerAddress = orInt(l.MaxUnauthenticatedPerAddress, defaultMaxUnauthenticatedPerAddress)
	l.MaxInFlight = orInt(l.MaxInFlight, defaultMaxInFlight)
	l.MaxBindWaiters = orInt(l.MaxBindWaiters, defaultMaxBindWaiters)
	l.MaxTunnels = orInt(l.MaxTunnels, defaultMaxTunnels)
	l.MaxTunnelsPerCredential = orInt(l.MaxTunnelsPerCredential, defaultMaxTunnelsPerCredential)
	l.MaxEventSocketOpens = orInt(l.MaxEventSocketOpens, defaultMaxEventSocketOpens)
	l.TunnelOpenBurst = orInt(l.TunnelOpenBurst, defaultTunnelOpenBurst)
	l.TunnelOpenRefill = orDefault(l.TunnelOpenRefill, defaultTunnelOpenRefill)
	l.TunnelQueueBytes = orInt(l.TunnelQueueBytes, defaultTunnelQueueBytes)
	l.TunnelQueueMessages = orInt(l.TunnelQueueMessages, defaultTunnelQueueMessages)
	l.MaxConnections = orInt(l.MaxConnections, defaultMaxConnections)
	l.MaxConnectionsPerAddress = orInt(l.MaxConnectionsPerAddress, defaultMaxConnectionsPerAddress)
	l.AcceptBurst = orInt(l.AcceptBurst, defaultAcceptBurst)
	l.AcceptRefill = orDefault(l.AcceptRefill, defaultAcceptRefill)
	l.FailureBurst = orInt(l.FailureBurst, defaultFailureBurst)
	l.FailureRefill = orDefault(l.FailureRefill, defaultFailureRefill)
	l.GlobalFailureBurst = orInt(l.GlobalFailureBurst, defaultGlobalFailureBurst)
	l.GlobalFailureRefill = orDefault(l.GlobalFailureRefill, defaultGlobalFailureRefill)
	l.PairingFailureBurst = orInt(l.PairingFailureBurst, defaultPairingFailureBurst)
	l.PairingFailureRefill = orDefault(l.PairingFailureRefill, defaultPairingFailureRefill)
	l.MaxRuntimeResponseBytes = orInt64(l.MaxRuntimeResponseBytes, defaultMaxRuntimeResponse)
	l.MaxStaticResponseBytes = orInt64(l.MaxStaticResponseBytes, defaultMaxStaticResponse)
	return l
}

// bucket is a token bucket measured on the monotonic clock.
type bucket struct {
	tokens float64
	last   time.Duration
	burst  float64
	refill time.Duration
}

func newBucket(burst int, refill time.Duration, now time.Duration) bucket {
	return bucket{tokens: float64(burst), last: now, burst: float64(burst), refill: refill}
}

func (b *bucket) advance(now time.Duration) {
	if elapsed := now - b.last; elapsed > 0 {
		b.tokens = min(b.burst, b.tokens+float64(elapsed)/float64(b.refill))
		b.last = now
	}
}

func (b *bucket) available(now time.Duration) bool {
	b.advance(now)
	return b.tokens >= 1
}

func (b *bucket) spend(now time.Duration) {
	b.advance(now)
	b.tokens = max(0, b.tokens-1)
}

// maxLimiterKeys bounds a per-address table. When it fills, idle addresses
// are forgotten first; the global bucket still applies to everyone.
const maxLimiterKeys = 1024

// addressBuckets is a bounded table of token buckets, one per remote address.
// It does no locking; its owner does.
type addressBuckets struct {
	burst  int
	refill time.Duration
	byAddr map[netip.Addr]*bucket
}

func newAddressBuckets(burst int, refill time.Duration) addressBuckets {
	return addressBuckets{burst: burst, refill: refill, byAddr: make(map[netip.Addr]*bucket)}
}

// peek returns the address's bucket, or nil when it has never been charged and
// so is full.
func (a *addressBuckets) peek(addr netip.Addr) *bucket {
	return a.byAddr[addr]
}

// get returns the address's bucket, creating a full one when there is none.
func (a *addressBuckets) get(addr netip.Addr, now time.Duration) *bucket {
	if b, ok := a.byAddr[addr]; ok {
		return b
	}
	if len(a.byAddr) >= maxLimiterKeys {
		a.forgetIdle(now)
	}
	fresh := newBucket(a.burst, a.refill, now)
	b := &fresh
	a.byAddr[addr] = b
	return b
}

// forgetIdle drops addresses whose bucket has refilled; if none has, it drops
// them all rather than grow without bound.
func (a *addressBuckets) forgetIdle(now time.Duration) {
	for addr, b := range a.byAddr {
		b.advance(now)
		if b.tokens >= b.burst {
			delete(a.byAddr, addr)
		}
	}
	if len(a.byAddr) >= maxLimiterKeys {
		clear(a.byAddr)
	}
}

// failureLimiter bounds refused requests per remote address and overall. A
// request counts when it is refused for any reason in the peer, authority and
// credential steps, including having no credential at all, so the work a
// peer can cause without a valid credential (a peer lookup, a credential
// comparison) is bounded. Requests that authenticate are never counted, so a
// page load that sends credentials with hundreds of requests is never
// limited.
//
// available is checked before the credential is examined, and a refusal is
// the same whether or not the credential was right, so the limiter cannot be
// used to learn anything.
type failureLimiter struct {
	mu        sync.Mutex
	global    bucket
	addresses addressBuckets
}

func newFailureLimiter(limits Limits, now time.Duration) *failureLimiter {
	return &failureLimiter{
		mu:        sync.Mutex{},
		global:    newBucket(limits.GlobalFailureBurst, limits.GlobalFailureRefill, now),
		addresses: newAddressBuckets(limits.FailureBurst, limits.FailureRefill),
	}
}

// available reports whether a request from addr may be examined.
func (l *failureLimiter) available(addr netip.Addr, now time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.global.available(now) {
		return false
	}
	if b := l.addresses.peek(addr); b != nil {
		return b.available(now)
	}
	return true
}

// fail records one refused request from addr.
func (l *failureLimiter) fail(addr netip.Addr, now time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.global.spend(now)
	l.addresses.get(addr, now).spend(now)
}

// admission bounds requests that have not yet authenticated, overall and per
// remote address.
type admission struct {
	mu         sync.Mutex
	limit      int
	perAddress int
	total      int
	byAddr     map[netip.Addr]int
}

func newAdmission(limit, perAddress int) *admission {
	return &admission{
		mu:         sync.Mutex{},
		limit:      limit,
		perAddress: perAddress,
		total:      0,
		byAddr:     make(map[netip.Addr]int),
	}
}

// enter takes a place for addr or reports that none is free. The returned
// function gives it back and may be called more than once.
func (a *admission) enter(addr netip.Addr) (func(), bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.total >= a.limit || a.byAddr[addr] >= a.perAddress {
		return nil, false
	}
	a.total++
	a.byAddr[addr]++
	return sync.OnceFunc(func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		a.total--
		if a.byAddr[addr]--; a.byAddr[addr] <= 0 {
			delete(a.byAddr, addr)
		}
	}), true
}
