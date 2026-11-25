package portforward

import (
	"bufio"
	"context"
	"io"
	"net"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/ui-next/plugins/fixture/internal/bindretry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
)

// The helpers of the tests: a target to forward to, clients that talk to it through a tunnel, and a scan that says whether a test left anything of this package running. A test goes on when a connection closes, a channel closes
// or a call returns, and that is also all the tunnel itself is held to: none of them waits for a time to pass.

// waitLimit bounds every wait of these tests for something that takes a few milliseconds: a read of a connection, the end of a forward, the arrival of a connection at a listener. It is never how a test goes on. It is how long a
// regression that leaves one of them hanging is waited for before the test fails and says which wait it was, instead of stalling the whole package until the test binary's own limit stops it.
const waitLimit = 10 * time.Second

// startTarget runs the fixture's target server for the length of the test.
func startTarget(t *testing.T) *Server {
	t.Helper()
	server, err := NewServer()
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, server.Close())
	})
	return server
}

// listenBare listens on the loopback on a port the system chose and nothing serves it: a test that is the other end of a connection, or that holds an address, uses it. It is closed when the test ends.
func listenBare(t *testing.T) *net.TCPListener {
	t.Helper()
	listener, err := net.ListenTCP("tcp", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0, Zone: ""})
	require.NoError(t, err)
	t.Cleanup(func() { _ = listener.Close() })
	return listener
}

// freeLoopbackPort is a port nothing listens on at this moment: a listener on port 0, which the system gives a free port, closed at once. Nothing holds the port afterwards, which is what `onFreePort` is for.
func freeLoopbackPort(t *testing.T) int32 {
	t.Helper()
	var config net.ListenConfig
	listener, err := config.Listen(t.Context(), "tcp", "127.0.0.1:0")
	require.NoError(t, err)
	address, ok := listener.Addr().(*net.TCPAddr)
	require.True(t, ok)
	require.NoError(t, listener.Close())
	return int32(address.Port)
}

// onFreePort calls start with a loopback port that was free a moment ago, and answers that port and what start answered. The port cannot be held for start: another process can take it between the finding and the bind, and a
// start that fails for that reason alone, the address being in use, is asked again with a fresh port (`bindretry.Until`). Every other failure fails the test, and so does the last one when the address was taken every time.
func onFreePort[T any](t *testing.T, start func(port int32) (T, error)) (int32, T) {
	t.Helper()
	var port int32
	started, err := bindretry.Until(func() (T, error) {
		port = freeLoopbackPort(t)
		return start(port)
	})
	require.NoError(t, err)
	return port, started
}

// loopback is the address a forward listens on, by its port.
func loopback(port int32) string {
	return net.JoinHostPort("127.0.0.1", strconv.Itoa(int(port)))
}

// client is one connection of a test to an address, with the buffered side its lines are read from.
type client struct {
	conn   *net.TCPConn
	reader *bufio.Reader
}

// connect opens a connection to address, closed when the test ends. Every read and write of it is bounded by `waitLimit`: a relay that accepts a connection and says nothing would leave a read waiting for ever, and a dial that
// succeeded sets no deadline on the socket it made.
func connect(t *testing.T, address string) *client {
	t.Helper()
	dialer := net.Dialer{Timeout: waitLimit}
	conn, err := dialer.DialContext(t.Context(), "tcp", address)
	require.NoError(t, err)
	tcp, ok := conn.(*net.TCPConn)
	require.True(t, ok)
	t.Cleanup(func() {
		_ = tcp.Close()
	})
	require.NoError(t, tcp.SetDeadline(time.Now().Add(waitLimit)))
	return &client{conn: tcp, reader: bufio.NewReader(tcp)}
}

// greeting reads the first line of a connection.
func (c *client) greeting(t *testing.T) string {
	t.Helper()
	line, err := c.reader.ReadString('\n')
	require.NoError(t, err, "the greeting of the connection was not read")
	return line
}

// say sends words and reads back as many bytes as it sent.
func (c *client) say(t *testing.T, words string) string {
	t.Helper()
	_, err := c.conn.Write([]byte(words))
	require.NoError(t, err, "the words were not sent")
	back := make([]byte, len(words))
	_, err = io.ReadFull(c.reader, back)
	require.NoError(t, err, "the words were not sent back")
	return string(back)
}

// handlerOptions is what the SDK's manager hands a forwarder for a start of the fixture's target on localPort.
func handlerOptions(localPort int32) networker.ResourcePortForwardHandlerOpts {
	return networker.ResourcePortForwardHandlerOpts{
		Resource: networker.PortForwardResourceConnection{ResourceKey: ResourceKey, ResourceID: TargetID},
		Options:  sessionOptions(localPort),
	}
}

// sessionOptions is a start of the fixture's target on localPort as the host makes it.
func sessionOptions(localPort int32) networker.PortForwardSessionOptions {
	return networker.PortForwardSessionOptions{
		ConnectionType: networker.PortForwardConnectionTypeResource,
		Protocol:       networker.PortForwardProtocolTCP,
		LocalPort:      localPort,
		RemotePort:     TargetPort,
		Connection:     networker.PortForwardResourceConnection{ResourceKey: ResourceKey, ResourceID: TargetID},
	}
}

// wordsOf is what a classified error tells the person who reads it: the message that crosses the resource transport, which the error's own text (JSON of the classification) is not.
func wordsOf(t *testing.T, err error) string {
	t.Helper()
	var classified *resourcev2.ResourceOperationError
	require.ErrorAs(t, err, &classified)
	return classified.Message
}

// forward is a forward of the target that a test started: the address it listens on, what the forwarder answered and the way to end it.
type forward struct {
	address string
	result  *networker.ForwarderResult
	stop    context.CancelFunc
}

// startForward starts a forward of the target through the forwarder, as the manager does, and ends it when the test does.
func startForward(t *testing.T, target *Server) forward {
	t.Helper()
	return startForwardTo(t, target.Addr())
}

// startForwardTo starts a forward to whatever listens at `target` on a local port found for it (`onFreePort`), and ends it when the test does. An attempt that failed is cancelled, and ran nothing.
func startForwardTo(t *testing.T, target string) forward {
	t.Helper()
	_, started := onFreePort(t, func(port int32) (forward, error) {
		ctx, cancel := context.WithCancel(t.Context())
		result, err := NewForwarder(target).ForwardResource(ctx, nil, handlerOptions(port))
		if err != nil {
			cancel()
			return forward{}, err
		}
		return forward{address: loopback(port), result: result, stop: cancel}, nil
	})
	t.Cleanup(func() {
		started.stop()
		_ = drain(t, started.result.ErrCh)
	})
	return started
}

// drain reads an error channel until it closes, which a forwarder does when everything of the forward has ended, and answers what it said on the way. A forward that has not ended after `waitLimit` fails the test and says so:
// its error channel is still open, and so something of it is still running.
func drain(t *testing.T, errCh <-chan error) []error {
	t.Helper()
	limit := time.NewTimer(waitLimit)
	defer limit.Stop()
	var said []error
	for {
		select {
		case err, open := <-errCh:
			if !open {
				return said
			}
			said = append(said, err)
		case <-limit.C:
			require.FailNow(t, "the forward did not end", "its error channel was still open after %v", waitLimit)
		}
	}
}

// goroutinesOfThisPackage lists the stacks of the goroutines that are running code of this package outside its test files. A test that has stopped what it started expects none.
func goroutinesOfThisPackage() []string {
	return goroutinesRunning("")
}

// tunnelsRunning lists the same for the code of the tunnels only: a test whose target server is still up asks for these, because the server's own goroutines are running.
func tunnelsRunning() []string {
	return goroutinesRunning("(*tunnel).", "carry")
}

// goroutinesRunning lists the goroutines with a frame of a function of this package, outside its test files, that starts with one of the names (all of them for an empty name).
func goroutinesRunning(names ...string) []string {
	prefix := reflect.TypeFor[tunnel]().PkgPath() + "."
	var running []string
	for _, stack := range allStacks() {
		for _, name := range names {
			if runsCodeOf(stack, prefix+name) {
				running = append(running, stack)
				break
			}
		}
	}
	return running
}

// allStacks is the stack of every goroutine, one text each.
func allStacks() []string {
	size := 1 << 16
	for {
		buf := make([]byte, size)
		if n := runtime.Stack(buf, true); n < size {
			return strings.Split(strings.TrimSpace(string(buf[:n])), "\n\n")
		}
		size *= 2
	}
}

// runsCodeOf says whether a frame of the stack is a function of the package: a line that starts with the import path, followed by the file line of a file that is not a test.
//
// One closure is not counted: the one that closes a tunnel's error channel, `startTunnel.func1`. It closes the channel when the tunnel's work is over, so a goroutine that is in it and in no other function of the package has done
// all of its work and is only returning, and a test that has just seen the channel close may meet it there. A goroutine that is stuck is inside a function of the tunnel (`run` and what it calls), and that is counted.
func runsCodeOf(stack, prefix string) bool {
	lines := strings.Split(stack, "\n")
	for i := 1; i+1 < len(lines); i++ {
		if strings.HasPrefix(lines[i], prefix) && !strings.Contains(lines[i], ".startTunnel.func") && !strings.Contains(lines[i+1], "_test.go:") {
			return true
		}
	}
	return false
}
