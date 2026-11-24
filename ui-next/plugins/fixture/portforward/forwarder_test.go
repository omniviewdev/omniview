package portforward

import (
	"context"
	"errors"
	"io"
	"net"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
)

type handlerOpts = networker.ResourcePortForwardHandlerOpts

func TestForwardResourceRefusesAStartTheTargetCannotServe(t *testing.T) {
	forwarder := NewForwarder(startTarget(t).Addr())
	for _, refusal := range []struct {
		name   string
		change func(*handlerOpts)
		says   string
	}{
		{"another resource", func(o *handlerOpts) { o.Resource.ResourceID = "other" }, `"fixture-target"`},
		{"UDP", func(o *handlerOpts) { o.Options.Protocol = networker.PortForwardProtocolUDP }, "TCP"},
		{"another remote port", func(o *handlerOpts) { o.Options.RemotePort = TargetPort + 1 }, "8080"},
		{"a negative local port", func(o *handlerOpts) { o.Options.LocalPort = -1 }, "65535"},
		{"a local port out of range", func(o *handlerOpts) { o.Options.LocalPort = 65536 }, "65535"},
	} {
		t.Run(refusal.name, func(t *testing.T) {
			opts := handlerOptions(0)
			refusal.change(&opts)

			result, err := forwarder.ForwardResource(t.Context(), nil, opts)

			require.Nil(t, result)
			require.Error(t, err)
			require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
			require.Contains(t, wordsOf(t, err), refusal.says)
		})
	}
	require.Empty(t, tunnelsRunning(), "a start that is refused runs no tunnel")
}

func TestListenLoopbackListensOnTheLoopbackOnTheGivenPortOrAFreeOne(t *testing.T) {
	free, err := listenLoopback(t.Context(), 0)
	require.NoError(t, err)
	t.Cleanup(func() { _ = free.Close() })
	address, ok := free.Addr().(*net.TCPAddr)
	require.True(t, ok)
	require.Equal(t, "127.0.0.1", address.IP.String())
	require.NotZero(t, address.Port)

	port, named := onFreePort(t, func(port int32) (net.Listener, error) {
		return listenLoopback(t.Context(), port)
	})
	t.Cleanup(func() { _ = named.Close() })
	require.Equal(t, loopback(port), named.Addr().String())
}

func TestListenLoopbackSaysInPlainWordsThatThePortIsTaken(t *testing.T) {
	taken, err := listenLoopback(t.Context(), 0)
	require.NoError(t, err)
	t.Cleanup(func() { _ = taken.Close() })
	address, ok := taken.Addr().(*net.TCPAddr)
	require.True(t, ok)

	_, err = listenLoopback(t.Context(), int32(address.Port))

	require.Error(t, err)
	require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(err))
	require.Contains(t, wordsOf(t, err), "not available")
}

func TestForwardResourceIsReadyWhenItListens(t *testing.T) {
	f := startForward(t, startTarget(t))

	select {
	case <-f.result.Ready:
	default:
		require.Fail(t, "the forwarder answered before it was ready")
	}
	conn := connect(t, f.address)
	require.Equal(t, Greeting, conn.greeting(t), "ready means the listener accepts at once")
}

func TestForwardResourceSuppliesAUniqueSessionID(t *testing.T) {
	target := startTarget(t)
	first := startForward(t, target)
	second := startForward(t, target)

	for _, f := range []forward{first, second} {
		_, err := uuid.Parse(f.result.SessionID)
		require.NoError(t, err)
	}
	require.NotEqual(t, first.result.SessionID, second.result.SessionID)
}

func TestForwardRelaysEveryConnectionToTheTarget(t *testing.T) {
	f := startForward(t, startTarget(t))
	first := connect(t, f.address)
	second := connect(t, f.address)

	require.Equal(t, Greeting, first.greeting(t))
	require.Equal(t, Greeting, second.greeting(t))
	require.Equal(t, "one", first.say(t, "one"))
	require.Equal(t, "two", second.say(t, "two"))
	require.Equal(t, "three", first.say(t, "three"))
}

func TestForwardDeliversWhatIsEchoedAfterTheClientStoppedSending(t *testing.T) {
	f := startForward(t, startTarget(t))
	conn := connect(t, f.address)
	require.Equal(t, Greeting, conn.greeting(t))

	_, err := conn.conn.Write([]byte("last words"))
	require.NoError(t, err)
	require.NoError(t, conn.conn.CloseWrite())
	rest, err := io.ReadAll(conn.reader)

	require.NoError(t, err)
	require.Equal(t, "last words", string(rest))
}

func TestForwardGoesOnServingAfterATargetRefusedAConnection(t *testing.T) {
	gone := listenBare(t)
	// The forward's port is found while the target's address is still held, so the two can never be one address (a forward that was its own target would serve nothing). The target is gone once the forward has its port.
	f := startForwardTo(t, gone.Addr().String())
	require.NoError(t, gone.Close())

	for range 2 {
		conn := connect(t, f.address)
		_, err := conn.reader.ReadByte()
		require.ErrorIs(t, err, io.EOF, "a client whose target refuses is let go")
	}

	select {
	case said, open := <-f.result.ErrCh:
		require.Fail(t, "a target that refuses is not a listener that failed", "%v %v", said, open)
	default:
	}
}

func TestCancelClosesTheListenerAndEveryRelayedConnection(t *testing.T) {
	target := startTarget(t)
	f := startForward(t, target)
	first := connect(t, f.address)
	second := connect(t, f.address)
	require.Equal(t, Greeting, first.greeting(t))
	require.Equal(t, Greeting, second.greeting(t))
	require.Equal(t, "first", first.say(t, "first"), "both relays are up")
	require.Equal(t, "second", second.say(t, "second"), "both relays are up")

	f.stop()

	for _, c := range []*client{first, second} {
		rest, err := io.ReadAll(c.reader)
		require.NoError(t, err, "the relayed connection is closed")
		require.Empty(t, rest)
	}
	var dialer net.Dialer
	refused, err := dialer.DialContext(t.Context(), "tcp", f.address)
	if err == nil {
		_ = refused.Close()
	}
	require.Error(t, err, "the listener is closed")
	require.Empty(t, drain(t, f.result.ErrCh), "an end by cancellation says nothing: its channel only closes")
	require.NoError(t, target.Close())
	require.Empty(t, goroutinesOfThisPackage())
}

func TestCancelClosesTheConnectionToTheTargetToo(t *testing.T) {
	target := listenBare(t)
	f := startForwardTo(t, target.Addr().String())
	conn := connect(t, f.address)

	// The test is the target: it takes the connection the relay dials for the client.
	require.NoError(t, target.SetDeadline(time.Now().Add(waitLimit)))
	accepted, err := target.Accept()
	require.NoError(t, err, "the relay did not dial the target for the client")
	t.Cleanup(func() { _ = accepted.Close() })
	require.NoError(t, accepted.SetDeadline(time.Now().Add(waitLimit)))

	// The target accepts the connection before the relay has taken it in hand, and a cancel that came first would have the relay close it itself, which says nothing of the shutdown. A word of the target that reaches the client has
	// been read by the relay, which reads the connection only once it holds it: what the cancel ends below is then a connection of the forward.
	_, err = accepted.Write([]byte("hello"))
	require.NoError(t, err)
	word := make([]byte, len("hello"))
	_, err = io.ReadFull(conn.reader, word)
	require.NoError(t, err, "the word of the target did not reach the client through the relay")
	require.Equal(t, "hello", string(word))

	f.stop()

	// The target hears the end of the relay's side at once, from the half close that every relay does for the connection it dials...
	_, err = io.ReadAll(accepted)
	require.NotErrorIs(t, err, os.ErrDeadlineExceeded, "the connection to the target was left open")
	// ...but the forward is over only when its relay is, and a relay waits on a target that is silent until its own connection to it is closed: a tunnel that does not close it leaves this waiting, and every goroutine with it.
	require.Empty(t, drain(t, f.result.ErrCh))
	require.Empty(t, tunnelsRunning())
}

func TestAListenerThatFailsIsReportedOnTheErrorChannel(t *testing.T) {
	cause := errors.New("the network went away")
	listener := newFailingListener(cause)
	errCh := startTunnel(t.Context(), listener, "127.0.0.1:1")

	listener.failNow()
	said := drain(t, errCh)

	require.Len(t, said, 1)
	require.ErrorIs(t, said[0], cause)
	require.Contains(t, said[0].Error(), "the forwarding listener failed")
	require.True(t, listener.closedByTunnel(), "the tunnel closes the listener it was given")
	require.Empty(t, goroutinesOfThisPackage())
}

func TestAnIdleTunnelEndsCleanlyWhenItsContextIsCancelled(t *testing.T) {
	var config net.ListenConfig
	listener, err := config.Listen(t.Context(), "tcp", "127.0.0.1:0")
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	errCh := startTunnel(ctx, listener, "127.0.0.1:1")

	cancel()

	require.Empty(t, drain(t, errCh))
	require.Empty(t, goroutinesOfThisPackage())
	_, err = listener.Accept()
	require.ErrorIs(t, err, net.ErrClosed, "the listener it was given is closed")
}

func TestTheScanFindsATunnelThatIsRunningAndNotATargetAlone(t *testing.T) {
	// Every claim that nothing is left running is worth what this one is: the scan finds what is running. The target's own goroutines are code of the package and no tunnel, so a scan for tunnels finds nothing while only the
	// target is up...
	target := startTarget(t)
	alone := connect(t, target.Addr())
	require.Equal(t, Greeting, alone.greeting(t))
	require.NotEmpty(t, goroutinesOfThisPackage(), "the target's accept loop and its connection are code of the package")
	require.Empty(t, tunnelsRunning(), "and are no tunnel")

	// ...and finds the accept loop of a tunnel, and the copy of a connection it relays, once there is one.
	f := startForward(t, target)
	through := connect(t, f.address)
	require.Equal(t, Greeting, through.greeting(t))
	found := strings.Join(tunnelsRunning(), "\n")
	require.Contains(t, found, ".(*tunnel).accept(", "the accept loop of the tunnel")
	require.Contains(t, found, ".carry(", "the copy of a connection the tunnel relays")
}

// failingListener is a listener whose Accept fails when the test says so, and which says whether it was closed.
type failingListener struct {
	cause  error
	fail   chan struct{}
	closed chan struct{}
	once   sync.Once
}

func newFailingListener(cause error) *failingListener {
	return &failingListener{cause: cause, fail: make(chan struct{}), closed: make(chan struct{}), once: sync.Once{}}
}

func (l *failingListener) failNow() { close(l.fail) }

func (l *failingListener) Accept() (net.Conn, error) {
	select {
	case <-l.fail:
		return nil, l.cause
	case <-l.closed:
		return nil, net.ErrClosed
	}
}

func (l *failingListener) Close() error {
	l.once.Do(func() { close(l.closed) })
	return nil
}

func (l *failingListener) Addr() net.Addr {
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0, Zone: ""}
}

func (l *failingListener) closedByTunnel() bool {
	select {
	case <-l.closed:
		return true
	default:
		return false
	}
}
