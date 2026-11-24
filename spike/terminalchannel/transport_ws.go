package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"

	"github.com/coder/websocket"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// wsConn is a WebSocket the host serves itself. coder/websocket's Write returns when the frame is in the kernel's
// socket buffer, and blocks when the peer does not read: TCP is the pacing.
type wsConn struct {
	c   *websocket.Conn
	ctx context.Context
}

func (w *wsConn) send(frame []byte) error { return w.c.Write(w.ctx, websocket.MessageBinary, frame) }
func (w *wsConn) close()                  { _ = w.c.CloseNow() }

// startWS serves the dedicated endpoint on a loopback listener of its own: the native build has no other way to get a
// WebSocket (a webview cannot speak one over its custom scheme), the server build can use it as well.
func (p *probe) startWS() {
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	p.wsPort = ln.Addr().(*net.TCPAddr).Port
	mux := http.NewServeMux()
	mux.HandleFunc("/term", p.serveWS)
	go func() { _ = http.Serve(ln, mux) }()
}

// wsRouteMiddleware serves the same endpoint on the application's own port, for the server build: no second port.
func (p *probe) wsRouteMiddleware() application.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/term" {
				p.serveWS(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (p *probe) serveWS(w http.ResponseWriter, r *http.Request) {
	// OriginPatterns "*": the spike accepts every origin. The design would accept the app's own origins only.
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(4 << 20)
	ctx := r.Context()
	_, first, err := c.Read(ctx)
	if err != nil {
		return
	}
	var hello struct {
		Cap  string `json:"cap"`
		From uint64 `json:"from"`
	}
	if json.Unmarshal(first, &hello) != nil {
		return
	}
	t := p.lookup(hello.Cap)
	if t == nil {
		_ = c.Write(ctx, websocket.MessageBinary, append([]byte{fEnd}, `{"reason":"not-found"}`...))
		return
	}
	conn := &wsConn{c: c, ctx: ctx}
	t.attach(conn)
	defer t.detach(conn)
	p.serve(t, func() ([]byte, error) {
		_, b, err := c.Read(ctx)
		return b, err
	})
}
