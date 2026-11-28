package mcprelay

import (
	"net"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/ownservers"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

func newOwnRelay(t *testing.T, address string) (*Relay, *ServiceWrapper) {
	t.Helper()
	relay := New(Options{Log: logging.NewNop(), Store: &memoryStore{}, Tools: &fakeTools{}, Connections: &fakeConnections{}, Version: "test", ShowConfirmation: func() error { return nil }})
	relay.listenAddr = address
	require.NoError(t, relay.loadConfig())
	t.Cleanup(relay.stopListener)
	return relay, &ServiceWrapper{Relay: relay}
}

// The relay is an own server of the host while it listens, and not while it is off or when it could not bind: a service of the user on the configured port is not the relay's.
func TestTheRelayIsAnOwnServerOnlyWhileItListens(t *testing.T) {
	_, service := newOwnRelay(t, "127.0.0.1:0")
	before := ownservers.Addresses()
	require.NoError(t, service.SetEnabled(true))
	status := service.GetStatus()
	require.True(t, status.Running, status.Error)
	endpoint, err := url.Parse(status.Endpoint)
	require.NoError(t, err)
	assert.Contains(t, ownservers.Addresses(), endpoint.Host)
	require.NoError(t, service.SetEnabled(false))
	assert.ElementsMatch(t, before, ownservers.Addresses())
}

func TestARelayThatCouldNotBindLeavesNoOwnServerAndAnotherServiceKeepsItsPort(t *testing.T) {
	user, err := new(net.ListenConfig).Listen(t.Context(), "tcp4", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = user.Close() })
	_, service := newOwnRelay(t, user.Addr().String())
	before := ownservers.Addresses()
	require.NoError(t, service.SetEnabled(true))
	assert.False(t, service.GetStatus().Running, "the control: the relay did not bind")
	assert.ElementsMatch(t, before, ownservers.Addresses())
}
