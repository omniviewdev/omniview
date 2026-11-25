//nolint:exhaustruct // A zero value is what the fields of a fixture's own types start as.
package portforward

import (
	"context"
	"net"
	"strconv"
	"sync"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const loopbackHost = "127.0.0.1"

// listenLoopback listens on the loopback on a port: the one it is given or, for 0, one the system chooses that nothing else holds. Nothing but this computer can reach what it listens for.
func listenLoopback(ctx context.Context, port int32) (net.Listener, error) {
	var config net.ListenConfig
	listener, err := config.Listen(ctx, "tcp", net.JoinHostPort(loopbackHost, strconv.Itoa(int(port))))
	if err != nil {
		return nil, &resourcev2.ResourceOperationError{Err: err, Code: "UNAVAILABLE", Message: unavailableWords(port)}
	}

	return listener, nil
}

// unavailableWords says in plain words that a port could not be listened on, for a person who asked for it or for any.
func unavailableWords(port int32) string {
	if port == 0 {
		return "No free port is available on this computer."
	}

	return "Port " + strconv.Itoa(int(port)) + " is not available on this computer."
}

// endpoint is a listener and the connections that were accepted or dialled on its behalf: what a server and a tunnel are each made of. Ending it closes the listener first, so that nothing new arrives while the
// connections are closed, and then every connection; whoever reads a connection end after that knows the listener is closed. It is safe to end twice, and a connection given to it after it ended is refused.
type endpoint struct {
	listener net.Listener
	mu       sync.Mutex
	conns    map[net.Conn]struct{}
	closed   bool
}

func newEndpoint(listener net.Listener) *endpoint {
	return &endpoint{listener: listener, conns: make(map[net.Conn]struct{})}
}

// track takes a connection in, or answers false when the endpoint has ended and the caller must close it.
func (e *endpoint) track(conn net.Conn) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return false
	}
	e.conns[conn] = struct{}{}

	return true
}

// release closes a connection and forgets it.
func (e *endpoint) release(conn net.Conn) {
	_ = conn.Close()
	e.mu.Lock()
	delete(e.conns, conn)
	e.mu.Unlock()
}

// isClosed says whether the endpoint has ended: a listener that fails after that failed because it was closed.
func (e *endpoint) isClosed() bool {
	e.mu.Lock()
	defer e.mu.Unlock()

	return e.closed
}

// close ends the endpoint: the flag first, then the listener, then every connection. It answers the listener's own error the first time and nothing after.
func (e *endpoint) close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return nil
	}
	e.closed = true
	err := e.listener.Close()
	for conn := range e.conns {
		_ = conn.Close()
	}

	return err
}
