package gateway

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

// Reasons for refusing an authenticated request that come from the route
// table and the browser-context rules rather than the allowlist. They are
// bounded codes that never contain request text.
const (
	reasonRouteNotAllowed  auditgate.Reason = "route_not_allowed"
	reasonUpgradeForbidden auditgate.Reason = "upgrade_forbidden"
	reasonUpgradeInvalid   auditgate.Reason = "upgrade_invalid"
	reasonBodyForbidden    auditgate.Reason = "body_forbidden"
	reasonBodyFraming      auditgate.Reason = "body_framing"
	reasonBodyRead         auditgate.Reason = "body_read"
	reasonOrigin           auditgate.Reason = "origin"
	reasonFetchMetadata    auditgate.Reason = "fetch_metadata"
	reasonTunnelLimit      auditgate.Reason = "tunnel_limit"
	reasonClientBudget     auditgate.Reason = "client_budget"
	reasonClientChurn      auditgate.Reason = "client_churn"
	reasonUpstream         auditgate.Reason = "upstream_unavailable"
	reasonUpstreamStatus   auditgate.Reason = "upstream_status"
	reasonResponseTooBig   auditgate.Reason = "response_too_large"
	reasonBusy             auditgate.Reason = "busy"
	reasonClientUnbound    auditgate.Reason = "client_unbound"
)

// applyBoundaryHeaders sets the headers every response carries, whatever its
// source, relayed or the gateway's own. Nothing here is HSTS: it would pin the
// whole node name across ports. nosniff keeps a browser from guessing a type
// for a response whose Content-Type the gateway dropped as invalid.
func applyBoundaryHeaders(h http.Header) {
	h.Set("Cache-Control", "no-store")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "DENY")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "frame-ancestors 'none'")
}

// problemKind makes the Wails runtime raise a plain Error carrying message
// when a call is refused.
const problemKind = "RuntimeError"

// problem is the body of every response the gateway writes itself. Its shape
// is Wails' own call error ({"message", "kind"}) so the page shows the refusal
// as an ordinary failed call, plus the stable code and a bounded reason.
type problem struct {
	Code    Code   `json:"code"`
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message"`
	Kind    string `json:"kind"`
}

func writeProblem(w http.ResponseWriter, status int, code Code, reason auditgate.Reason) {
	body := problem{Code: code, Reason: string(reason), Message: string(code), Kind: problemKind}
	if reason != "" {
		body.Message = string(code) + ": " + string(reason)
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		encoded = []byte(`{"code":"` + string(code) + `"}`)
	}
	writeFixed(w, status, encoded)
}

func writeFixed(w http.ResponseWriter, status int, body []byte) {
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// unauthorizedBody is the only body a remote party ever gets for an identity,
// authority or credential denial. It is identical for every cause.
func unauthorizedBody() []byte {
	encoded, err := json.Marshal(problem{
		Code: CodeUnauthorized, Reason: "", Message: string(CodeUnauthorized), Kind: problemKind,
	})
	if err != nil {
		return []byte(`{"code":"audit_unauthorized"}`)
	}
	return encoded
}

// writeUnauthorized sends the uniform denial. status is 401, or 429 when the
// remote address has made too many failed attempts; headers and body do not
// vary. The challenge carries only this audit's nonsecret realm.
func (g *Gateway) writeUnauthorized(w http.ResponseWriter, status int) {
	w.Header().Set("WWW-Authenticate", `Basic realm="`+g.realm+`", charset="UTF-8"`)
	writeFixed(w, status, unauthorizedBody())
}

// denialCounters counts refusals by category for the status report and
// limits how many of them become diagnostic events, so a flood of refused
// requests cannot flood the event sink. The counts stay exact.
type denialCounters struct {
	mu     sync.Mutex
	counts map[Denial]uint64
	events bucket
}

const (
	deniedEventBurst  = 32
	deniedEventRefill = 100 * time.Millisecond
)

func newDenialCounters(now time.Duration) denialCounters {
	return denialCounters{
		mu:     sync.Mutex{},
		counts: make(map[Denial]uint64),
		events: newBucket(deniedEventBurst, deniedEventRefill, now),
	}
}

func (c *denialCounters) add(d Denial) {
	c.mu.Lock()
	c.counts[d]++
	c.mu.Unlock()
}

// eventAllowed reports whether another denial may be sent to the event sink.
func (c *denialCounters) eventAllowed(now time.Duration) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.events.available(now) {
		return false
	}
	c.events.spend(now)
	return true
}

func (c *denialCounters) snapshot() map[Denial]uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make(map[Denial]uint64, len(c.counts))
	for k, v := range c.counts {
		out[k] = v
	}
	return out
}
