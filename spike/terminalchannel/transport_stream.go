package main

import (
	"encoding/json"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// streamConn is a Wails GoStream connection as the terminal's holder: Send blocks while the window's queue is full, so
// the shell is held in its own write by a page that does not take the bytes, and nothing else paces it.
type streamConn struct{ c *application.StreamConn }

func (s *streamConn) send(frame []byte) error { return s.c.Send(frame) }
func (s *streamConn) close()                  { _ = s.c.Close() }

// handleStream is registered as HandleStream("term", ...): one connection for one terminal. The first frame is the
// capability; a connection that does not show one that is held is closed. The connection's lifetime is the holder's:
// when it ends (the page reloaded, navigated, closed, or the app is shutting down) the terminal has no holder.
func (p *probe) handleStream(c *application.StreamConn) {
	defer c.Close()
	first, err := c.Receive()
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
		_ = c.Send(append([]byte{fEnd}, `{"reason":"not-found"}`...))
		return
	}
	conn := &streamConn{c: c}
	t.attach(conn)
	defer t.detach(conn)
	p.serve(t, c.Receive)
}
