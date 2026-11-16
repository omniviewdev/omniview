package resource

import (
	"context"
	"testing"

	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

// newDurableLifecycleFixture is the authority lifecycle fixture whose catalog
// also declares the durable environment of its cluster, as a plugin that reads a
// fact about the target itself would.
func newDurableLifecycleFixture(t *testing.T, store func(string) (*appstate.ScopedRoot, error), cluster string) *authorityLifecycleFixture {
	t.Helper()
	f := newAuthorityLifecycleFixture(t, store)
	f.provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog := bindingTestCatalog(t, f.epoch.Load().(string), "native", lifecycleClusterFact)
		catalog.Types[0].Environment = &resourcev2.EnvironmentIdentity{Scheme: "fixture.cluster-uid.v1", ID: cluster}
		return catalog, nil
	}
	return f
}

// durable derives the durable identity of a resolved reference from the catalog
// the provider currently reports.
func (f *authorityLifecycleFixture) durable(reference ResolvedReference) (DurableIdentity, string) {
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
		key, err := identity.Key()
		require.NoError(f.t, err)
		return identity, key
	}
	f.t.Fatal("resolved reference names a type missing from the catalog")
	return DurableIdentity{}, ""
}

// TestDurableIdentityOutlivesTheAuthorityLifecycle runs the lifecycle that
// TestAuthorityLifecycleCharacterization pins and shows the two identities part
// ways: the host-issued authority is retired exactly as before, and the durable
// identity stays equal for the same cluster and differs for another one.
func TestDurableIdentityOutlivesTheAuthorityLifecycle(t *testing.T) {
	f := newDurableLifecycleFixture(t, nil, "cluster-uid-A")
	_, err := f.ctrl.StartConnection(testInvocationContext(), lifecyclePlugin, lifecycleRoute)
	require.NoError(t, err)
	first := f.mustResolve()
	identity, key := f.durable(first)
	sameIdentity := func(step string, on *authorityLifecycleFixture, reference ResolvedReference) {
		t.Helper()
		again, againKey := on.durable(reference)
		require.Equal(t, identity, again, step)
		require.Equal(t, key, againKey, step)
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
	sameIdentity("display-only profile edit", f, renamed)

	// An endpoint edit retires the authority and not the durable identity.
	f.saveProfile("renamed", "B")
	edited := f.mustResolve()
	require.NotEqual(t, first.AddressKey, edited.AddressKey)
	retired(first)
	sameIdentity("endpoint edit", f, edited)

	// Stop retires the authority on its own; start gives the client a new epoch.
	_, err = f.ctrl.StopConnection(testInvocationContext(), lifecyclePlugin, lifecycleRoute)
	require.NoError(t, err)
	stopped := f.mustResolve()
	require.NotEqual(t, edited.AddressKey, stopped.AddressKey)
	retired(edited)
	sameIdentity("stop", f, stopped)
	_, err = f.ctrl.StartConnection(testInvocationContext(), lifecyclePlugin, lifecycleRoute)
	require.NoError(t, err)
	started := f.mustResolve()
	require.NotEqual(t, stopped.AddressKey, started.AddressKey)
	retired(stopped)
	sameIdentity("start", f, started)

	// A restarted host reads the persisted binding, retires it, and issues another.
	restarted := newDurableLifecycleFixture(t, f.ctrl.pluginStoreFn, "cluster-uid-A")
	_, err = restarted.resolve()
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	afterRestart := restarted.mustResolve()
	require.NotEqual(t, started.AddressKey, afterRestart.AddressKey)
	sameIdentity("restart", restarted, afterRestart)

	// The same names on another cluster are another identity, in a store of their own.
	other := newDurableLifecycleFixture(t, nil, "cluster-uid-B")
	_, err = other.ctrl.StartConnection(testInvocationContext(), lifecyclePlugin, lifecycleRoute)
	require.NoError(t, err)
	otherReference := other.mustResolve()
	otherIdentity, otherKey := other.durable(otherReference)
	require.Equal(t, identity.Reference.Address.Type, otherIdentity.Reference.Address.Type)
	require.Equal(t, identity.Reference.Address.ID, otherIdentity.Reference.Address.ID)
	require.NotEqual(t, identity.Reference.Address.Environment, otherIdentity.Reference.Address.Environment)
	require.NotEqual(t, key, otherKey)
}
