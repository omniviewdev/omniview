package resource

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"

	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

const (
	lifecyclePlugin = "p1"
	lifecycleRoute  = "binding-route"
	// lifecycleClusterFact stands in for a fact about the target itself (for
	// Kubernetes, the kube-system namespace UID). It never changes in these tests.
	lifecycleClusterFact = "cluster-uid-A"
)

// authorityLifecycleFixture drives the real controller through connection
// stop/start, profile edits and a host restart. Its provider behaves like an SDK
// controller: every started native client owns a fresh catalog binding epoch,
// while the target behind the route never changes.
type authorityLifecycleFixture struct {
	t        *testing.T
	ctrl     *controller
	provider *mockProvider
	epoch    atomic.Value
}

// newAuthorityLifecycleFixture builds a controller and a plugin. A non-nil store
// makes the controller reuse that persisted plugin state, as a restarted host does.
func newAuthorityLifecycleFixture(t *testing.T, store func(string) (*appstate.ScopedRoot, error)) *authorityLifecycleFixture {
	t.Helper()
	ctrl, _ := newTestControllerWithEmitter(t)
	if store != nil {
		ctrl.pluginStoreFn = store
	}
	f := &authorityLifecycleFixture{t: t, ctrl: ctrl}
	f.epoch.Store(bindingTestEpoch(t))
	connection := types.Connection{ID: lifecycleRoute, Name: lifecycleRoute, Data: map[string]any{"endpoint": "A"}}
	f.provider = connectionOverlayTestProvider(connection)
	f.provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		return bindingTestCatalog(t, f.epoch.Load().(string), "native", lifecycleClusterFact), nil
	}
	f.provider.StartConnectionFunc = func(context.Context, string) (types.ConnectionStatus, error) {
		f.rotateNativeClient()
		return types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &connection}, nil
	}
	f.provider.StopConnectionFunc = func(context.Context, string) (types.Connection, error) {
		return connection, nil
	}
	registerMockPlugin(ctrl, lifecyclePlugin, f.provider)
	_, err := ctrl.replayConnectionProfiles(testInvocationContext(), lifecyclePlugin, []types.Connection{connection})
	require.NoError(t, err)
	return f
}

// rotateNativeClient models the SDK creating a new client, and so a new binding
// epoch, for the same cluster.
func (f *authorityLifecycleFixture) rotateNativeClient() { f.epoch.Store(bindingTestEpoch(f.t)) }

func (f *authorityLifecycleFixture) resolve() (ResolvedReference, error) {
	return f.ctrl.ResolveReference(testInvocationContext(), lifecyclePlugin, ResolveReferenceRequest{
		Route: resourcev2.AccessRoute{Connection: lifecycleRoute}, Type: "objects", Scope: []resourcev2.ScopeEntry{}, ID: "record", Representation: "native",
	})
}

func (f *authorityLifecycleFixture) mustResolve() ResolvedReference {
	f.t.Helper()
	reference, err := f.resolve()
	require.NoError(f.t, err)
	return reference
}

// persisted returns the authorities the store holds for the route, read from disk.
func (f *authorityLifecycleFixture) persisted() []string {
	f.t.Helper()
	var entries []authorityDiskEntry
	require.NoError(f.t, json.Unmarshal(authorityDiskBytes(f.t, f.ctrl), &entries))
	var authorities []string
	for _, entry := range entries {
		if entry.Plugin == lifecyclePlugin && entry.Connection == lifecycleRoute {
			authorities = append(authorities, entry.Authority)
		}
	}
	return authorities
}

func (f *authorityLifecycleFixture) saveProfile(name, endpoint string) {
	f.t.Helper()
	connection := types.Connection{ID: lifecycleRoute, Name: name, Data: map[string]any{"endpoint": endpoint}}
	result, err := f.ctrl.SaveConnectionProfile(testInvocationContext(), lifecyclePlugin, connection, nil)
	require.NoError(f.t, err)
	require.True(f.t, result.Applied)
}

// TestAuthorityLifecycleCharacterization pins when the host-issued authority,
// and therefore the canonical address key, changes for one unchanged target. It
// records current behaviour that the durable-identity work must leave alone.
func TestAuthorityLifecycleCharacterization(t *testing.T) {
	f := newAuthorityLifecycleFixture(t, nil)
	_, err := f.ctrl.StartConnection(testInvocationContext(), lifecyclePlugin, lifecycleRoute)
	require.NoError(t, err)
	first := f.mustResolve()
	require.True(t, f.ctrl.finite.authorities[lifecyclePlugin].Matches(lifecyclePlugin, lifecycleRoute, first.Reference.Address.Provider, "objects", first.Reference.Address.Authority))
	require.Equal(t, []string{first.Reference.Address.Authority}, f.persisted(), "the binding is created and persisted by the first catalog observation")

	// A display-only profile edit blocks transient publication but keeps the binding.
	f.saveProfile("renamed", "A")
	renamed := f.mustResolve()
	require.Equal(t, first.AddressKey, renamed.AddressKey, "a display-only profile edit keeps the canonical key")
	require.Equal(t, []string{first.Reference.Address.Authority}, f.persisted())

	// An endpoint edit changes the client configuration: the persisted binding is
	// deleted by the edit itself, before any later observation can issue another.
	f.saveProfile("renamed", "B")
	require.Empty(t, f.persisted(), "an endpoint or credential edit deletes the persisted binding")
	edited := f.mustResolve()
	require.NotEqual(t, first.AddressKey, edited.AddressKey, "the next observation issues a fresh authority")
	require.False(t, f.ctrl.finite.authorities[lifecyclePlugin].Matches(lifecyclePlugin, lifecycleRoute, first.Reference.Address.Provider, "objects", first.Reference.Address.Authority))

	// Stopping deletes the binding even though the native client generation that
	// the catalog reports has not changed yet.
	_, err = f.ctrl.StopConnection(testInvocationContext(), lifecyclePlugin, lifecycleRoute)
	require.NoError(t, err)
	require.Empty(t, f.persisted(), "stop deletes the persisted binding")
	unchangedClient := f.mustResolve()
	require.NotEqual(t, edited.AddressKey, unchangedClient.AddressKey, "stop alone is enough to change the canonical key")

	// Starting creates a new native client, so the catalog reports a new binding
	// epoch and the connection-start admission retires the binding once more.
	_, err = f.ctrl.StartConnection(testInvocationContext(), lifecyclePlugin, lifecycleRoute)
	require.NoError(t, err)
	restartedConnection := f.mustResolve()
	require.NotEqual(t, unchangedClient.AddressKey, restartedConnection.AddressKey)

	// A host restart keeps the persisted binding but no admission state: the first
	// fenced catalog observation retires it and demands a fresh catalog.
	require.Len(t, f.persisted(), 1)
	restarted := newAuthorityLifecycleFixture(t, f.ctrl.pluginStoreFn)
	require.Len(t, restarted.persisted(), 1, "the new process sees the old binding on disk")
	_, err = restarted.resolve()
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err), "the first observation after a restart retires the persisted binding")
	require.Empty(t, restarted.persisted())
	afterRestart := restarted.mustResolve()
	require.NotEqual(t, restartedConnection.AddressKey, afterRestart.AddressKey)
}
