package plugin

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	v2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

func TestConnectionDependenciesRejectMissingExportAndCycles(t *testing.T) {
	pm := newTestManager(t)
	writeManifest := func(id, manifest string) {
		t.Helper()
		root := pm.pluginsRoot.ResolvePath(id)
		require.NoError(t, os.MkdirAll(root, 0755))
		require.NoError(t, os.WriteFile(filepath.Join(root, "plugin.yaml"), []byte(manifest), 0600))
	}
	consumer := config.PluginMeta{ID: "consumer", Capabilities: []string{"resource"}, Exports: &config.ExportsSpec{Connections: &config.ConnectionExport{Operations: []string{"catalog"}, ResourceTypes: []string{"flux/*"}}}, Requires: &config.RequiresSpec{Connections: []config.ConnectionRequirement{{Plugin: "owner", Operations: []string{"catalog"}, ResourceTypes: []string{"flux/*"}}}}}
	writeManifest("owner", "id: owner\ncapabilities: [resource]\n")
	require.Equal(t, "GRANT_DENIED", v2.ErrorCode(pm.validateDependencies(consumer)))
	writeManifest("consumer", "id: consumer\ncapabilities: [resource]\nexports:\n  connections:\n    operations: [catalog]\n    resource_types: [flux/*]\nrequires:\n  connections:\n    - plugin: owner\n      operations: [catalog]\n      resource_types: [flux/*]\n")
	writeManifest("owner", "id: owner\ncapabilities: [resource]\nexports:\n  connections:\n    operations: [catalog]\n    resource_types: [flux/*]\nrequires:\n  connections:\n    - plugin: consumer\n      operations: [catalog]\n      resource_types: [flux/*]\n")
	require.Equal(t, "GRANT_DENIED", v2.ErrorCode(pm.validateDependencies(consumer)))
	writeManifest("owner", "id: owner\ncapabilities: [resource]\nexports:\n  connections:\n    operations: [catalog]\n    resource_types: [flux/*]\n")
	require.NoError(t, pm.validateDependencies(consumer))
}

type dependencyTrackingController struct {
	trackingController
	dependencyStarts int
	promotions       int
}

func (c *dependencyTrackingController) OnPluginStartWithoutAutoConnect(string, config.PluginMeta, plugintypes.PluginBackend) error {
	c.dependencyStarts++
	return nil
}
func (c *dependencyTrackingController) PromoteDependencyStart(string) { c.promotions++ }

func TestDependencyOwnerPreservesStateAndNormalLoadPromotes(t *testing.T) {
	pm := newTestManager(t)
	pm.ctx = context.Background()
	pm.sharing = &sharingState{}
	owner := "owner"
	installPluginFixture(t, pm, owner, []string{"resource"}, true)
	manifest := "id: owner\ncapabilities: [resource]\nexports:\n  connections:\n    operations: [catalog]\n    resource_types: [flux/*]\n"
	require.NoError(t, os.WriteFile(filepath.Join(pm.pluginsRoot.ResolvePath(owner), "plugin.yaml"), []byte(manifest), 0600))
	source := t.TempDir()
	require.NoError(t, pm.writePluginStateRecords([]plugintypes.PluginStateRecord{{ID: owner, Enabled: true, DevMode: true, DevPath: source}}))
	ctrl := &dependencyTrackingController{}
	pm.connfullControllers[sdktypes.CapabilityResource] = ctrl
	pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) {
		return &capDetectingBackend{version: plugintypes.CurrentProtocolVersion, caps: []string{"resource"}}, nil
	}
	consumer := config.PluginMeta{ID: "flux", Requires: &config.RequiresSpec{Connections: []config.ConnectionRequirement{{
		Plugin: owner, Operations: []string{"catalog"}, ResourceTypes: []string{"flux/*"},
	}}}}
	require.NoError(t, pm.startRequiredOwners(consumer))
	require.True(t, pm.records[owner].DevMode)
	require.Equal(t, source, pm.records[owner].DevPath)
	require.Equal(t, 1, ctrl.dependencyStarts)
	require.Zero(t, ctrl.promotions)
	_, err := pm.LoadPlugin(owner, nil)
	require.NoError(t, err)
	require.Equal(t, 1, ctrl.promotions)
}
