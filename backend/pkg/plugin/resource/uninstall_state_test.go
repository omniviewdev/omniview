package resource

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// The controller keeps one authority resolver per plugin, and the resolver
// keeps the store root it was built on. An uninstall deletes the store
// directory, and appstate closes the root of a directory that is gone, so a
// plugin installed again under the same ID needs a resolver on its new
// directory, not one that writes through the old root.
//
// The two services stand for the plugin's store before the uninstall and the
// store of the installation that follows it: closing the first is what appstate
// does to the root of a deleted directory.
func TestOnPluginUninstalledLetsAReinstalledPluginPersistAuthorities(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	before, after := appstate.NewTestService(t), appstate.NewTestService(t)
	current := before
	ctrl.pluginStoreFn = func(pluginID string) (*appstate.ScopedRoot, error) { return current.PluginStore(pluginID) }
	catalog := bindingTestCatalog(t, bindingTestEpoch(t), "native", "hintA")
	provider := &bindingTestProvider{mockProvider: &mockProvider{}, catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		return catalog, nil
	}}
	registerMockPlugin(ctrl, "p1", provider)
	request := bindingTestRequest()
	_, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	require.Contains(t, ctrl.finite.authorities, "p1", "precondition: the controller keeps a resolver for the plugin")
	require.FileExists(t, filepath.Join(before.Root(), "plugins", "p1", "store", authorityStoreName))

	// Uninstall: the store root of the deleted directory is closed, and the
	// controller is told once the uninstall is durable.
	require.NoError(t, before.Close())
	current = after
	require.NoError(t, ctrl.OnPluginUninstalled("p1"))
	assert.NotContains(t, ctrl.finite.authorities, "p1")

	// Reinstall under the same ID: a new generation on a new, empty store.
	registerMockPlugin(ctrl, "p1", provider)
	reinstalled, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err, "the authorities of the new installation persist to its own store")
	assert.NotEmpty(t, authorityDiskBytes(t, ctrl))
	newStore, err := after.PluginStore("p1")
	require.NoError(t, err)
	restarted, err := NewAuthorityResolver(newStore)
	require.NoError(t, err)
	assert.True(t, restarted.Matches("p1", request.Route.Connection, "native", "objects", reinstalled.Target.Authority))
}

func TestOnPluginUninstalledForUnknownPluginChangesNothing(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := bindingTestCatalog(t, bindingTestEpoch(t), "native", "hintA")
	registerMockPlugin(ctrl, "p1", &bindingTestProvider{mockProvider: &mockProvider{}, catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		return catalog, nil
	}})
	_, err := ctrl.ResolveTarget(testInvocationContext(), "p1", bindingTestRequest())
	require.NoError(t, err)

	require.NoError(t, ctrl.OnPluginUninstalled("never-installed"))

	assert.Contains(t, ctrl.finite.authorities, "p1", "another plugin's resolver is never dropped")
}
