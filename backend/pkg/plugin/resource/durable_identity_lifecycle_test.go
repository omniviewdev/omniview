package resource

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

// durableLifecycleFixture is the authority lifecycle fixture whose catalog also
// declares the environment its caller can currently read, as a plugin that reads
// facts about the target itself would. The caller's permissions can change.
type durableLifecycleFixture struct {
	*authorityLifecycleFixture
	environment atomic.Value
}

func newDurableLifecycleFixture(t *testing.T, store func(string) (*appstate.ScopedRoot, error), environment []resourcev2.EnvironmentIdentity) *durableLifecycleFixture {
	t.Helper()
	f := &durableLifecycleFixture{authorityLifecycleFixture: newAuthorityLifecycleFixture(t, store)}
	f.environment.Store(environment)
	f.provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog := bindingTestCatalog(t, f.epoch.Load().(string), "native", lifecycleClusterFact)
		catalog.Types[0].Environment, _ = f.environment.Load().([]resourcev2.EnvironmentIdentity)
		return catalog, nil
	}
	return f
}

// durable derives the durable identity of a resolved reference from the catalog
// the provider currently reports.
func (f *durableLifecycleFixture) durable(reference ResolvedReference) DurableIdentity {
	f.t.Helper()
	catalog, err := f.provider.Catalog(context.Background(), resourcev2.CatalogRequest{Route: resourcev2.AccessRoute{Connection: lifecycleRoute}})
	require.NoError(f.t, err)
	for _, descriptor := range catalog.Types {
		if descriptor.Type != reference.Reference.Address.Type {
			continue
		}
		identity, ok, err := durableIdentity(lifecyclePlugin, descriptor, reference.Reference)
		require.NoError(f.t, err)
		require.True(f.t, ok)
		return identity
	}
	f.t.Fatal("resolved reference names a type missing from the catalog")
	return DurableIdentity{}
}

// TestDurableIdentityOutlivesTheAuthorityLifecycle runs the lifecycle that
// TestAuthorityLifecycleCharacterization pins and shows the two identities part
// ways: the host-issued authority is retired exactly as before, and the durable
// identity stays equal for the same cluster, even as the caller's permissions
// narrow, and differs for another one.
func TestDurableIdentityOutlivesTheAuthorityLifecycle(t *testing.T) {
	f := newDurableLifecycleFixture(t, nil, hostEnvironment("cluster-uid-A", "ca-A"))
	_, err := f.ctrl.StartConnection(testInvocationContext(), lifecyclePlugin, lifecycleRoute)
	require.NoError(t, err)
	first := f.mustResolve()
	identity := f.durable(first)
	keys, err := identity.ObjectKey()
	require.NoError(t, err)
	same := func(step string, on *durableLifecycleFixture, reference ResolvedReference) {
		t.Helper()
		again := on.durable(reference)
		require.True(t, identity.SameObject(again), step)
		againKey, err := again.ObjectKey()
		require.NoError(t, err)
		require.Equal(t, keys, againKey, step)
	}
	retired := func(old ResolvedReference) {
		t.Helper()
		require.False(t, f.ctrl.finite.authorities[lifecyclePlugin].Matches(lifecyclePlugin, lifecycleRoute, old.Reference.Address.Provider, old.Reference.Address.Type, old.Reference.Address.Authority),
			"an equal durable identity must never revive a retired authority")
	}

	// A display-only edit keeps both identities.
	f.saveProfile("renamed", "A")
	renamed := f.mustResolve()
	require.Equal(t, first.AddressKey, renamed.AddressKey)
	same("display-only profile edit", f, renamed)

	// An endpoint edit retires the authority and not the durable identity, even
	// when the edited profile can read less of the cluster than before.
	f.environment.Store(hostEnvironment("", "ca-A"))
	f.saveProfile("renamed", "B")
	edited := f.mustResolve()
	require.NotEqual(t, first.AddressKey, edited.AddressKey)
	retired(first)
	same("endpoint edit that narrows permissions", f, edited)

	// Stop retires the authority on its own; start gives the client a new epoch.
	_, err = f.ctrl.StopConnection(testInvocationContext(), lifecyclePlugin, lifecycleRoute)
	require.NoError(t, err)
	stopped := f.mustResolve()
	require.NotEqual(t, edited.AddressKey, stopped.AddressKey)
	retired(edited)
	same("stop", f, stopped)
	_, err = f.ctrl.StartConnection(testInvocationContext(), lifecyclePlugin, lifecycleRoute)
	require.NoError(t, err)
	started := f.mustResolve()
	require.NotEqual(t, stopped.AddressKey, started.AddressKey)
	retired(stopped)
	same("start", f, started)

	// A restarted host reads the persisted binding, retires it, and issues another.
	restarted := newDurableLifecycleFixture(t, f.ctrl.pluginStoreFn, hostEnvironment("cluster-uid-A", ""))
	_, err = restarted.resolve()
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	afterRestart := restarted.mustResolve()
	require.NotEqual(t, started.AddressKey, afterRestart.AddressKey)
	same("restart", restarted, afterRestart)

	// The same names on another cluster are another identity, in a store of their own.
	other := newDurableLifecycleFixture(t, nil, hostEnvironment("cluster-uid-B", "ca-B"))
	_, err = other.ctrl.StartConnection(testInvocationContext(), lifecyclePlugin, lifecycleRoute)
	require.NoError(t, err)
	otherIdentity := other.durable(other.mustResolve())
	require.Equal(t, identity.Reference.Address, otherIdentity.Reference.Address, "only the cluster differs")
	require.False(t, identity.SameObject(otherIdentity))

	// A second cluster behind the same CA is told apart by its exclusive UID.
	shared := newDurableLifecycleFixture(t, nil, hostEnvironment("cluster-uid-B", "ca-A"))
	_, err = shared.ctrl.StartConnection(testInvocationContext(), lifecyclePlugin, lifecycleRoute)
	require.NoError(t, err)
	require.False(t, identity.SameObject(shared.durable(shared.mustResolve())))
}
