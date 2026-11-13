package gateway

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

const (
	// writeGrace is how long past a request's own deadline the response may
	// still be written to a slow client.
	writeGrace = 10 * time.Second

	runtimeUpstreamPath = "/wails/runtime"
	clientIDHeader      = "X-Wails-Client-Id"
)

// serveRuntime serves POST /wails/runtime: the one route that runs bound Go
// methods. A call is forwarded only when
//
//   - the allowlist approves it (the whole body is read and judged first, so a
//     client that paces its body cannot hold a binding while it does);
//   - it names a client ID that this credential bound to an open events socket,
//     checked under the gateway's lock at the moment the call is dispatched,
//     and only while that socket stays open: the call holds the binding until
//     it returns, and the tunnel's end cancels it; and
//   - what is sent upstream is the canonical body the allowlist built, with
//     the host-issued client ID in place of the page's own.
//
// The bytes the client sent never reach the upstream. A call that does not
// hold a live binding is never sent, because the host would run a call whose
// client ID it does not know as its first window, normally main.
func (g *Gateway) serveRuntime(w http.ResponseWriter, r *http.Request, p principal, route routing) {
	if reason := runtimeShapeDenial(r); reason != "" {
		g.deny(w, p, DenialRoute, reason)
		return
	}
	if reason := g.originDenial(r.Header, r.Method, false); reason != "" {
		g.deny(w, p, DenialOrigin, reason)
		return
	}
	label, ok := singleClientID(r.Header)
	if !ok {
		g.deny(w, p, DenialPolicy, auditgate.ReasonClientID)
		return
	}
	sess, ok := g.startRequest(w, r, p)
	if !ok {
		return
	}
	defer sess.finish()
	stopInterrupt := interruptWrites(sess.ctx, r, w)
	defer stopInterrupt()

	body, reason := readRuntimeBody(w, r)
	if reason != "" {
		g.deny(w, p, DenialPolicy, reason)
		return
	}
	key := clientKey{credential: p.credential, label: label}
	decision := g.allow.evaluate(runtimeCall{
		method:       r.Method,
		path:         route.path,
		rawQuery:     route.query,
		header:       r.Header,
		body:         body,
		clientID:     label,
		callIDPrefix: g.clientPrefix(key),
	})
	if !decision.allowed {
		g.policyDenied(w, p, decision)
		return
	}

	client := g.awaitClient(sess.ctx, key)
	if client == nil {
		g.endedOrDeny(w, sess, p, reasonClientUnbound)
		return
	}
	defer g.releaseClient(client)

	callCtx, cancel := context.WithTimeout(sess.ctx, g.cfg.Timeouts.RuntimeCall)
	defer cancel()
	// A tunnel that ends takes its admitted calls with it, and its upstream
	// socket stays open until they have returned (see runTunnel). The tie runs
	// on its own goroutine, so a tunnel that ended a moment ago may not have
	// cancelled this call yet: check once more before the call goes. The check
	// narrows the window and cannot close it. A tunnel that ends after it
	// cancels the call in flight, and the hold keeps the upstream socket open
	// until the call has returned.
	stopTie := context.AfterFunc(client.session.ctx, cancel)
	defer stopTie()
	if client.session.ctx.Err() != nil {
		g.endedOrDeny(w, sess, p, reasonClientUnbound)
		return
	}
	setWriteDeadline(w, g.cfg.Timeouts.RuntimeCall+writeGrace)
	header := make(http.Header)
	header.Set("Content-Type", "application/json")
	header.Set("Origin", g.up.origin)
	header.Set(clientIDHeader, client.issued)
	resp, err := g.up.do(callCtx, http.MethodPost, runtimeUpstreamPath, header, decision.forward)
	if err != nil {
		g.callFailed(w, sess, client, p)
		return
	}
	g.relay(w, resp, g.cfg.Limits.MaxRuntimeResponseBytes, false)
}

// policyDenied answers a call the allowlist refused and records it. The event
// is rate limited like every other denial; the count is exact.
func (g *Gateway) policyDenied(w http.ResponseWriter, p principal, decision runtimeDecision) {
	g.denials.add(DenialPolicy)
	if g.denials.eventAllowed(g.cfg.Clock.Now().Mono) {
		g.emit(g.event(EventPolicyDenied, string(decision.reason), p.credential, p.node, decision.subject))
	}
	writeProblem(w, http.StatusForbidden, CodeDenied, decision.reason)
}

// runtimeShapeDenial refuses a runtime request whose framing is unacceptable
// before its body is read. The allowlist rechecks method, path and query.
func runtimeShapeDenial(r *http.Request) auditgate.Reason {
	switch {
	case r.Method != http.MethodPost:
		return auditgate.ReasonHTTPMethod
	case r.Header.Get("Upgrade") != "":
		return reasonUpgradeForbidden
	case len(r.TransferEncoding) != 0:
		return reasonBodyFraming
	case r.ContentLength > auditgate.MaxRuntimeBodyBytes:
		return auditgate.ReasonBodyTooLarge
	}
	return ""
}

// singleClientID returns the one valid client ID a runtime call carries.
func singleClientID(header http.Header) (string, bool) {
	values := header.Values(clientIDHeader)
	if len(values) != 1 || !auditgate.ValidClientID(values[0]) {
		return "", false
	}
	return values[0], true
}

// readRuntimeBody reads a body of at most MaxRuntimeBodyBytes+1 bytes.
func readRuntimeBody(w http.ResponseWriter, r *http.Request) ([]byte, auditgate.Reason) {
	limited := http.MaxBytesReader(w, r.Body, auditgate.MaxRuntimeBodyBytes+1)
	body, err := io.ReadAll(limited)
	if err == nil {
		return body, ""
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return nil, auditgate.ReasonBodyTooLarge
	}
	return nil, reasonBodyRead
}

// startRequest registers an authenticated request and answers when it cannot.
func (g *Gateway) startRequest(w http.ResponseWriter, r *http.Request, p principal) (*session, bool) {
	sess, denial, ok := g.beginRequest(r.Context(), p, g.cfg.Clock.Now())
	switch {
	case ok:
		return sess, true
	case denial == DenialCapacity:
		g.busy(w, p, http.StatusServiceUnavailable, reasonBusy)
	default:
		// The credential or the audit ended after the request authenticated.
		g.refuse(w, &refusal{
			status: http.StatusUnauthorized, denial: DenialEnded, code: "audit_ended",
			node: p.node, credential: p.credential,
		})
	}
	return nil, false
}

// endedOrDeny answers a request whose session was canceled while it waited,
// or denies it with reason if the session is still live.
func (g *Gateway) endedOrDeny(w http.ResponseWriter, sess *session, p principal, reason auditgate.Reason) {
	if sess.cause() != nil {
		panic(http.ErrAbortHandler)
	}
	g.deny(w, p, DenialPolicy, reason)
}

// callFailed answers a runtime call whose upstream request failed. A canceled
// request session means the credential was revoked or the audit ended: the
// connection is cut rather than answered. A canceled tunnel means the page's
// binding ended under the call.
func (g *Gateway) callFailed(w http.ResponseWriter, sess *session, client *boundClient, p principal) {
	switch {
	case sess.cause() != nil:
		panic(http.ErrAbortHandler)
	case client.session.ctx.Err() != nil:
		g.deny(w, p, DenialPolicy, reasonClientUnbound)
	default:
		g.refuseUpstream(w, reasonUpstream)
	}
}

// upstreamFailed answers a request whose upstream call failed. A canceled
// session means the credential was revoked or the audit ended: the connection
// is cut rather than answered.
func (g *Gateway) upstreamFailed(w http.ResponseWriter, sess *session) {
	if sess.cause() != nil {
		panic(http.ErrAbortHandler)
	}
	g.refuseUpstream(w, reasonUpstream)
}

// setWriteDeadline bounds how long the response may take to write. The server
// has no WriteTimeout of its own because responses legitimately vary from a
// few bytes to many megabytes; each handler sets the bound that fits.
func setWriteDeadline(w http.ResponseWriter, d time.Duration) {
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(d))
}

// connectionKey is the context key under which the server records the
// connection a request arrived on.
type connectionKey struct{}

// rawConnection is the TCP connection a request arrived on, below any TLS, or
// nil when the server did not record one.
func rawConnection(ctx context.Context) net.Conn {
	conn, _ := ctx.Value(connectionKey{}).(net.Conn)
	if tlsConn, ok := conn.(*tls.Conn); ok {
		return tlsConn.NetConn()
	}
	return conn
}

// interruptWrites makes a response write that is blocked on a client that
// stopped reading fail the moment ctx ends, instead of at the write deadline,
// which can be minutes away. It sets the write deadline to now and closes the
// TCP connection itself: once a write has failed, net/http closes the TLS
// connection, and crypto/tls then tries to send its close_notify alert into
// the full buffer of the dead peer and waits up to five seconds for it. Call
// the returned function before the handler returns; calling it again does
// nothing. It is for the handler's goroutine and is not safe for concurrent
// use.
func interruptWrites(ctx context.Context, r *http.Request, w http.ResponseWriter) func() {
	controller := http.NewResponseController(w)
	raw := rawConnection(r.Context())
	finished := make(chan struct{})
	cancel := context.AfterFunc(ctx, func() {
		defer close(finished)
		_ = controller.SetWriteDeadline(time.Now())
		if raw != nil {
			_ = raw.Close()
		}
	})
	stopped := false
	return func() {
		if stopped {
			return
		}
		stopped = true
		if !cancel() {
			<-finished
		}
	}
}
