package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

func catalogManager(t *testing.T, entries []CatalogEntry) *pluginManager {
	t.Helper()
	catalog, err := NewCatalog(entries)
	require.NoError(t, err)
	roots := appstate.NewTestService(t)
	return NewManager(testLogger(t), roots.RootDir(), roots.Plugins(), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, catalog).(*pluginManager)
}

func TestBuiltinOfflineDiscoveryPreferenceAndLifetime(t *testing.T) {
	starts, stops := 0, 0
	var done chan struct{}
	entry := CatalogEntry{Metadata: config.PluginMeta{ID: "native", Name: "Native", Version: "1.0.0", Capabilities: []string{"resource"}}, NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
		starts++
		reader, writer := io.Pipe()
		generationDone := make(chan struct{})
		done = generationDone
		go func() {
			_, _ = io.Copy(io.Discard, reader)
			close(generationDone)
		}()
		return plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Shutdown: func() error { stops++; return errors.Join(writer.Close(), reader.Close()) }}), nil
	}}
	pm := catalogManager(t, []CatalogEntry{entry})
	require.NoError(t, pm.Initialize(context.Background()))
	info, err := pm.GetPlugin("native")
	require.NoError(t, err)
	require.Equal(t, "builtin", info.Origin)
	require.Equal(t, string(lifecycle.PhaseInstalled), info.Phase)
	require.Zero(t, starts)
	_, err = pm.LoadPlugin("native", nil)
	require.NoError(t, err)
	require.Equal(t, 1, starts)
	_, err = pm.ReloadPlugin("native")
	require.NoError(t, err)
	require.Equal(t, 2, starts)
	require.Equal(t, 1, stops)
	_, err = pm.SetPluginEnabled("native", false)
	require.NoError(t, err)
	<-done
	require.Equal(t, 2, stops)
	_, err = pm.LoadPlugin("native", nil)
	require.ErrorContains(t, err, "disabled")
	require.NoError(t, pm.Initialize(context.Background()))
	info, err = pm.GetPlugin("native")
	require.NoError(t, err)
	require.False(t, info.Enabled)
	_, err = pm.SetPluginEnabled("native", true)
	require.NoError(t, err)
	require.Equal(t, 2, starts, "enable must not activate backend")
}

func TestConcurrentBuiltinPreferencesRemainDurable(t *testing.T) {
	pm := catalogManager(t, []CatalogEntry{
		{Metadata: config.PluginMeta{ID: "first", Version: "1.0.0", Capabilities: []string{"ui"}}, FrontendModule: "first"},
		{Metadata: config.PluginMeta{ID: "second", Version: "1.0.0", Capabilities: []string{"ui"}}, FrontendModule: "second"},
	})
	require.NoError(t, pm.Initialize(context.Background()))
	for round := range 16 {
		enabled := round%2 != 0
		start := make(chan struct{})
		results := make(chan error, 2)
		for _, id := range []string{"first", "second"} {
			go func() {
				<-start
				_, err := pm.SetPluginEnabled(id, enabled)
				results <- err
			}()
		}
		close(start)
		for range 2 {
			require.NoError(t, <-results)
		}
		data, err := pm.stateRoot.ReadFile(stateFileName)
		require.NoError(t, err)
		var records []plugintypes.PluginStateRecord
		require.NoError(t, json.Unmarshal(data, &records))
		preferences := make(map[string]bool, len(records))
		for _, record := range records {
			preferences[record.ID] = record.Enabled
		}
		require.Equal(t, map[string]bool{"first": enabled, "second": enabled}, preferences)
	}
}

func TestBuiltinCollisionAndReplacementNeverMutateExternalFiles(t *testing.T) {
	entry := CatalogEntry{Metadata: config.PluginMeta{ID: "owned", Version: "1.0.0", Capabilities: []string{"ui"}}, FrontendModule: "owned"}
	pm := catalogManager(t, []CatalogEntry{entry})
	require.NoError(t, pm.pluginsRoot.MkdirAll("owned", 0755))
	require.NoError(t, pm.pluginsRoot.WriteFile("owned/user-data", []byte("keep"), 0600))
	installPluginFixture(t, pm, "unrelated", []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll("unrelated/assets", 0755))
	installPluginFixture(t, pm, "pending", []string{"ui"}, false)
	pendingRecord := plugintypes.NewPluginRecord("pending", config.PluginMeta{ID: "pending", Version: "1.0.0", Capabilities: []string{"ui"}}, lifecycle.PhaseInstalled)
	recovery, err := pm.prepareUninstallRecovery("pending", pendingRecord)
	require.NoError(t, err)
	require.NotNil(t, recovery)
	emitter := &testRecordingEmitter{}
	pm.emitter = emitter
	require.ErrorContains(t, pm.Initialize(context.Background()), "collides")
	info, err := pm.GetPlugin("owned")
	require.NoError(t, err)
	require.Equal(t, "builtin", info.Origin)
	require.Equal(t, entry.Metadata.Version, info.Metadata.Version)
	require.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
	require.Contains(t, info.LastError, "collides")
	_, err = pm.LoadPlugin("owned", nil)
	require.ErrorContains(t, err, "collides", "activation must stay blocked while external files remain")
	unrelated, err := pm.GetPlugin("unrelated")
	require.NoError(t, err)
	require.Equal(t, string(lifecycle.PhaseRunning), unrelated.Phase)
	pending, err := pm.GetPlugin("pending")
	require.NoError(t, err)
	require.Equal(t, string(lifecycle.PhaseFailed), pending.Phase)
	require.Contains(t, pending.LastError, pm.pluginsRoot.ResolvePath(recovery.Stage))
	require.Contains(t, emitter.getEvents(), testEmittedEvent{event: EventInitComplete})
	_, err = pm.UninstallPlugin("owned")
	require.ErrorContains(t, err, "built into")
	_, err = pm.InstallPluginVersion("owned", "2.0.0")
	require.ErrorContains(t, err, "built into")
	_, err = pm.UnlinkDevPlugin("owned")
	require.ErrorContains(t, err, "built into")
	data, err := os.ReadFile(pm.pluginsRoot.ResolvePath("owned/user-data"))
	require.NoError(t, err)
	require.Equal(t, "keep", string(data))
	require.NoError(t, pm.pluginsRoot.RemoveAll("owned"))
	info, err = pm.LoadPlugin("owned", nil)
	require.NoError(t, err, "explicitly resolving the collision must permit activation")
	require.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
}

func TestBuiltinPendingUninstallPreservesCatalogAndUnrelatedStartup(t *testing.T) {
	for _, scenario := range []string{"canonical", "staged", "invalid"} {
		t.Run(scenario, func(t *testing.T) {
			entry := CatalogEntry{Metadata: config.PluginMeta{
				ID: "owned", Name: "Trusted built-in", Version: "1.0.0", Capabilities: []string{"ui"},
			}, FrontendModule: "trusted-module"}
			pm := catalogManager(t, []CatalogEntry{entry})
			installPluginFixture(t, pm, "owned", []string{"ui"}, false)
			installPluginFixture(t, pm, "unrelated", []string{"ui"}, false)
			require.NoError(t, pm.pluginsRoot.MkdirAll("unrelated/assets", 0755))
			require.NoError(t, pm.pluginsRoot.WriteFile("owned/user-data", []byte("keep external files"), 0600))
			external := plugintypes.NewPluginRecord("owned", config.PluginMeta{
				ID: "owned", Name: "External installation", Version: "9.0.0", Capabilities: []string{"ui"},
			}, lifecycle.PhaseInstalled)
			external.Enabled, external.DevMode, external.DevPath = false, true, "/external/source"
			recovery, err := pm.prepareUninstallRecovery("owned", external)
			require.NoError(t, err)
			require.NotNil(t, recovery)
			asset := "owned/user-data"
			if scenario != "canonical" {
				require.NoError(t, pm.pluginsRoot.Rename("owned", filepath.Join(recovery.Stage, "plugin")))
				asset = filepath.Join(recovery.Stage, "plugin/user-data")
			}
			markerName := uninstallRecoveryName("owned")
			if scenario == "invalid" {
				require.NoError(t, pm.stateRoot.WriteFile(markerName, []byte("invalid recovery evidence"), 0600))
			}
			marker, err := pm.stateRoot.ReadFile(markerName)
			require.NoError(t, err)
			emitter := &testRecordingEmitter{}
			pm.emitter = emitter

			err = pm.Initialize(context.Background())
			if scenario == "canonical" {
				require.ErrorContains(t, err, "collides")
			} else {
				require.NoError(t, err)
			}
			info, err := pm.GetPlugin("owned")
			require.NoError(t, err)
			require.Equal(t, "builtin", info.Origin)
			require.Equal(t, entry.Metadata, info.Metadata)
			require.Equal(t, entry.FrontendModule, info.FrontendModule)
			require.True(t, info.Enabled, "external recovery must not replace the built-in preference")
			require.False(t, info.DevMode)
			require.Empty(t, info.DevPath)
			require.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
			require.Contains(t, info.LastError, "pending uninstall")
			require.Contains(t, info.LastError, "remove or relocate external recovery explicitly")
			if scenario == "invalid" {
				require.Contains(t, info.LastError, pm.stateRoot.ResolvePath(markerName))
				require.Contains(t, info.LastError, "cannot validate pending uninstall")
			} else {
				require.Contains(t, info.LastError, pm.pluginsRoot.ResolvePath(recovery.Stage))
			}
			unrelated, err := pm.GetPlugin("unrelated")
			require.NoError(t, err)
			require.Equal(t, string(lifecycle.PhaseRunning), unrelated.Phase)
			require.Contains(t, emitter.getEvents(), testEmittedEvent{event: EventInitComplete})
			_, err = pm.LoadPlugin("owned", nil)
			require.Error(t, err, "pending recovery must still block activation")
			_, err = pm.UninstallPlugin("owned")
			require.ErrorContains(t, err, "built into")
			after, err := pm.stateRoot.ReadFile(markerName)
			require.NoError(t, err)
			require.Equal(t, marker, after, "startup and guarded actions must preserve recovery evidence")
			data, err := pm.pluginsRoot.ReadFile(asset)
			require.NoError(t, err)
			require.Equal(t, "keep external files", string(data))
			require.DirExists(t, pm.pluginsRoot.ResolvePath(recovery.Stage))
			if scenario != "canonical" {
				require.NoError(t, pm.stateRoot.Rename(markerName, markerName+".retained"))
				info, err = pm.LoadPlugin("owned", nil)
				require.NoError(t, err, "explicitly relocating the pending evidence must permit activation")
				require.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
				retained, err := pm.stateRoot.ReadFile(markerName + ".retained")
				require.NoError(t, err)
				require.Equal(t, marker, retained)
				require.DirExists(t, pm.pluginsRoot.ResolvePath(recovery.Stage))
			}
		})
	}
}

func TestBuiltinFailedFactoryRemainsVisibleAndRetriesFresh(t *testing.T) {
	attempts := 0
	entry := CatalogEntry{Metadata: config.PluginMeta{ID: "native", Version: "1.0.0", Capabilities: []string{"resource"}}, NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
		attempts++
		if attempts == 1 {
			return nil, errors.New("native client initialization failed")
		}
		return plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{}), nil
	}}
	pm := catalogManager(t, []CatalogEntry{entry})
	require.NoError(t, pm.Initialize(context.Background()))
	_, err := pm.LoadPlugin("native", nil)
	require.ErrorContains(t, err, "native client initialization failed")
	info, err := pm.GetPlugin("native")
	require.NoError(t, err)
	require.Equal(t, "builtin", info.Origin)
	require.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
	_, err = pm.RetryFailedPlugin("native")
	require.NoError(t, err)
	require.Equal(t, 2, attempts)
	require.NoError(t, pm.UnloadPlugin("native"))
}

func TestCatalogRejectsDuplicateAndMissingComposition(t *testing.T) {
	entry := CatalogEntry{Metadata: config.PluginMeta{ID: "native", Version: "1.0.0", Capabilities: []string{"resource"}}}
	_, err := NewCatalog([]CatalogEntry{entry})
	require.ErrorContains(t, err, "factory")
	entry.Metadata.Capabilities = []string{"ui"}
	_, err = NewCatalog([]CatalogEntry{entry})
	require.ErrorContains(t, err, "frontend module")
	entry.FrontendModule = "native"
	_, err = NewCatalog([]CatalogEntry{entry, entry})
	require.ErrorContains(t, err, "duplicate")
}

func TestBuiltinShutdownErrorRetainsTruthfulInventory(t *testing.T) {
	stops := 0
	pm := catalogManager(t, []CatalogEntry{{
		Metadata: config.PluginMeta{ID: "native", Version: "1.0.0", Capabilities: []string{"resource"}},
		NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
			return plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Shutdown: func() error {
				stops++
				return errors.New("shared native client close failed")
			}}), nil
		},
	}})
	require.NoError(t, pm.Initialize(context.Background()))
	_, err := pm.LoadPlugin("native", nil)
	require.NoError(t, err)
	_, err = pm.SetPluginEnabled("native", false)
	require.ErrorContains(t, err, "shared native client close failed")
	info, err := pm.GetPlugin("native")
	require.NoError(t, err)
	require.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
	require.False(t, info.Enabled)
	require.Contains(t, info.LastError, "shared native client close failed")
	require.Equal(t, 1, stops)
	require.Nil(t, pm.records["native"].Backend)
}

func TestBuiltinArchiveReplacementRejectsBeforeStaging(t *testing.T) {
	pm := catalogManager(t, []CatalogEntry{{Metadata: config.PluginMeta{ID: "owned", Version: "1.0.0"}}})
	before, err := pm.pluginsRoot.ReadDir(".")
	require.NoError(t, err)
	published, err := pm.installArchiveCandidate("does-not-exist.tar.gz", &config.PluginMeta{ID: "owned"}, "1.0.0")
	require.ErrorContains(t, err, "built into")
	require.False(t, published)
	after, err := pm.pluginsRoot.ReadDir(".")
	require.NoError(t, err)
	require.Len(t, after, len(before))
}

type failingRetirementController struct {
	trackingController
	retire func() error
}

func (controller *failingRetirementController) OnPluginShutdown(string, config.PluginMeta) error {
	return controller.retire()
}

func TestBuiltinCleanupFailureDrainsControllersBeforeAggregate(t *testing.T) {
	retired := false
	reader, writer := io.Pipe()
	drained := make(chan struct{})
	go func() {
		_, _ = io.Copy(io.Discard, reader)
		close(drained)
	}()
	pm := catalogManager(t, []CatalogEntry{{
		Metadata: config.PluginMeta{ID: "native", Version: "1.0.0", Capabilities: []string{"resource"}},
		NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
			return plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Shutdown: func() error {
				require.True(t, retired, "resource admission must retire before aggregate clients")
				return errors.Join(writer.Close(), reader.Close())
			}}), nil
		},
	}})
	pm.connfullControllers["resource"] = &failingRetirementController{retire: func() error {
		retired = true
		return errors.New("resource retirement failed")
	}}
	require.NoError(t, pm.Initialize(context.Background()))
	_, err := pm.LoadPlugin("native", nil)
	require.NoError(t, err)
	require.ErrorContains(t, pm.UnloadPlugin("native"), "resource retirement failed")
	<-drained
	info, err := pm.GetPlugin("native")
	require.NoError(t, err)
	require.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
	require.Nil(t, pm.records["native"].Backend)
}

func TestBuiltinPreferenceWriteFailureLeavesRunningLifetime(t *testing.T) {
	stops := 0
	pm := catalogManager(t, []CatalogEntry{{
		Metadata: config.PluginMeta{ID: "native", Version: "1.0.0", Capabilities: []string{"resource"}},
		NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
			return plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Shutdown: func() error {
				stops++
				return nil
			}}), nil
		},
	}})
	require.NoError(t, pm.Initialize(context.Background()))
	_, err := pm.LoadPlugin("native", nil)
	require.NoError(t, err)
	require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0700))
	_, err = pm.SetPluginEnabled("native", false)
	require.Error(t, err)
	info, err := pm.GetPlugin("native")
	require.NoError(t, err)
	require.True(t, info.Enabled)
	require.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
	require.Zero(t, stops)
	require.NoError(t, pm.UnloadPlugin("native"))
}

func TestCatalogSnapshotsNestedMetadataWithoutDroppingMarkdown(t *testing.T) {
	entry := CatalogEntry{Metadata: config.PluginMeta{
		ID: "owned", Version: "1.0.0", Markdown: "Host documentation",
		Author:       &config.PluginAuthor{Name: "Host"},
		Capabilities: []string{"ui"},
		Components:   config.PluginComponents{Resource: []config.PluginResourceComponent{{Resources: []string{"original"}}}},
		Exports: &config.ExportsSpec{Connections: &config.ConnectionExport{
			Operations: []string{"get"}, ResourceTypes: []string{"apps/*"},
		}},
		Requires: &config.RequiresSpec{Connections: []config.ConnectionRequirement{{
			Plugin: "owner", Operations: []string{"catalog"}, ResourceTypes: []string{"apps/*"},
		}}},
	}, FrontendModule: "owned"}
	pm := catalogManager(t, []CatalogEntry{entry})
	entry.Metadata.Capabilities[0] = "resource"
	entry.Metadata.Author.Name = "Untrusted mutation"
	entry.Metadata.Components.Resource[0].Resources[0] = "changed"
	entry.Metadata.Exports.Connections.Operations[0] = "update"
	entry.Metadata.Exports.Connections.ResourceTypes[0] = "secrets/*"
	entry.Metadata.Requires.Connections[0].Plugin = "other"
	entry.Metadata.Requires.Connections[0].Operations[0] = "update"
	entry.Metadata.Requires.Connections[0].ResourceTypes[0] = "secrets/*"
	require.NoError(t, pm.Initialize(context.Background()))
	info, err := pm.GetPlugin("owned")
	require.NoError(t, err)
	require.Equal(t, "Host documentation", info.Metadata.Markdown)
	require.Equal(t, "Host", info.Metadata.Author.Name)
	require.Equal(t, []string{"ui"}, info.Metadata.Capabilities)
	require.Equal(t, []string{"original"}, info.Metadata.Components.Resource[0].Resources)
	require.Equal(t, []string{"get"}, info.Metadata.Exports.Connections.Operations)
	require.Equal(t, []string{"apps/*"}, info.Metadata.Exports.Connections.ResourceTypes)
	require.Equal(t, "owner", info.Metadata.Requires.Connections[0].Plugin)
	require.Equal(t, []string{"catalog"}, info.Metadata.Requires.Connections[0].Operations)
	require.Equal(t, []string{"apps/*"}, info.Metadata.Requires.Connections[0].ResourceTypes)
	info.Metadata.Exports.Connections.Operations[0] = "update"
	info.Metadata.Requires.Connections[0].Operations[0] = "update"
	trusted, ok := pm.builtin("owned")
	require.True(t, ok)
	require.Equal(t, []string{"get"}, trusted.Metadata.Exports.Connections.Operations)
	require.Equal(t, []string{"catalog"}, trusted.Metadata.Requires.Connections[0].Operations)
}

func TestBuiltinConcurrentInventoryDuringCleanup(t *testing.T) {
	for _, operation := range []string{"unload", "disable"} {
		t.Run(operation, func(t *testing.T) {
			entered := make(chan struct{})
			release := make(chan struct{})
			reader, writer := io.Pipe()
			drained := make(chan struct{})
			go func() {
				_, _ = io.Copy(io.Discard, reader)
				close(drained)
			}()
			pm := catalogManager(t, []CatalogEntry{{
				Metadata: config.PluginMeta{ID: "native", Version: "1.0.0", Capabilities: []string{"resource"}},
				NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
					return plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Shutdown: func() error {
						close(entered)
						<-release
						return errors.Join(errors.New("native close failed"), writer.Close(), reader.Close())
					}}), nil
				},
			}})
			require.NoError(t, pm.Initialize(context.Background()))
			_, err := pm.LoadPlugin("native", nil)
			require.NoError(t, err)
			cleanupDone := make(chan error, 1)
			go func() {
				if operation == "unload" {
					cleanupDone <- pm.UnloadPlugin("native")
					return
				}
				_, err := pm.SetPluginEnabled("native", false)
				cleanupDone <- err
			}()
			<-entered
			inventoryRead := make(chan struct{})
			stopReads := make(chan struct{})
			readsDone := make(chan struct{})
			go func() {
				defer close(readsDone)
				_, _ = pm.GetPlugin("native")
				_ = pm.ListPlugins()
				close(inventoryRead)
				for {
					select {
					case <-stopReads:
						return
					default:
						_, _ = pm.GetPlugin("native")
						_ = pm.ListPlugins()
					}
				}
			}()
			<-inventoryRead
			close(release)
			require.ErrorContains(t, <-cleanupDone, "native close failed")
			close(stopReads)
			<-readsDone
			<-drained
			info, err := pm.GetPlugin("native")
			require.NoError(t, err)
			require.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
			require.Contains(t, info.LastError, "native close failed")
			require.Nil(t, pm.records["native"].Backend)
		})
	}
}

func TestBuiltinConnectionOwnerUsesCatalogAndDependencyAdmission(t *testing.T) {
	starts := 0
	entry := CatalogEntry{
		Metadata: config.PluginMeta{
			ID: "native-owner", Version: "1.0.0", Capabilities: []string{"resource"},
			Exports: &config.ExportsSpec{Connections: &config.ConnectionExport{
				Operations: []string{"catalog"}, ResourceTypes: []string{"flux/*"},
			}},
		},
		NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
			starts++
			return &capDetectingBackend{version: plugintypes.CurrentProtocolVersion, caps: []string{"resource"}}, nil
		},
	}
	consumer := config.PluginMeta{ID: "consumer", Requires: &config.RequiresSpec{Connections: []config.ConnectionRequirement{{
		Plugin: entry.Metadata.ID, Operations: []string{"catalog"}, ResourceTypes: []string{"flux/*"},
	}}}}
	pm := catalogManager(t, []CatalogEntry{entry})
	require.NoError(t, pm.Initialize(context.Background()))
	pm.sharing = &sharingState{}
	ctrl := &dependencyTrackingController{}
	pm.connfullControllers[sdktypes.CapabilityResource] = ctrl

	require.NoError(t, pm.validateDependencies(consumer))
	require.Zero(t, starts, "metadata validation must not activate the owner")
	require.NoError(t, pm.startRequiredOwners(consumer))
	require.Equal(t, 1, starts)
	require.Equal(t, 1, ctrl.dependencyStarts)
	require.Zero(t, ctrl.promotions)
	require.Equal(t, "builtin", pm.records[entry.Metadata.ID].Origin)
	require.NoError(t, pm.startRequiredOwners(consumer))
	require.Zero(t, ctrl.promotions, "dependency reuse must not enable auto-connect")
	_, err := pm.LoadPlugin(entry.Metadata.ID, nil)
	require.NoError(t, err)
	require.Equal(t, 1, ctrl.promotions)

	_, err = pm.SetPluginEnabled(entry.Metadata.ID, false)
	require.NoError(t, err)
	require.Error(t, pm.startRequiredOwners(consumer))
	require.Equal(t, 1, starts, "disabled owner must not restart")
	_, err = pm.SetPluginEnabled(entry.Metadata.ID, true)
	require.NoError(t, err)
	require.NoError(t, pm.pluginsRoot.MkdirAll(entry.Metadata.ID, 0700))
	require.Error(t, pm.startRequiredOwners(consumer))
	require.Equal(t, 1, starts, "external collision must block native activation")
	require.NoError(t, pm.validateDependencies(consumer), "external files must not replace trusted owner metadata")
	external := plugintypes.NewPluginRecord(entry.Metadata.ID, entry.Metadata, lifecycle.PhaseInstalled)
	recovery, err := pm.prepareUninstallRecovery(entry.Metadata.ID, external)
	require.NoError(t, err)
	require.NoError(t, pm.pluginsRoot.Rename(entry.Metadata.ID, filepath.Join(recovery.Stage, "plugin")))
	require.Error(t, pm.startRequiredOwners(consumer), "pending recovery must block dependency activation without a canonical collision")
	require.Equal(t, 1, starts)
	require.DirExists(t, pm.pluginsRoot.ResolvePath(recovery.Stage))
}

func TestBuiltinConsumerValidatesOwnersBeforeFactory(t *testing.T) {
	starts := 0
	entry := CatalogEntry{
		Metadata: config.PluginMeta{
			ID: "native-consumer", Version: "1.0.0", Capabilities: []string{"resource"},
			Requires: &config.RequiresSpec{Connections: []config.ConnectionRequirement{{
				Plugin: "missing-owner", Operations: []string{"catalog"}, ResourceTypes: []string{"flux/*"},
			}}},
		},
		NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
			starts++
			return &capDetectingBackend{version: plugintypes.CurrentProtocolVersion, caps: []string{"resource"}}, nil
		},
	}
	pm := catalogManager(t, []CatalogEntry{entry})
	require.NoError(t, pm.Initialize(context.Background()))
	pm.sharing = &sharingState{}
	_, activationErr := pm.LoadPlugin(entry.Metadata.ID, nil)
	require.Error(t, activationErr)
	require.Zero(t, starts)
	info, err := pm.GetPlugin(entry.Metadata.ID)
	require.NoError(t, err)
	require.Equal(t, "builtin", info.Origin)
	require.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
	require.Equal(t, activationErr.Error(), info.LastError)
}

func TestBuiltinFailedPreferenceRestoreReconcilesPersistedDisable(t *testing.T) {
	stops := 0
	pm := catalogManager(t, []CatalogEntry{{
		Metadata: config.PluginMeta{ID: "native", Version: "1.0.0", Capabilities: []string{"resource"}},
		NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
			return plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Shutdown: func() error {
				stops++
				return nil
			}}), nil
		},
	}})
	require.NoError(t, pm.Initialize(context.Background()))
	_, err := pm.LoadPlugin("native", nil)
	require.NoError(t, err)
	// Model a preference rename already visible on disk while its durability
	// acknowledgement failed. Prevent the compensating write from renaming.
	state := pm.records["native"].ToStateRecord()
	state.Enabled = false
	stateMu.Lock()
	err = pm.writePluginStateRecords([]plugintypes.PluginStateRecord{state})
	stateMu.Unlock()
	require.NoError(t, err)
	require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0700))
	info, err := pm.SetPluginEnabled("native", false)
	require.Error(t, err)
	require.False(t, info.Enabled)
	require.Equal(t, 1, stops, "persisted disable must retire the running lifetime despite rollback failure")
	require.Nil(t, pm.records["native"].Backend)
	states, err := pm.readPluginStateJSON()
	require.NoError(t, err)
	require.False(t, states[0].Enabled)
}

func TestBuiltinEnablementRetainsCollisionFailure(t *testing.T) {
	pm := catalogManager(t, []CatalogEntry{{
		Metadata:       config.PluginMeta{ID: "owned", Version: "1.0.0", Capabilities: []string{"ui"}},
		FrontendModule: "owned",
	}})
	require.NoError(t, pm.pluginsRoot.MkdirAll("owned", 0700))
	require.ErrorContains(t, pm.Initialize(context.Background()), "collides")
	for _, enabled := range []bool{false, true} {
		info, err := pm.SetPluginEnabled("owned", enabled)
		require.NoError(t, err)
		require.Equal(t, enabled, info.Enabled)
		require.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
		require.Contains(t, info.LastError, "collides")
	}
}

func TestBuiltinArchiveRecoveryBlocksActivationAndStageOnly(t *testing.T) {
	pm, recovery := archiveRecoveryFixture(t, false)
	trusted := CatalogEntry{Metadata: config.PluginMeta{
		ID: recovery.ID, Name: "Trusted built-in", Version: "3.0.0", Capabilities: []string{"ui"},
	}, FrontendModule: "trusted"}
	catalog, err := NewCatalog([]CatalogEntry{trusted})
	require.NoError(t, err)
	pm.catalog = catalog
	pm.records = make(map[string]*plugintypes.PluginRecord)
	installPluginFixture(t, pm, "unrelated", []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll("unrelated/assets", 0755))
	marker, err := pm.stateRoot.ReadFile(archiveRecoveryName(recovery.ID))
	require.NoError(t, err)
	emitter := &testRecordingEmitter{}
	pm.emitter = emitter
	require.ErrorContains(t, pm.Initialize(context.Background()), "pending archive replacement")
	info, err := pm.GetPlugin(recovery.ID)
	require.NoError(t, err)
	require.Equal(t, "builtin", info.Origin)
	require.Equal(t, trusted.Metadata, info.Metadata)
	require.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
	require.Contains(t, info.LastError, recovery.Stage)
	blocked, err := pm.reconcileArchiveRecoveries()
	require.Error(t, err)
	require.True(t, blocked[recovery.ID])
	require.True(t, blocked[recovery.Stage])
	_, err = pm.LoadPlugin(recovery.ID, nil)
	require.Error(t, err)
	unrelated, err := pm.GetPlugin("unrelated")
	require.NoError(t, err)
	require.Equal(t, string(lifecycle.PhaseRunning), unrelated.Phase)
	require.Contains(t, emitter.getEvents(), testEmittedEvent{event: EventInitComplete})
	after, err := pm.stateRoot.ReadFile(archiveRecoveryName(recovery.ID))
	require.NoError(t, err)
	require.Equal(t, marker, after)
	require.DirExists(t, pm.pluginsRoot.ResolvePath(recovery.Stage))
}
