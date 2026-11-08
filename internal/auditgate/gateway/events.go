package gateway

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

const (
	// maxClientFrameBytes bounds a message from the page. The page never sends
	// on the events socket (Wails ignores anything it did), so the bound is a
	// formality: the first data message from the page ends the tunnel.
	maxClientFrameBytes = 128
	webSocketVersion    = "13"
	webSocketKeyBytes   = 16
	eventsClientIDParam = "clientId="
	closedCode          = "closed"

	// probeHeader marks the gateway's own mapping probe, which no page sends.
	probeHeader = "X-Omniview-Audit-Probe"
	// probeBody asks the host which window the call runs as: Window.Name.
	probeBody = `{"object":6,"method":18}`
	// browserWindowPrefix starts the name Wails gives the window of an events
	// socket that carries a clientId.
	browserWindowPrefix = "browser-"
	maxProbeAnswerBytes = 64
	maxProbeDelay       = 50 * time.Millisecond
)

var errMappingMissing = errors.New("gateway: the host did not map the issued client ID")

// serveEvents serves GET /wails/events: the one-way stream of backend events.
//
// The gateway terminates the WebSocket on both sides. Upstream it opens its own
// socket to the host under a client ID it issues, and waits until the host has
// actually mapped that ID to a browser window; downstream it accepts the
// page's, after which the page's client ID is bound to this tunnel and runtime
// calls may use it. Every upstream message is read whole, binary and oversized
// ones are dropped, and each text message passes the allowlist's event filter
// before it is queued for the page.
func (g *Gateway) serveEvents(w http.ResponseWriter, r *http.Request, p principal, route routing) {
	if reason := eventsShapeDenial(r); reason != "" {
		g.deny(w, p, DenialRoute, reason)
		return
	}
	label, ok := strings.CutPrefix(route.query, eventsClientIDParam)
	if !ok || !auditgate.ValidClientID(label) {
		g.deny(w, p, DenialPolicy, auditgate.ReasonClientID)
		return
	}
	if reason := g.originDenial(r.Header, r.Method, true); reason != "" {
		g.deny(w, p, DenialOrigin, reason)
		return
	}
	sess, client, failure := g.openTunnel(r.Context(), p, label, g.cfg.Clock.Now())
	if failure != openOK {
		g.refuseTunnel(w, p, failure)
		return
	}
	defer sess.finish()
	defer g.unbind(client)

	up, err := g.dialEvents(sess.ctx, client.issued)
	if err != nil {
		g.refundOpen()
		g.upstreamFailed(w, sess)
		return
	}
	// The host registers the issued ID after it has sent its 101, so a call
	// sent now could still find no mapping and run as the first window. Wait
	// until the host says it knows the ID.
	if err = g.confirmMapping(sess.ctx, client.issued); err != nil {
		_ = up.CloseNow()
		g.refundOpen()
		g.upstreamFailed(w, sess)
		return
	}
	up.SetReadLimit(-1)
	//nolint:exhaustruct // Third-party options; the rest stay unset on purpose.
	down, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		CompressionMode: websocket.CompressionDisabled,
	})
	if err != nil {
		_ = up.CloseNow()
		return
	}
	down.SetReadLimit(maxClientFrameBytes)
	g.runTunnel(sess, client, up, down)
}

// eventsShapeDenial refuses a request that is not a clean WebSocket upgrade
// before the WebSocket library sees it, so the library never answers with an
// error that echoes what the client sent.
func eventsShapeDenial(r *http.Request) auditgate.Reason {
	switch {
	case r.Method != http.MethodGet:
		return auditgate.ReasonHTTPMethod
	case r.ContentLength != 0 || len(r.TransferEncoding) != 0:
		return reasonBodyForbidden
	case !validUpgrade(r.Header):
		return reasonUpgradeInvalid
	}
	return ""
}

func validUpgrade(header http.Header) bool {
	upgrades := header.Values("Upgrade")
	return headerHasToken(header, "Connection", "upgrade") &&
		len(upgrades) == 1 && strings.EqualFold(upgrades[0], "websocket") &&
		header.Get("Sec-WebSocket-Version") == webSocketVersion &&
		validWebSocketKey(header.Values("Sec-WebSocket-Key"))
}

func validWebSocketKey(values []string) bool {
	if len(values) != 1 {
		return false
	}
	key, err := base64.StdEncoding.DecodeString(values[0])
	return err == nil && len(key) == webSocketKeyBytes
}

func headerHasToken(header http.Header, name, token string) bool {
	for _, value := range header.Values(name) {
		for part := range strings.SplitSeq(value, ",") {
			if strings.EqualFold(strings.TrimSpace(part), token) {
				return true
			}
		}
	}
	return false
}

func (g *Gateway) refuseTunnel(w http.ResponseWriter, p principal, failure openFailure) {
	switch failure {
	case openOK:
	case openEnded:
		g.refuse(w, &refusal{
			status: http.StatusUnauthorized, denial: DenialEnded, code: "audit_ended",
			node: p.node, credential: p.credential,
		})
	case openCapacity:
		g.busy(w, p, http.StatusServiceUnavailable, reasonTunnelLimit)
	case openBudget:
		g.busy(w, p, http.StatusServiceUnavailable, reasonClientBudget)
	case openChurn:
		w.Header().Set("Retry-After", strconv.Itoa(int(g.cfg.Limits.TunnelOpenRefill/time.Second)+1))
		g.busy(w, p, http.StatusTooManyRequests, reasonClientChurn)
	}
}

// dialEvents opens the upstream events socket under an issued client ID. The
// request carries the loopback Host and Origin a same-origin page there would,
// which is what the host's own origin checks require.
func (g *Gateway) dialEvents(ctx context.Context, issued string) (*websocket.Conn, error) {
	ctx, cancel := context.WithTimeout(ctx, g.cfg.Timeouts.UpstreamDial)
	defer cancel()
	//nolint:bodyclose,exhaustruct // The library owns the handshake response; the other options stay unset.
	conn, _, err := websocket.Dial(ctx, g.up.eventsURL(issued), &websocket.DialOptions{
		HTTPClient:      g.up.client,
		HTTPHeader:      http.Header{"Origin": {g.up.origin}},
		Host:            g.up.host,
		CompressionMode: websocket.CompressionDisabled,
	})
	return conn, err
}

// confirmMapping waits until the host runs a call under the issued client ID
// as the browser window of its events socket. The probe is Window.Name, which
// reads a name and changes nothing: before the host has mapped the ID it
// answers with the first window's name, afterwards with browser-N.
func (g *Gateway) confirmMapping(ctx context.Context, issued string) error {
	ctx, cancel := context.WithTimeout(ctx, g.cfg.Timeouts.MappingWait)
	defer cancel()
	for delay := time.Millisecond; ; delay = min(delay+delay, maxProbeDelay) {
		mapped, err := g.probeMapping(ctx, issued)
		if err != nil {
			return err
		}
		if mapped {
			return nil
		}
		timer := time.NewTimer(delay)
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
			return errMappingMissing
		}
	}
}

func (g *Gateway) probeMapping(ctx context.Context, issued string) (bool, error) {
	header := make(http.Header)
	header.Set("Content-Type", "application/json")
	header.Set("Origin", g.up.origin)
	header.Set(clientIDHeader, issued)
	header.Set(probeHeader, "window-name")
	resp, err := g.up.do(ctx, http.MethodPost, runtimeUpstreamPath, header, []byte(probeBody))
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, errMappingMissing
	}
	answer, err := io.ReadAll(io.LimitReader(resp.Body, maxProbeAnswerBytes))
	if err != nil {
		return false, err
	}
	return isBrowserWindowName(string(answer)), nil
}

// isBrowserWindowName reports whether answer is the name of an events-socket
// window, browser-N. Wails answers Window.Name as plain text; a JSON string
// is accepted too.
func isBrowserWindowName(answer string) bool {
	name := strings.Trim(strings.TrimSpace(answer), `"`)
	digits, ok := strings.CutPrefix(name, browserWindowPrefix)
	if !ok || digits == "" {
		return false
	}
	for i := range len(digits) {
		if digits[i] < '0' || digits[i] > '9' {
			return false
		}
	}
	return true
}

// runTunnel runs one tunnel until its session ends, then closes both sockets.
// Anything that ends the tunnel cancels the session; the first cause wins.
//
// Teardown order matters. The host forgets the issued client ID when the
// upstream socket closes, and a call sent under an ID the host does not know
// runs as its first window. So the binding is removed first (no new call can
// take a hold), the calls that hold it are cancelled and waited for, and only
// then are the sockets closed.
func (g *Gateway) runTunnel(sess *session, client *boundClient, up, down *websocket.Conn) {
	// Reads use their own context so that canceling the session does not cut
	// the sockets before the close handshake has been tried.
	readCtx, stopReads := context.WithCancel(context.Background())
	defer stopReads()

	limits := g.cfg.Limits
	queue := newTunnelQueue(limits.TunnelQueueBytes, limits.TunnelQueueMessages, g.cfg.Timeouts.TunnelLag)
	g.markReady(client)
	g.emit(g.event(EventTunnelOpened, "", sess.principal.credential, sess.principal.node, ""))

	var wg sync.WaitGroup
	wg.Go(func() {
		guarded(sess, func() { g.readUpstream(readCtx, sess, up, queue) }, func() { discardUntilClosed(readCtx, up) })
	})
	wg.Go(func() { guarded(sess, func() { g.writeDownstream(readCtx, sess, down, queue) }, nil) })
	wg.Go(func() {
		guarded(sess, func() { g.guardClient(readCtx, sess, down) }, func() { discardUntilClosed(readCtx, down) })
	})
	wg.Go(func() { guarded(sess, func() { g.keepAlive(readCtx, sess, down) }, nil) })
	wg.Go(func() { guarded(sess, func() { g.watchPeer(sess) }, nil) })

	<-sess.ctx.Done()
	cause := sess.cause()
	g.unbind(client)
	queue.close()
	g.waitCalls(client, g.cfg.Timeouts.CallDrain)
	g.closeSockets(cause, up, down, stopReads)
	stopReads()
	wg.Wait()
	g.emit(g.event(EventTunnelClosed, causeCode(cause), sess.principal.credential, sess.principal.node, ""))
}

// guarded runs one of a tunnel's goroutines. A panic in it, from a bug or from
// an adapter callback, ends the tunnel instead of the process.
//
// The goroutine that reads a socket is also what lets closeSockets cut that
// socket when its peer will not answer a close: the cut cancels the pending
// read, and the library closes the connection when a read's context ends. So a
// reader that panics goes on reading, and discarding, through keepReading.
func guarded(sess *session, f, keepReading func()) {
	defer func() {
		if recover() != nil {
			sess.cancel(errInternal)
			if keepReading != nil {
				keepReading()
			}
		}
	}()
	f()
}

// discardUntilClosed reads and discards messages until the connection fails or
// ctx ends.
func discardUntilClosed(ctx context.Context, conn *websocket.Conn) {
	for {
		_, reader, err := conn.Reader(ctx)
		if err != nil {
			return
		}
		if _, err = io.Copy(io.Discard, reader); err != nil {
			return
		}
	}
}

// readUpstream reads the host's events socket without pause, whatever the page
// is doing, and queues each message that passes the filter for the page. It
// never closes a socket over a message it does not like; it drops it. When the
// page falls too far behind it cuts the page off but goes on reading, so the
// host's own buffer for this socket never grows, and a read stays pending for
// closeSockets to cut.
func (g *Gateway) readUpstream(ctx context.Context, sess *session, up *websocket.Conn, queue *tunnelQueue) {
	for {
		kind, reader, err := up.Reader(ctx)
		if err != nil {
			sess.cancel(errUpstreamGone)
			return
		}
		var payload []byte
		complete := true
		if kind == websocket.MessageText {
			payload, complete, err = readMessage(reader, auditgate.MaxEventMessageBytes)
		} else {
			// The host never sends a binary message; do not buffer one.
			_, err = io.Copy(io.Discard, reader)
		}
		if err != nil {
			sess.cancel(errUpstreamGone)
			return
		}
		if sess.ctx.Err() != nil {
			continue
		}
		if !complete || !g.allow.filter(messageKind(kind), payload).forward {
			g.eventsDropped.Add(1)
			continue
		}
		if !queue.push(payload, time.Now()) {
			sess.cancel(errSlowClient)
		}
	}
}

// messageKind converts the library's message type to the allowlist's.
func messageKind(kind websocket.MessageType) auditgate.MessageKind {
	switch kind {
	case websocket.MessageText:
		return auditgate.MessageText
	case websocket.MessageBinary:
		return auditgate.MessageBinary
	default:
		return 0
	}
}

// writeDownstream sends queued events to the page. A page that cannot take one
// within TunnelWrite, or that has let one wait longer than TunnelLag, is cut
// off. It never reads the host, so a slow page cannot slow it down.
//
// The write deadline is a timer of its own and not the library's: when the
// library's deadline passes it closes the connection first, and the goroutine
// that reads the page can then report the page gone before this one reports
// it slow. The timer ends the tunnel with its cause before anything is closed,
// and the teardown's own cut is what interrupts the blocked write.
func (g *Gateway) writeDownstream(ctx context.Context, sess *session, down *websocket.Conn, queue *tunnelQueue) {
	watchdog := time.AfterFunc(time.Hour, func() { sess.cancel(errSlowClient) })
	watchdog.Stop()
	defer watchdog.Stop()
	for {
		payload, queuedAt, ok := queue.pop(ctx)
		if !ok {
			return
		}
		if time.Since(queuedAt) > g.cfg.Timeouts.TunnelLag {
			sess.cancel(errSlowClient)
			return
		}
		watchdog.Reset(g.cfg.Timeouts.TunnelWrite)
		err := down.Write(ctx, websocket.MessageText, payload)
		watchdog.Stop()
		if err != nil {
			sess.cancel(errClientGone)
			return
		}
		g.eventsForwarded.Add(1)
	}
}

// readMessage reads one whole WebSocket message, however many frames carried
// it, up to limit bytes, and returns it with whether it was complete. A longer
// message is read to its end and discarded without buffering: complete is
// false and the socket stays usable.
func readMessage(reader io.Reader, limit int) ([]byte, bool, error) {
	message, err := io.ReadAll(io.LimitReader(reader, int64(limit)+1))
	if err != nil {
		return nil, false, err
	}
	if len(message) <= limit {
		return message, true, nil
	}
	if _, err = io.Copy(io.Discard, reader); err != nil {
		return nil, false, err
	}
	return nil, false, nil
}

// guardClient reads from the page. The page never sends data on this socket,
// so the first data message, or any error, ends the tunnel. Reading is also
// what lets the library answer the page's pings and see it close. It goes on
// reading after the tunnel has ended, so that a read is always pending for
// closeSockets to cut when the page does not answer the close handshake.
func (g *Gateway) guardClient(ctx context.Context, sess *session, down *websocket.Conn) {
	for {
		if _, _, err := down.Read(ctx); err != nil {
			sess.cancel(errClientGone)
			return
		}
		sess.cancel(errUnexpectedFrame)
	}
}

// keepAlive pings the page so a vanished client is noticed and the connection
// is not idle for a middlebox to drop. Like the writer's, its deadline is a
// timer that ends the tunnel with its cause before anything is closed.
func (g *Gateway) keepAlive(ctx context.Context, sess *session, down *websocket.Conn) {
	ticker := time.NewTicker(g.cfg.Timeouts.TunnelPing)
	defer ticker.Stop()
	watchdog := time.AfterFunc(time.Hour, func() { sess.cancel(errPingTimeout) })
	watchdog.Stop()
	defer watchdog.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-sess.ctx.Done():
			return
		case <-ticker.C:
			watchdog.Reset(g.cfg.Timeouts.TunnelPong)
			err := down.Ping(ctx)
			watchdog.Stop()
			if err != nil {
				sess.cancel(errClientGone)
				return
			}
		}
	}
}

// watchPeer looks the tunnel's peer up again, past the cache, on every interval
// and ends the tunnel when the peer is no longer the owner's node that
// authenticated.
func (g *Gateway) watchPeer(sess *session) {
	ticker := time.NewTicker(g.cfg.Timeouts.PeerRecheck)
	defer ticker.Stop()
	for {
		select {
		case <-sess.ctx.Done():
			return
		case <-ticker.C:
			result := g.peers.fresh(sess.ctx, sess.principal.remote)
			if result.denial != peerAllowed || result.peer.NodeID != sess.principal.node {
				sess.cancel(errPeerChanged)
				return
			}
		}
	}
}

// closeSockets closes both sockets with a close handshake, and cuts them if
// the handshake takes longer than the grace period. A WebSocket peer that never
// answers would otherwise hold the close for the library's own five seconds,
// and a peer that vanished without a FIN for longer. cut cancels the pending
// reads and writes, which makes the library drop the connection.
func (g *Gateway) closeSockets(cause error, up, down *websocket.Conn, cut func()) {
	var wg sync.WaitGroup
	wg.Go(func() { g.closeWithin(down, closeStatus(cause), cut) })
	wg.Go(func() { g.closeWithin(up, websocket.StatusGoingAway, cut) })
	wg.Wait()
}

func (g *Gateway) closeWithin(conn *websocket.Conn, code websocket.StatusCode, cut func()) {
	done := make(chan struct{})
	go func() {
		_ = conn.Close(code, "")
		close(done)
	}()
	timer := time.NewTimer(g.cfg.Timeouts.CloseGrace)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		cut()
		<-done
	}
}

// closeStatus is the WebSocket status the page sees. Reasons are never sent:
// the status is all it learns.
func closeStatus(cause error) websocket.StatusCode {
	switch {
	case errors.Is(cause, errCredentialRevoked), errors.Is(cause, errCredentialExpired),
		errors.Is(cause, errPeerChanged), errors.Is(cause, errUnexpectedFrame):
		return websocket.StatusPolicyViolation
	case errors.Is(cause, errSlowClient):
		return websocket.StatusTryAgainLater
	case errors.Is(cause, errInternal):
		return websocket.StatusInternalError
	default:
		return websocket.StatusGoingAway
	}
}

// causeCode is the bounded diagnostic code for why a tunnel closed.
func causeCode(cause error) string {
	switch {
	case errors.Is(cause, errAuditEnded), errors.Is(cause, errCredentialRevoked),
		errors.Is(cause, errCredentialExpired), errors.Is(cause, errReplaced),
		errors.Is(cause, errPeerChanged), errors.Is(cause, errClientGone),
		errors.Is(cause, errUpstreamGone), errors.Is(cause, errPingTimeout),
		errors.Is(cause, errSlowClient), errors.Is(cause, errUnexpectedFrame),
		errors.Is(cause, errInternal):
		return cause.Error()
	default:
		return closedCode
	}
}
