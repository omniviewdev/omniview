package gateway

import (
	"bytes"
	"context"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

const (
	// maxUpstreamHeaderBytes bounds the response headers read from the
	// upstream.
	maxUpstreamHeaderBytes = 32 << 10
	maxIdleUpstream        = 16
	upstreamIdleTimeout    = 30 * time.Second
	maxContentTypeBytes    = 200
)

// upstreamClient talks to the one loopback Wails server of this audit. It
// dials only the captured address, whatever URL or Host a request names, uses
// no proxy, follows no redirect and asks for no compression, so what the
// upstream returns is what the gateway sees.
type upstreamClient struct {
	// host is the authority every upstream request carries, for example
	// 127.0.0.1:34115. The host's own loopback checks require it.
	host string
	// origin is the loopback origin a same-origin page there would send.
	origin    string
	transport *http.Transport
	client    *http.Client
}

func newUpstreamClient(address netip.AddrPort, dialTimeout time.Duration) *upstreamClient {
	target := address.String()
	dialer := &net.Dialer{Timeout: dialTimeout} //nolint:exhaustruct // Only the timeout is set.
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, "tcp", target)
		},
		DisableCompression:     true,
		MaxIdleConns:           maxIdleUpstream,
		MaxIdleConnsPerHost:    maxIdleUpstream,
		IdleConnTimeout:        upstreamIdleTimeout,
		MaxResponseHeaderBytes: maxUpstreamHeaderBytes,
	}
	return &upstreamClient{
		host:      target,
		origin:    "http://" + target,
		transport: transport,
		client: &http.Client{
			Transport:     transport,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

func (u *upstreamClient) close() {
	u.transport.CloseIdleConnections()
}

// do sends one request to the upstream. The URL is built here from a path the
// caller has already restricted; the request carries exactly the headers
// given, never the remote client's.
func (u *upstreamClient) do(
	ctx context.Context, method, path string, header http.Header, body []byte,
) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://"+u.host+path, reader)
	if err != nil {
		return nil, err
	}
	req.Host = u.host
	req.Header = header
	// The URL is the captured loopback address plus a path the route table
	// already restricted; nothing in it is client-controlled text.
	return u.client.Do(req) //nolint:gosec // G704: the target is fixed, see above.
}

// eventsURL is the upstream events socket for an issued client ID.
func (u *upstreamClient) eventsURL(clientID string) string {
	return "ws://" + u.host + "/wails/events?clientId=" + clientID
}

// relay sends an upstream response to the remote client and returns whether it
// was sent. It copies the status, a validated Content-Type and the body, and
// nothing else: upstream cookies, challenges, redirects, caching and other
// headers never reach the remote. A response that is not acceptable becomes a
// fixed 502 before anything is written; one that grows past limit once the
// body is under way aborts the connection, so a truncated body is never
// mistaken for a complete one.
func (g *Gateway) relay(w http.ResponseWriter, resp *http.Response, limit int64, head bool) {
	defer resp.Body.Close()
	status := resp.StatusCode
	switch {
	case status < http.StatusOK || (status >= http.StatusMultipleChoices && status < http.StatusBadRequest):
		// A redirect or interim status is never expected from the routes the
		// gateway allows, and its Location would name the loopback origin.
		g.refuseUpstream(w, reasonUpstreamStatus)
		return
	case resp.ContentLength > limit:
		g.refuseUpstream(w, reasonResponseTooBig)
		return
	}
	header := w.Header()
	if contentType := resp.Header.Get("Content-Type"); validContentType(contentType) {
		header.Set("Content-Type", contentType)
	}
	if resp.ContentLength >= 0 {
		header.Set("Content-Length", strconv.FormatInt(resp.ContentLength, 10))
	}
	w.WriteHeader(status)
	if head || status == http.StatusNoContent {
		return
	}
	copied, err := io.Copy(w, io.LimitReader(resp.Body, limit+1))
	if err != nil || copied > limit {
		panic(http.ErrAbortHandler)
	}
}

func validContentType(value string) bool {
	if value == "" || len(value) > maxContentTypeBytes {
		return false
	}
	_, _, err := mime.ParseMediaType(value)
	return err == nil
}

func (g *Gateway) refuseUpstream(w http.ResponseWriter, reason auditgate.Reason) {
	g.denials.add(DenialUpstream)
	writeProblem(w, http.StatusBadGateway, CodeUnavailable, reason)
}
