package gateway

import (
	"context"
	"net/http"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

// serveStatic serves the GET and HEAD routes the page loads from: the document,
// the Wails scripts, the embedded UI files and installed plugin assets. The
// upstream request carries no header of the client's, and nothing but a
// validated Content-Type comes back (see relay).
func (g *Gateway) serveStatic(w http.ResponseWriter, r *http.Request, p principal, route routing) {
	if reason := staticShapeDenial(r, route); reason != "" {
		g.deny(w, p, DenialRoute, reason)
		return
	}
	if reason := g.originDenial(r.Header, r.Method, false); reason != "" {
		g.deny(w, p, DenialOrigin, reason)
		return
	}
	sess, ok := g.startRequest(w, r, p)
	if !ok {
		return
	}
	defer sess.finish()
	stopInterrupt := interruptWrites(sess.ctx, r, w)
	defer stopInterrupt()

	ctx, cancel := context.WithTimeout(sess.ctx, g.cfg.Timeouts.Static)
	defer cancel()
	setWriteDeadline(w, g.cfg.Timeouts.Static+writeGrace)
	resp, err := g.up.do(ctx, r.Method, route.path, make(http.Header), nil)
	if err != nil {
		g.upstreamFailed(w, sess)
		return
	}
	g.relay(w, resp, g.cfg.Limits.MaxStaticResponseBytes, r.Method == http.MethodHead)
}

// staticShapeDenial refuses a static request that is not a plain read: a method
// other than GET or HEAD, any query (so nothing can be smuggled in a query
// string), an upgrade, or a body.
func staticShapeDenial(r *http.Request, route routing) auditgate.Reason {
	switch {
	case r.Method != http.MethodGet && r.Method != http.MethodHead:
		return auditgate.ReasonHTTPMethod
	case route.query != "":
		return auditgate.ReasonQuery
	case r.Header.Get("Upgrade") != "":
		return reasonUpgradeForbidden
	case r.ContentLength != 0 || len(r.TransferEncoding) != 0:
		return reasonBodyForbidden
	}
	return ""
}
