package main

import (
	"bufio"
	"io"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/ui-next/plugins/fixture/internal/bindretry"
	"github.com/omniviewdev/omniview/ui-next/plugins/fixture/portforward"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
)

// The plugin's process in a bottle: its resource controller and its networker capability wired the way `main` wires them, without the host and without the gRPC between them. What the host does with a page's press of the
// button is what these do: it asks the plugin's networker for a forward on a connection, and the SDK starts it only on a connection that is started.

// startOptions is a start of the fixture's target on a free local port, as the host sends it.
func startOptions() networker.PortForwardSessionOptions {
	return networker.PortForwardSessionOptions{
		ConnectionType: networker.PortForwardConnectionTypeResource,
		Protocol:       networker.PortForwardProtocolTCP,
		RemotePort:     portforward.TargetPort,
		Connection: networker.PortForwardResourceConnection{
			PluginID:     pluginID,
			ConnectionID: connectionID,
			ResourceID:   portforward.TargetID,
			ResourceKey:  portforward.ResourceKey,
		},
	}
}

// bottle is the plugin as the host sees it: the controller that serves the connection, and the networker provider that starts forwards.
type bottle struct {
	controller *fixtureController
	provider   networker.ResourcePortForwardProvider
	target     *portforward.Server
}

func assemble(t *testing.T) bottle {
	t.Helper()
	target, err := portforward.NewServer()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, target.Close()) })
	controller, err := newController()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, controller.Close()) })
	plugin := &sdk.Plugin{Log: logging.NewNop()}
	require.NoError(t, register(plugin, controller, target))

	capability, ok := plugin.GetPluginMap()[networker.PluginID].(*networker.Plugin)
	require.True(t, ok)
	provider, ok := capability.Impl.(networker.ResourcePortForwardProvider)
	require.True(t, ok)
	_, err = controller.LoadConnections(t.Context())
	require.NoError(t, err)
	return bottle{controller: controller, provider: provider, target: target}
}

func (b bottle) context(t *testing.T) *types.PluginContext {
	t.Helper()
	return &types.PluginContext{Context: t.Context(), Connection: &types.Connection{ID: connectionID}}
}

// waitLimit bounds the reads of the connection to the forward, which take a few milliseconds: a regression that leaves one hanging is waited for this long before the test fails, and never otherwise (a test goes on when a
// call returns or a connection closes).
const waitLimit = 10 * time.Second

// start asks the plugin's networker for a forward on a local port it chooses. The SDK's manager finds that port by listening on port 0 and closing the listener, so another process can take it before the forwarder binds it: that
// start is asked again, a few times, when it failed because the address was in use (`bindretry.Until`), and any other failure is the test's at once, as it was.
func (b bottle) start(t *testing.T) *networker.PortForwardSession {
	t.Helper()
	session, err := bindretry.Until(func() (*networker.PortForwardSession, error) {
		return b.provider.StartResourcePortForwardSession(b.context(t), startOptions())
	})
	require.NoError(t, err)
	return session
}

func TestThePluginServesOneConnectionByItsKeyAndName(t *testing.T) {
	controller, err := newController()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, controller.Close()) })

	connections, err := controller.LoadConnections(t.Context())

	require.NoError(t, err)
	require.Len(t, connections, 1)
	require.Equal(t, "harbor-9c41e07ab2", connections[0].ID)
	require.Equal(t, "harbor", connections[0].Name)
}

func TestThePluginServesTheResourceAndTheNetworkerCapabilities(t *testing.T) {
	target, err := portforward.NewServer()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, target.Close()) })
	controller, err := newController()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, controller.Close()) })
	plugin := &sdk.Plugin{Log: logging.NewNop()}

	require.NoError(t, register(plugin, controller, target))

	capabilities := plugin.GetPluginMap()
	require.Contains(t, capabilities, "resource")
	require.Contains(t, capabilities, "networker")
}

func TestAForwardIsRefusedOnAConnectionThatIsNotStarted(t *testing.T) {
	b := assemble(t)

	_, err := b.provider.StartResourcePortForwardSession(b.context(t), startOptions())

	require.Error(t, err)
	require.Equal(t, "CONNECTION_ERROR", resourcev2.ErrorCode(err), "the host starts a connection before it routes a page to it; a deep link to one that is not started is refused here")
}

func TestAForwardOfAStartedConnectionReachesTheTargetAndEndsWithTheConnection(t *testing.T) {
	b := assemble(t)
	_, err := b.controller.StartConnection(t.Context(), connectionID)
	require.NoError(t, err)

	session := b.start(t)

	require.Equal(t, networker.SessionStateActive, session.State)
	require.NotZero(t, session.LocalPort)
	dialer := net.Dialer{Timeout: waitLimit}
	conn, err := dialer.DialContext(t.Context(), "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(int(session.LocalPort))))
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	require.NoError(t, conn.SetDeadline(time.Now().Add(waitLimit)))
	reader := bufio.NewReader(conn)
	greeting, err := reader.ReadString('\n')
	require.NoError(t, err, "the greeting of the target was not read through the forward")
	require.Equal(t, portforward.Greeting, greeting)

	// Stopping the connection retires what was started under it: the forward ends and the client that was connected is let go.
	_, err = b.controller.StopConnection(t.Context(), connectionID)
	require.NoError(t, err)
	rest, err := io.ReadAll(reader)
	require.NoError(t, err, "the client was not let go when the connection was stopped")
	require.Empty(t, rest)
}
