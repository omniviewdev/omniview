package gateway

import (
	"crypto/tls"
	"net/http"
	"net/netip"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

// refusal is a denial from the identity, authority or credential steps. The
// remote sees the same response for every one; the fields are for diagnostics.
type refusal struct {
	status     int
	denial     Denial
	code       string
	node       string
	credential string
}

// Authority denial reasons, for diagnostics only.
const (
	denyTLS    = "authority_tls"
	denySNI    = "authority_sni"
	denyHost   = "authority_host"
	denyTarget = "authority_target"
)

// ServeHTTP is the whole gateway. Before it looks at the path it checks, in
// order, who the peer is, that the request names this audit's authority, and
// that it carries a valid credential; any failure is one uniform response and
// nothing reaches the upstream. Only then does it choose a route.
func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	applyBoundaryHeaders(w.Header())
	now := g.cfg.Clock.Now()
	if !g.observe(now) {
		g.refuse(w, &refusal{
			status: http.StatusUnauthorized, denial: DenialEnded, code: "audit_ended", node: "", credential: "",
		})
		return
	}
	remote, _ := netip.ParseAddrPort(r.RemoteAddr)
	address := remote.Addr().Unmap()
	leave, ok := g.admit.enter(address)
	if !ok {
		g.refuse(w, &refusal{
			status: http.StatusTooManyRequests, denial: DenialRateLimited, code: "unauthenticated_capacity",
			node: "", credential: "",
		})
		return
	}
	defer leave()

	p, ref := g.authenticate(r, now, remote, address)
	if ref != nil {
		g.refuse(w, ref)
		return
	}
	leave()
	g.dispatch(w, r, p)
}

// authenticate runs the identity, authority and credential steps. It runs all
// three even when an earlier one fails, so the work done does not show which
// failed, and it reports the first failure. Every refusal, including a request
// with no credential at all, counts against the remote address.
func (g *Gateway) authenticate(
	r *http.Request, now Instant, remote netip.AddrPort, address netip.Addr,
) (principal, *refusal) {
	if remote.IsValid() && !g.failures.available(address, now.Mono) {
		return noPrincipal(), &refusal{
			status: http.StatusTooManyRequests, denial: DenialRateLimited, code: "failed_attempts",
			node: "", credential: "",
		}
	}
	peer := g.peers.resolve(r.Context(), remote)
	authority := g.authorityDenial(r)
	username, secret, wellFormed := parseBasic(r.Header.Values("Authorization"))
	eligible := peer.denial == peerAllowed && authority == ""
	check := credentialCheck{ok: false, credential: "", pinned: false, denial: denyCredentialMalformed}
	if wellFormed {
		check = g.verifyCredential(username, secret, peer.peer.NodeID, eligible, now)
	}

	ref := &refusal{
		status: http.StatusUnauthorized, denial: "", code: "", node: peer.peer.NodeID, credential: check.credential,
	}
	switch {
	case peer.denial != peerAllowed:
		ref.denial, ref.code = DenialPeer, string(peer.denial)
	case authority != "":
		ref.denial, ref.code = DenialAuthority, authority
	case !check.ok:
		ref.denial, ref.code = DenialCredential, check.denial
	default:
		if check.pinned {
			g.emit(g.event(EventCredentialPinned, "", check.credential, peer.peer.NodeID, ""))
		}
		return principal{credential: check.credential, node: peer.peer.NodeID, remote: remote}, nil
	}
	if remote.IsValid() {
		g.failures.fail(address, now.Mono)
	}
	return noPrincipal(), ref
}

// authorityDenial checks that the request was made to this audit's name over
// TLS 1.3: the SNI and the Host header must both be the configured name (with
// the port in Host unless it is 443), and the request target must be
// origin-form, which rules out CONNECT, absolute-form proxy targets and "*".
// Names are compared ASCII case-insensitively and in no other way, so no
// Unicode case folding can make another name match. It returns a bounded code,
// or "" when the request is acceptable.
func (g *Gateway) authorityDenial(r *http.Request) string {
	switch {
	case r.TLS == nil || !r.TLS.HandshakeComplete || r.TLS.Version < tls.VersionTLS13:
		return denyTLS
	case !asciiEqualFold(r.TLS.ServerName, g.cfg.ServerName):
		return denySNI
	case !asciiEqualFold(r.Host, g.authority):
		return denyHost
	case r.Method == http.MethodConnect || r.RequestURI == "" || r.RequestURI[0] != '/':
		return denyTarget
	}
	return ""
}

// dispatch serves an authenticated request.
func (g *Gateway) dispatch(w http.ResponseWriter, r *http.Request, p principal) {
	route := classifyRoute(r)
	switch route.kind {
	case routeRuntime:
		g.serveRuntime(w, r, p, route)
	case routeEvents:
		g.serveEvents(w, r, p, route)
	case routeStatic:
		g.serveStatic(w, r, p, route)
	case routeDenied:
		g.deny(w, p, DenialRoute, route.reason)
	}
}

// refuse writes the uniform identity, authority or credential denial and
// records it.
func (g *Gateway) refuse(w http.ResponseWriter, ref *refusal) {
	g.denials.add(ref.denial)
	if g.denials.eventAllowed(g.cfg.Clock.Now().Mono) {
		g.emit(g.event(EventDenied, ref.code, ref.credential, ref.node, ""))
	}
	g.writeUnauthorized(w, ref.status)
}

// deny refuses an authenticated request that the route table, the origin
// rules or the allowlist do not permit. The body names a bounded reason.
func (g *Gateway) deny(w http.ResponseWriter, p principal, denial Denial, reason auditgate.Reason) {
	g.denials.add(denial)
	if g.denials.eventAllowed(g.cfg.Clock.Now().Mono) {
		g.emit(g.event(EventDenied, string(reason), p.credential, p.node, ""))
	}
	writeProblem(w, http.StatusForbidden, CodeDenied, reason)
}

// busy refuses an authenticated request the audit has no room for.
func (g *Gateway) busy(w http.ResponseWriter, p principal, status int, reason auditgate.Reason) {
	g.denials.add(DenialCapacity)
	if g.denials.eventAllowed(g.cfg.Clock.Now().Mono) {
		g.emit(g.event(EventDenied, string(reason), p.credential, p.node, ""))
	}
	writeProblem(w, status, CodeUnavailable, reason)
}
