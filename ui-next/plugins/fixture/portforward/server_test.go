package portforward

import (
	"io"
	"net"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTheGreetingIsTheLineTheSeamReads(t *testing.T) {
	require.Equal(t, "PF1-FIXTURE-HELLO\n", Greeting)
}

func TestServerListensOnTheLoopbackOnAPortTheSystemChose(t *testing.T) {
	server := startTarget(t)
	host, port, err := net.SplitHostPort(server.Addr())
	require.NoError(t, err)
	require.Equal(t, "127.0.0.1", host)
	require.NotEqual(t, "0", port)
}

func TestServerGreetsEachConnectionAndEchoesEveryByte(t *testing.T) {
	server := startTarget(t)
	first := connect(t, server.Addr())
	second := connect(t, server.Addr())

	require.Equal(t, Greeting, first.greeting(t))
	require.Equal(t, Greeting, second.greeting(t))
	require.Equal(t, "alpha", first.say(t, "alpha"))
	require.Equal(t, "beta", second.say(t, "beta"))
	require.Equal(t, "and on", first.say(t, "and on"))
}

func TestServerEchoesWhatCameBeforeTheClientStoppedSending(t *testing.T) {
	server := startTarget(t)
	conn := connect(t, server.Addr())
	require.Equal(t, Greeting, conn.greeting(t))

	_, err := conn.conn.Write([]byte("last words"))
	require.NoError(t, err)
	require.NoError(t, conn.conn.CloseWrite())
	rest, err := io.ReadAll(conn.reader)
	require.NoError(t, err)
	require.Equal(t, "last words", string(rest))
}

func TestServerCloseEndsEveryConnectionAndLeavesNothingRunning(t *testing.T) {
	server, err := NewServer()
	require.NoError(t, err)
	t.Cleanup(func() { _ = server.Close() })
	conn := connect(t, server.Addr())
	require.Equal(t, Greeting, conn.greeting(t))

	require.NoError(t, server.Close())

	_, err = conn.reader.ReadByte()
	require.ErrorIs(t, err, io.EOF)
	var dialer net.Dialer
	refused, err := dialer.DialContext(t.Context(), "tcp", server.Addr())
	if err == nil {
		_ = refused.Close()
	}
	require.Error(t, err, "a closed server accepts nothing")
	require.Empty(t, goroutinesOfThisPackage())
	require.NoError(t, server.Close(), "a second close is not an error")
}
