//nolint:exhaustruct // A zero value is what the fields of a fixture's own types start as.
package portforward

import (
	"context"
	"io"
	"net"
	"sync"
)

// Greeting is the line the target sends first on every connection, before it has been sent anything. A client that reads it through a forward has reached the target.
const Greeting = "PF1-FIXTURE-HELLO\n"

// echoBufferSize is how much of what a client sends the target reads at a time to send it back.
const echoBufferSize = 4096

// Server is the fixture's target: it listens on the loopback, on a port the system chooses, sends Greeting to every connection and then sends back every byte it is sent. It runs until it is closed.
type Server struct {
	*endpoint

	wg sync.WaitGroup
}

// NewServer starts the target.
func NewServer() (*Server, error) {
	listener, err := listenLoopback(context.Background(), 0)
	if err != nil {
		return nil, err
	}
	server := &Server{endpoint: newEndpoint(listener)}
	server.wg.Go(server.acceptLoop)

	return server, nil
}

// Addr is the address the target listens on, `127.0.0.1:<port>`.
func (s *Server) Addr() string {
	return s.listener.Addr().String()
}

// Close ends the target: it stops listening, closes every connection and waits for what served them. Closing twice is not an error.
func (s *Server) Close() error {
	err := s.close()
	s.wg.Wait()

	return err
}

func (s *Server) acceptLoop() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			return
		}
		if !s.track(conn) {
			_ = conn.Close()

			return
		}
		s.wg.Go(func() { s.serve(conn) })
	}
}

// serve greets one connection and sends back what it is sent until the client has no more to say, and then closes it: whoever relays it learns that nothing more will come.
func (s *Server) serve(conn net.Conn) {
	defer s.release(conn)
	if _, err := io.WriteString(conn, Greeting); err != nil {
		return
	}
	buffer := make([]byte, echoBufferSize)
	for {
		n, err := conn.Read(buffer)
		if n > 0 {
			if _, writeErr := conn.Write(buffer[:n]); writeErr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}
