package mcprelay

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"slices"
	"testing"
	"time"

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

// The address stays an own server until the drain has ended: the server may still answer a request that was open when the relay was switched off.
func TestTheRelayStaysAnOwnServerWhileItDrains(t *testing.T) {
	relay, service := newOwnRelay(t, "127.0.0.1:0")
	require.NoError(t, service.SetEnabled(true))
	endpoint, err := url.Parse(service.GetStatus().Endpoint)
	require.NoError(t, err)
	var listedWhileDraining bool
	relay.drain = func(ctx context.Context, server *http.Server, closeSessions func()) error {
		listedWhileDraining = slices.Contains(ownservers.Addresses(), endpoint.Host)
		return drainHTTPServer(ctx, server, closeSessions)
	}
	require.NoError(t, service.SetEnabled(false))
	assert.True(t, listedWhileDraining, "the address is listed while the server drains")
	assert.NotContains(t, ownservers.Addresses(), endpoint.Host, "and gone when it has")
}

// A relay whose server stopped by itself (the serve loop failed) no longer answers: its address is not an own server.
func TestARelayWhoseServeLoopFailedIsNoLongerAnOwnServer(t *testing.T) {
	relay, service := newOwnRelay(t, "127.0.0.1:0")
	require.NoError(t, service.SetEnabled(true))
	endpoint, err := url.Parse(service.GetStatus().Endpoint)
	require.NoError(t, err)
	require.Contains(t, ownservers.Addresses(), endpoint.Host, "the control: it is listed while it serves")
	relay.mu.Lock()
	broken := relay.listener
	relay.mu.Unlock()
	require.NoError(t, broken.Close()) // the loop's accept fails, as it does when the listener is taken from under it
	require.Eventually(t, func() bool { return !service.GetStatus().Running }, 30*time.Second, time.Millisecond, "the relay saw the failure")
	assert.NotContains(t, ownservers.Addresses(), endpoint.Host)
}
