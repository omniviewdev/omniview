package gateway

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"log"
	"net"
	"net/http"

	"golang.org/x/net/netutil"
)

// maxHeaderBytes bounds a request's headers. A page may send cookies the
// owner's other services set on the same host name, so the bound is more than
// this API needs but far below the net/http default of 1 MiB.
const maxHeaderBytes = 32 << 10

// Serve serves the audit on ln until the audit ends or ln fails, then closes
// ln. The caller binds ln: it must listen only on the verified address the
// audit was started for. Serve never opens a listener of its own.
//
// The server speaks HTTP/1.1 over TLS 1.3 only, with deadlines for the TLS
// handshake, the request headers, the whole request and idle connections, a
// bound on request header size, bounds on connections (overall, and per remote
// address both open and per second) and no log output at all. getCertificate
// is called only for the configured name, so a hostile server name never
// triggers a certificate lookup; it runs on every handshake for that name, so
// it must be cheap and cache what it fetches.
//
// Anyone who can open a TCP connection to ln reaches the pre-authentication
// steps. The limits share that work out per remote address; keep the port
// reachable only by the owner's own devices with the tailnet's access
// controls.
//
// Serve returns nil when the audit ended.
func (g *Gateway) Serve(ln net.Listener, getCertificate GetCertificate) error {
	srv := g.newServer(getCertificate)
	serving := make(chan struct{})
	defer close(serving)
	go func() {
		select {
		case <-g.ended:
			_ = srv.Close()
		case <-serving:
		}
	}()
	guarded := newAddressListener(ln, g.cfg.Clock, g.cfg.Limits)
	limited := netutil.LimitListener(guarded, g.cfg.Limits.MaxConnections)
	err := srv.ServeTLS(limited, "", "")
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (g *Gateway) newServer(getCertificate GetCertificate) *http.Server {
	return &http.Server{
		Handler:           g,
		TLSConfig:         g.tlsConfig(getCertificate),
		ReadHeaderTimeout: g.cfg.Timeouts.ReadHeader,
		// net/http takes the smallest of the header, read and write timeouts as
		// the TLS handshake deadline, so ReadHeaderTimeout is that deadline too.
		// ReadTimeout bounds the whole request, body included.
		ReadTimeout:    g.cfg.Timeouts.Read,
		IdleTimeout:    g.cfg.Timeouts.Idle,
		MaxHeaderBytes: maxHeaderBytes,
		// "OPTIONS *" would otherwise be answered by net/http itself, before
		// the identity, authority and credential steps.
		DisableGeneralOptionsHandler: true,
		// A non-nil, empty map turns HTTP/2 off: WebSocket upgrades and the
		// raw request line the route rules read need HTTP/1.1.
		TLSNextProto: make(map[string]func(*http.Server, *tls.Conn, http.Handler)),
		ErrorLog:     log.New(io.Discard, "", 0),
		BaseContext:  func(net.Listener) context.Context { return g.ctx },
		// Handlers need the connection to cut it when their session ends (see
		// interruptWrites).
		ConnContext: func(ctx context.Context, c net.Conn) context.Context {
			return context.WithValue(ctx, connectionKey{}, c)
		},
	}
}

// tlsConfig is TLS 1.3 only. The certificate callback runs only when the
// client's SNI is exactly the configured name (ASCII case aside); any other
// name, an IP literal or no name fails the handshake without touching the
// callback.
func (g *Gateway) tlsConfig(getCertificate GetCertificate) *tls.Config {
	return &tls.Config{ //nolint:exhaustruct // Only the settings that matter here are set.
		MinVersion: tls.VersionTLS13,
		MaxVersion: tls.VersionTLS13,
		NextProtos: []string{"http/1.1"},
		GetCertificate: func(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
			if !asciiEqualFold(hello.ServerName, g.cfg.ServerName) {
				return nil, errServerName
			}
			return getCertificate(hello)
		},
	}
}

var errServerName = errors.New("gateway: server name is not this audit's name")
