package gateway

import (
	"context"
	"crypto/tls"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

// Audit lifetime bounds. An audit never extends itself: traffic and restarts
// do not move its deadline.
const (
	MinTTL     = time.Minute
	DefaultTTL = time.Hour
	MaxTTL     = 8 * time.Hour
)

// Upstream is the loopback Wails endpoint an audit exposes.
type Upstream interface {
	// Address is the loopback TCP address of the Wails server. The gateway
	// dials exactly this address for every upstream request and never
	// resolves or follows another one. It must be a loopback IP with a
	// nonzero port.
	Address() netip.AddrPort
	// Verify confirms that the server at Address is still the exact host
	// target the audit was started for: the same owned host process and
	// generation, not a process that took over the port. The gateway calls it
	// when it starts and about once a second afterwards. Any error ends the
	// audit (the target is gone or replaced; a new audit must be started).
	// Verify must honor ctx.
	Verify(ctx context.Context) error
}

// GetCertificate supplies the TLS certificate for the configured name. The
// gateway calls it only when the client's SNI equals that name (ASCII case
// aside), and it calls it on every handshake for that name with no cache of its
// own, so an implementation must be cheap and must cache what it fetches: a
// first fetch that blocks, on an ACME order for example, blocks the handshake
// and holds a connection place. Fetch the certificate before the audit starts.
type GetCertificate func(hello *tls.ClientHelloInfo) (*tls.Certificate, error)

// Config describes one audit.
type Config struct {
	// ServerName is the DNS name of the audit's certificate and of the page
	// the browser opens: lower case, at least two labels, not an IP literal.
	ServerName string
	// Port is the HTTPS port the browser connects to. The Host header must
	// name it unless it is 443.
	Port int
	// OwnerID is the stable ID of the user that owns the audit's node. Only
	// peers owned by this user may connect.
	OwnerID string
	// LocalNodeID is the stable ID of the node the gateway runs on. A peer with
	// this ID is the host itself (a local process dialing the tailnet
	// address); it is refused unless AllowSelf is set. It is required unless
	// AllowSelf is set: without it the self check would silently not run.
	LocalNodeID string
	// AllowSelf admits the local node as a peer. Local processes can already
	// reach the loopback Wails endpoint, so this gives them nothing new, but
	// it makes the credential the only barrier for them. Set it only for a
	// self-dialed listener probe.
	AllowSelf bool
	// Peers resolves accepted connections to nodes.
	Peers PeerIdentity
	// Upstream is the loopback Wails endpoint.
	Upstream Upstream
	// Policy is the allowlist. Nil uses [auditgate.Default].
	Policy *auditgate.Policy
	// Clock supplies time. Nil uses [SystemClock].
	Clock Clock
	// TTL is the audit lifetime, from MinTTL to MaxTTL. Zero is DefaultTTL.
	TTL time.Duration
	// Limits bound remote work. Zero fields take their defaults.
	Limits Limits
	// Timeouts bound waits. Zero fields take their defaults.
	Timeouts Timeouts
	// Events receives bounded diagnostics. It is called synchronously and must
	// not block. Nil discards them.
	Events func(Event)

	// upstreamAddress is the upstream's address, read and validated once.
	upstreamAddress netip.AddrPort
}

// Timeouts bound every wait the gateway performs. A zero field takes its
// default.
type Timeouts struct {
	// ReadHeader bounds reading a request's headers. net/http also takes it as
	// the TLS handshake deadline, because it uses the smallest of the header,
	// read and write timeouts for that. Default 10s.
	ReadHeader time.Duration
	// Read bounds a whole request, body included. Default 15s.
	Read time.Duration
	// Idle bounds a keep-alive connection between requests. Default 60s.
	Idle time.Duration
	// RuntimeCall bounds one /wails/runtime round trip. Default 10m.
	RuntimeCall time.Duration
	// Static bounds one static asset round trip. Default 2m.
	Static time.Duration
	// UpstreamDial bounds connecting to the upstream. Default 3s.
	UpstreamDial time.Duration
	// TunnelWrite bounds one write to a tunnel client. It cuts off a client
	// that has stopped reading; it does not bound a client that reads a little
	// at a time, which TunnelLag and the tunnel queue limits do. Default 10s.
	TunnelWrite time.Duration
	// TunnelLag bounds how long an event may wait in a tunnel's queue for its
	// client: a client further behind than that is cut off. Default 30s.
	TunnelLag time.Duration
	// TunnelPing is how often a tunnel client is pinged, and TunnelPong how
	// long it has to answer. Defaults 30s and 10s.
	TunnelPing time.Duration
	TunnelPong time.Duration
	// Watch is how often expiry is checked and the upstream is verified.
	// Default 1s.
	Watch time.Duration
	// Verify bounds one upstream verification. Default 2s.
	Verify time.Duration
	// PeerLookup bounds one identity lookup. Default 2s.
	PeerLookup time.Duration
	// PeerCache is how long a resolved peer is remembered per connection.
	// Default 1s; a negative value disables the cache.
	PeerCache time.Duration
	// PeerRecheck is how often a live tunnel's peer is looked up again.
	// Default 1s.
	PeerRecheck time.Duration
	// CloseGrace is how long a WebSocket close handshake may take before the
	// socket is cut. Default 1s.
	CloseGrace time.Duration
	// BindWait is how long a runtime call waits for its page's tunnel to
	// become ready. The page's first calls race its events socket, and a
	// tunnel is ready only once its upstream socket is open and the host has
	// mapped its client ID, which can take UpstreamDial plus MappingWait. The
	// wait lets the call run after that, never without it. Zero is the
	// default, UpstreamDial plus MappingWait (5s); a negative value disables
	// the wait.
	BindWait time.Duration
	// CallDrain bounds how long a tunnel that has ended waits for the runtime
	// calls that still hold it (they are cancelled when it ends) before it
	// closes its upstream socket. Default 2s.
	CallDrain time.Duration
	// CallSettle is how long a tunnel that served calls keeps its upstream
	// socket open after the last of them has returned. A request the host has
	// received but not yet started when its call was cancelled can still look
	// its client ID up, and the host forgets the ID when the socket closes.
	// It narrows that window; it cannot close it. Zero is the default, 150ms;
	// a negative value disables it.
	CallSettle time.Duration
	// MappingWait bounds how long a new tunnel waits for the host to map its
	// issued client ID to a browser window. Default 2s.
	MappingWait time.Duration
	// Shutdown bounds how long Stop and Revoke wait for closure when the
	// caller's context has no deadline. Default 5s.
	Shutdown time.Duration
}

// Default timeouts.
const (
	defaultReadHeader   = 10 * time.Second
	defaultRead         = 15 * time.Second
	defaultIdle         = 60 * time.Second
	defaultRuntimeCall  = 10 * time.Minute
	defaultStatic       = 2 * time.Minute
	defaultUpstreamDial = 3 * time.Second
	defaultTunnelWrite  = 10 * time.Second
	defaultTunnelLag    = 30 * time.Second
	defaultTunnelPing   = 30 * time.Second
	defaultTunnelPong   = 10 * time.Second
	defaultWatch        = time.Second
	defaultVerify       = 2 * time.Second
	defaultPeerLookup   = 2 * time.Second
	defaultPeerCache    = time.Second
	defaultPeerRecheck  = time.Second
	defaultCloseGrace   = time.Second
	defaultCallSettle   = 150 * time.Millisecond
	defaultCallDrain    = 2 * time.Second
	defaultMappingWait  = 2 * time.Second
	defaultShutdown     = 5 * time.Second
)

func orDefault(value, fallback time.Duration) time.Duration {
	if value <= 0 {
		return fallback
	}
	return value
}

func (t Timeouts) withDefaults() Timeouts {
	t.ReadHeader = orDefault(t.ReadHeader, defaultReadHeader)
	t.Read = orDefault(t.Read, defaultRead)
	t.Idle = orDefault(t.Idle, defaultIdle)
	t.RuntimeCall = orDefault(t.RuntimeCall, defaultRuntimeCall)
	t.Static = orDefault(t.Static, defaultStatic)
	t.UpstreamDial = orDefault(t.UpstreamDial, defaultUpstreamDial)
	t.TunnelWrite = orDefault(t.TunnelWrite, defaultTunnelWrite)
	t.TunnelLag = orDefault(t.TunnelLag, defaultTunnelLag)
	t.TunnelPing = orDefault(t.TunnelPing, defaultTunnelPing)
	t.TunnelPong = orDefault(t.TunnelPong, defaultTunnelPong)
	t.Watch = orDefault(t.Watch, defaultWatch)
	t.Verify = orDefault(t.Verify, defaultVerify)
	t.PeerLookup = orDefault(t.PeerLookup, defaultPeerLookup)
	switch {
	case t.PeerCache == 0:
		t.PeerCache = defaultPeerCache
	case t.PeerCache < 0:
		t.PeerCache = 0
	}
	t.PeerRecheck = orDefault(t.PeerRecheck, defaultPeerRecheck)
	t.CloseGrace = orDefault(t.CloseGrace, defaultCloseGrace)
	t.CallDrain = orDefault(t.CallDrain, defaultCallDrain)
	switch {
	case t.CallSettle == 0:
		t.CallSettle = defaultCallSettle
	case t.CallSettle < 0:
		t.CallSettle = 0
	}
	t.MappingWait = orDefault(t.MappingWait, defaultMappingWait)
	switch {
	case t.BindWait == 0:
		t.BindWait = t.UpstreamDial + t.MappingWait
	case t.BindWait < 0:
		t.BindWait = 0
	}
	t.Shutdown = orDefault(t.Shutdown, defaultShutdown)
	return t
}

// validate checks the fields that have no usable default and returns the
// configuration with the defaults filled in.
func (c Config) validate() (Config, error) {
	if !validServerName(c.ServerName) {
		return c, invalidOption("server name must be a lower-case DNS name with at least two labels")
	}
	if c.Port < 1 || c.Port > 65535 {
		return c, invalidOption("port must be between 1 and 65535")
	}
	if c.OwnerID == "" {
		return c, invalidOption("owner ID is required")
	}
	if c.Peers == nil {
		return c, invalidOption("peer identity resolver is required")
	}
	if c.Upstream == nil {
		return c, invalidOption("upstream is required")
	}
	address := c.Upstream.Address()
	if !address.IsValid() || !address.Addr().IsLoopback() || address.Port() == 0 {
		return c, invalidOption("upstream must be a loopback address with a port")
	}
	c.upstreamAddress = address
	if !c.AllowSelf && c.LocalNodeID == "" {
		return c, invalidOption("local node ID is required unless AllowSelf is set")
	}
	if c.TTL == 0 {
		c.TTL = DefaultTTL
	}
	if c.TTL < MinTTL || c.TTL > MaxTTL {
		return c, invalidOption("ttl must be between 1m and 8h")
	}
	if c.Clock == nil {
		c.Clock = SystemClock()
	}
	c.Limits = c.Limits.withDefaults()
	c.Timeouts = c.Timeouts.withDefaults()
	return c, nil
}

// authority is the canonical Host header value the browser sends.
func (c Config) authority() string {
	if c.Port == httpsDefaultPort {
		return c.ServerName
	}
	return c.ServerName + ":" + strconv.Itoa(c.Port)
}

const (
	httpsDefaultPort = 443
	maxNameBytes     = 253
	maxLabelBytes    = 63
	minNameLabels    = 2
)

// validServerName accepts a lower-case LDH DNS name with at least two labels
// whose last label is not all digits. That rules out IP literals, short
// names, trailing dots and anything needing IDNA.
func validServerName(name string) bool {
	if name == "" || len(name) > maxNameBytes {
		return false
	}
	if _, err := netip.ParseAddr(name); err == nil {
		return false
	}
	labels := strings.Split(name, ".")
	if len(labels) < minNameLabels {
		return false
	}
	for _, label := range labels {
		if !validLabel(label) {
			return false
		}
	}
	return !allDigits(labels[len(labels)-1])
}

func validLabel(label string) bool {
	if label == "" || len(label) > maxLabelBytes || label[0] == '-' || label[len(label)-1] == '-' {
		return false
	}
	for i := range len(label) {
		c := label[i]
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
			return false
		}
	}
	return true
}

func allDigits(s string) bool {
	for i := range len(s) {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return s != ""
}

// EventKind is the kind of a diagnostic [Event].
type EventKind string

// Diagnostic event kinds.
//
//nolint:gosec // G101: these are event names, not credentials.
const (
	// EventDenied is a refused request. Code is the finer reason.
	EventDenied EventKind = "denied"
	// EventPolicyDenied is an authenticated runtime call the allowlist
	// refused. Code is the evaluator reason and Subject the resolved method.
	EventPolicyDenied EventKind = "policy_denied"
	// EventCredentialIssued is a new credential.
	EventCredentialIssued EventKind = "credential_issued"
	// EventCredentialPinned is a credential's first successful use. NodeID is
	// the node it is now pinned to.
	EventCredentialPinned EventKind = "credential_pinned"
	// EventCredentialRevoked is a credential revoked on request.
	EventCredentialRevoked EventKind = "credential_revoked"
	// EventCredentialExpired is a credential that reached its deadline.
	EventCredentialExpired EventKind = "credential_expired"
	// EventPairingOffered is a new pairing offer; the code is not recorded.
	EventPairingOffered EventKind = "pairing_offered"
	// EventPairingRedeemed is a pairing code exchanged for a credential.
	EventPairingRedeemed EventKind = "pairing_redeemed"
	// EventPairingRejected is a pairing code that was not accepted.
	EventPairingRejected EventKind = "pairing_rejected"
	// EventTunnelOpened and EventTunnelClosed bracket an events tunnel. Code
	// on close is the reason.
	EventTunnelOpened EventKind = "tunnel_opened"
	EventTunnelClosed EventKind = "tunnel_closed"
	// EventEnded is the audit ending. Code is the EndReason.
	EventEnded EventKind = "audit_ended"
)

// Event is one bounded diagnostic record. It carries opaque IDs and fixed
// codes only: never a header, URL, username, secret or pairing code.
type Event struct {
	At           time.Time
	Kind         EventKind
	Code         string
	CredentialID string
	NodeID       string
	Subject      string
}
