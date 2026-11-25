package portforward

import (
	"io"
	"net"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/ui-next/plugins/fixture/internal/bindretry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker/networktest"
)

// The forwarder under the SDK's own manager, which is what a plugin's networker capability is: the manager picks the local port, waits for the forwarder to be ready, keeps the session ACTIVE until it is closed and cancels the
// forwarder's context when it is.

func mountManager(t *testing.T, target *Server) *networktest.Harness {
	t.Helper()
	return networktest.Mount(t,
		networktest.WithResourceForwarder(ResourceKey, NewForwarder(target.Addr())),
		networktest.WithPortChecker(networker.RealPortChecker{}),
	)
}

// startSession starts a session of the target through the manager, which chooses the local port itself: it finds one by listening on port 0 and closing the listener, so another process can take the port before the forwarder
// binds it. That start is asked again (`bindretry.Until`), and any other failure fails the test.
func startSession(t *testing.T, harness *networktest.Harness) *networker.PortForwardSession {
	t.Helper()
	session, err := bindretry.Until(func() (*networker.PortForwardSession, error) {
		return harness.StartSession(sessionOptions(0))
	})
	require.NoError(t, err)
	return session
}

func TestTheManagerRunsTheForwarderAsASessionThatStopsWhenItIsClosed(t *testing.T) {
	harness := mountManager(t, startTarget(t))

	session := startSession(t, harness)

	require.Equal(t, networker.SessionStateActive, session.State)
	require.NotEmpty(t, session.ID)
	require.NotZero(t, session.LocalPort, "the manager chose the port the forwarder listens on")
	require.Equal(t, TargetPort, session.RemotePort)
	address := loopback(session.LocalPort)
	conn := connect(t, address)
	require.Equal(t, Greeting, conn.greeting(t))
	require.Equal(t, "ping", conn.say(t, "ping"))

	stopped, err := harness.CloseSession(session.ID)

	require.NoError(t, err)
	require.Equal(t, networker.SessionStateStopped, stopped.State)
	// The close cancels the forwarder's context: the connection that was open ends, and the listener was closed before it did.
	rest, err := io.ReadAll(conn.reader)
	require.NoError(t, err)
	require.Empty(t, rest)
	var dialer net.Dialer
	refused, err := dialer.DialContext(t.Context(), "tcp", address)
	if err == nil {
		_ = refused.Close()
	}
	require.Error(t, err)
}

func TestTheManagerRefusesAStartTheTargetCannotServeWithTheForwardersWords(t *testing.T) {
	harness := mountManager(t, startTarget(t))
	options := sessionOptions(0)
	options.RemotePort = TargetPort + 1

	_, err := harness.StartSession(options)

	require.ErrorIs(t, err, networker.ErrNetForwarderFailed)
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
	sessions, err := harness.ListSessions()
	require.NoError(t, err)
	require.Empty(t, sessions, "a refused start is no session")
}

func TestStoppingEverythingEndsTheTunnelsOfEverySession(t *testing.T) {
	target := startTarget(t)
	harness := mountManager(t, target)
	first := startSession(t, harness)
	second := startSession(t, harness)
	require.NotEqual(t, first.LocalPort, second.LocalPort)
	one := connect(t, loopback(first.LocalPort))
	two := connect(t, loopback(second.LocalPort))
	require.Equal(t, Greeting, one.greeting(t))
	require.Equal(t, Greeting, two.greeting(t))

	// What the host does when a plugin is told to stop.
	harness.Manager.StopAll()

	for _, c := range []*client{one, two} {
		_, err := io.ReadAll(c.reader)
		require.NoError(t, err)
	}
}
