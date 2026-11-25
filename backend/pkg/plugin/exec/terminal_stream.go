package exec

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// TerminalStreamName is the name of the Wails stream that carries the terminal channel (docs/ui-next/terminal-channel-protocol.md).
// The page opens `Stream('terminal')`, one for each terminal, and shows the terminal's capability as its first frame: the
// name carries nothing secret, because GoStream puts it in a URL.
const TerminalStreamName = "terminal"

// streamConn is the part of a GoStream connection (*application.StreamConn) that the terminal channel uses: a narrow seam so
// that the adapter is tested with a fake, because Wails builds a connection only for a page that opened one.
type streamConn interface {
	Send(data []byte) error
	Receive() ([]byte, error)
	Close() error
	Context() context.Context
}

var _ streamConn = (*application.StreamConn)(nil)

// streamChannel is a GoStream connection as the terminal's holder (terminal.Channel). Send blocks while the transport's queue
// is full, which is what lets the host tell a page that reads from one that sleeps; Receive blocks like a socket read; both
// fail once the connection is gone, and the connection's context ends with it.
type streamChannel struct{ conn streamConn }

func (s streamChannel) Send(frame []byte) error { return s.conn.Send(frame) }
func (s streamChannel) Recv() ([]byte, error)   { return s.conn.Receive() }
func (s streamChannel) Close() error            { return s.conn.Close() }
func (s streamChannel) Done() <-chan struct{}   { return s.conn.Context().Done() }

// TerminalStreamHandler is what main registers with App.HandleStream(TerminalStreamName, ...), in the native build and in
// the server build alike: one handler for both, because GoStream is the same programming model on either transport. It runs
// once for each connection, on a goroutine of Wails', and returns when the stream ends, which closes the connection.
func TerminalStreamHandler(ctrl Controller) application.StreamHandler {
	return func(conn *application.StreamConn) { ctrl.ServeTerminalChannel(streamChannel{conn: conn}) }
}
