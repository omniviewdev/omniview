package plugin

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// This controller fails at the real settings shutdown boundary, which runs
// after shutdownBackend has stopped and killed the actual InProcessBackend.
// It never changes a record's phase or stops a backend itself.
type archiveDeadRuntimeShutdownController struct {
	backend     plugintypes.PluginBackend
	shutdownErr error
}

func (*archiveDeadRuntimeShutdownController) OnPluginInit(string, config.PluginMeta) {}

func (c *archiveDeadRuntimeShutdownController) OnPluginStart(_ string, _ config.PluginMeta, backend plugintypes.PluginBackend) error {
	if !backend.Healthy() || backend.Exited() {
		return errors.New("settings cannot bind a dead backend")
	}
	if _, err := backend.Dispense("resource"); err != nil {
		return err
	}
	c.backend = backend
	return nil
}

func (*archiveDeadRuntimeShutdownController) OnPluginStop(string, config.PluginMeta) error {
	return nil
}

func (c *archiveDeadRuntimeShutdownController) OnPluginShutdown(string, config.PluginMeta) error {
	if c.backend == nil || !c.backend.Exited() || c.backend.Healthy() {
		return errors.New("shutdown boundary reached before backend exit")
	}
	if _, err := c.backend.Dispense("resource"); err == nil {
		return errors.New("exited backend still dispenses its provider")
	}
	return c.shutdownErr
}

func (*archiveDeadRuntimeShutdownController) OnPluginDestroy(string, config.PluginMeta) error {
	return nil
}

func (*archiveDeadRuntimeShutdownController) ListPlugins() ([]string, error) { return nil, nil }
func (*archiveDeadRuntimeShutdownController) HasPlugin(string) bool          { return false }

type archiveDeadRuntimeInventoryConsumer struct {
	testRecordingEmitter
	refresh func()
}

func (c *archiveDeadRuntimeInventoryConsumer) Emit(event string, data ...any) {
	c.testRecordingEmitter.Emit(event, data...)
	if event == EventInventoryChanged {
		c.refresh()
	}
}

type archiveDeadRuntimeFile struct {
	Mode fs.FileMode
	Data string
}

func archiveDeadRuntimeTree(t *testing.T, root string) map[string]archiveDeadRuntimeFile {
	t.Helper()
	entries := make(map[string]archiveDeadRuntimeFile)
	require.NoError(t, filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		file := archiveDeadRuntimeFile{Mode: info.Mode()}
		if !entry.IsDir() {
			contents, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			file.Data = string(contents)
		}
		entries[rel] = file
		return nil
	}))
	return entries
}

func TestInstallPluginFromPath_ShutdownRefusalAfterBackendExit(t *testing.T) {
	// These are filesystem/manager unit tests with an in-process backend at the
	// process boundary. The tar's placeholder executable is not SDK E2E proof.
	for _, dev := range []bool{false, true} {
		for _, restartUnavailable := range []bool{false, true} {
			name := "installed/recreates-original"
			if dev {
				name = "managed-dev/recreates-original"
			}
			if restartUnavailable {
				if dev {
					name = "managed-dev/retains-proof-on-restart-failure"
				} else {
					name = "installed/retains-proof-on-restart-failure"
				}
			}
			t.Run(name, func(t *testing.T) {
				pm := newTestManager(t)
				installPluginFixture(t, pm, "flux", []string{"resource", "ui"}, true)
				require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
				require.NoError(t, pm.pluginsRoot.WriteFile("flux/assets/entry.js", []byte("original bundle"), 0644))
				require.NoError(t, pm.pluginsRoot.MkdirAll("flux/store", 0700))
				require.NoError(t, pm.pluginsRoot.WriteFile("flux/store/survivor", []byte("original user data"), 0600))

				// Provider identity and contents are independent of the metadata
				// supplied by the loader; the factory never echoes its arguments.
				originalProvider := map[string]string{"release": "1.0.0", "data": "original provider data"}
				candidateProvider := map[string]string{"release": "0.4.0", "data": "candidate provider data"}
				restartErr := errors.New("original backend restart is unavailable")
				refuseRestart := false
				pm.backendFactory = func(metadata config.PluginMeta, _ string) (plugintypes.PluginBackend, error) {
					if metadata.Version == "1.0.0" {
						if refuseRestart {
							return nil, restartErr
						}
						return plugintypes.NewInProcessBackend(map[string]interface{}{"resource": originalProvider}), nil
					}
					return plugintypes.NewInProcessBackend(map[string]interface{}{"resource": candidateProvider}), nil
				}
				shutdownErr := errors.New("settings shutdown refused after backend exit")
				controller := &archiveDeadRuntimeShutdownController{shutdownErr: shutdownErr}
				pm.connlessControllers[sdktypes.CapabilitySettings] = controller
				var opts *LoadPluginOptions
				servers := &transactionDevServers{}
				var source string
				var sourceBefore map[string]archiveDeadRuntimeFile
				if dev {
					source = devSourceFixture(t, "id: flux\nversion: 1.0.0\ncapabilities: [resource, ui]\n")
					require.NoError(t, os.WriteFile(filepath.Join(source, "source.go"), []byte("package original\n"), 0644))
					sourceBefore = archiveDeadRuntimeTree(t, source)
					pm.devServerMgr = servers
					_, err := servers.StartDevServerForPath("flux", source)
					require.NoError(t, err)
					opts = &LoadPluginOptions{DevMode: true, DevModePath: source}
				}
				_, err := pm.LoadPlugin("flux", opts)
				require.NoError(t, err)
				require.NoError(t, pm.writePluginStateJSON())
				original := pm.records["flux"]
				originalBackend := original.Backend
				require.True(t, originalBackend.Healthy())
				require.False(t, originalBackend.Exited())
				before := original.ToStateRecord()
				beforeIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
				require.NoError(t, err)
				beforeTree := archiveDeadRuntimeTree(t, pm.pluginsRoot.ResolvePath("flux"))
				beforeDurable, err := pm.stateRoot.ReadFile(stateFileName)
				require.NoError(t, err)
				archive := writeTestTarball(t, []tarEntry{
					{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.4.0\ncapabilities: [resource, ui]\n"},
					{name: "assets/", mode: 0755, dir: true},
					{name: "assets/entry.js", mode: 0644, body: "candidate bundle"},
					{name: "bin/", mode: 0755, dir: true},
					{name: "bin/plugin", mode: 0755, body: "candidate executable"},
				})
				beforeArchive, err := os.ReadFile(archive)
				require.NoError(t, err)
				visibleInventory := pm.ListPlugins()
				beforeVisible := pm.ListPlugins()
				consumer := &archiveDeadRuntimeInventoryConsumer{refresh: func() { visibleInventory = pm.ListPlugins() }}
				pm.emitter = consumer
				refuseRestart = restartUnavailable

				_, err = pm.InstallPluginFromPath(archive)
				require.Error(t, err, "partial teardown refusal must reject the archive")
				assert.ErrorIs(t, err, shutdownErr, "the refusal must occur after the actual backend exits")
				assert.True(t, originalBackend.Exited(), "this regression requires irreversible backend teardown, not an early stop refusal")
				assert.False(t, originalBackend.Healthy())
				_, deadErr := originalBackend.Dispense("resource")
				assert.Error(t, deadErr)

				if restartUnavailable {
					assert.ErrorIs(t, err, restartErr, "restoration must attempt a new backend rather than accept a Running record with a dead backend")
					retained := pm.records["flux"]
					if assert.NotNil(t, retained) {
						assert.Equal(t, lifecycle.PhaseFailed, retained.Phase)
						assert.Equal(t, before.Metadata, retained.Metadata)
						assert.Equal(t, before.DevMode, retained.DevMode)
						assert.Equal(t, before.DevPath, retained.DevPath)
					}
					proof, proofErr := pm.readArchiveRecovery("flux")
					if assert.NoError(t, proofErr, "failed runtime restoration must retain durable ownership proof") {
						require.NotNil(t, proof, "failed runtime restoration must retain durable ownership proof")
						require.NotNil(t, proof.Previous)
						assert.False(t, proof.committed)
						previous := *proof.Previous
						assert.True(t, before.InstalledAt.Equal(previous.InstalledAt), "durable recovery must preserve the installation's wall-clock instant")
						// JSON does not retain time.Time's monotonic/location representation.
						// Compare every other field without mutating the validated proof.
						previous.InstalledAt = before.InstalledAt
						assert.Equal(t, before, previous)
						assert.Equal(t, beforeIdentity, proof.PreviousIdentity)
						assert.NoError(t, pm.validateArchiveRecovery(proof))
						staged, readErr := pm.pluginsRoot.ReadFile(filepath.Join(proof.Stage, "candidate", "assets", "entry.js"))
						assert.NoError(t, readErr)
						assert.Equal(t, "candidate bundle", string(staged))
					}
					persisted, readErr := pm.readPluginStateJSON()
					require.NoError(t, readErr)
					if assert.Len(t, persisted, 1) {
						assert.Equal(t, lifecycle.PhaseFailed, persisted[0].Phase)
						assert.Equal(t, before.Metadata, persisted[0].Metadata)
						assert.Equal(t, before.DevPath, persisted[0].DevPath)
					}
					_, loadErr := pm.LoadPlugin("flux", nil)
					assert.Error(t, loadErr, "public load cannot clear pending recovery")
				} else {
					restored := pm.records["flux"]
					if assert.NotNil(t, restored) {
						assert.Equal(t, before, restored.ToStateRecord())
						if assert.NotNil(t, restored.Backend) {
							assert.NotSame(t, originalBackend, restored.Backend, "the stopped InProcessBackend cannot be reused")
							assert.True(t, restored.Backend.Healthy(), "Running must mean an actually usable restored runtime")
							assert.False(t, restored.Backend.Exited())
							provider, dispenseErr := restored.Backend.Dispense("resource")
							if assert.NoError(t, dispenseErr, "rollback must not take the Running fast path on a dead backend") {
								assert.Equal(t, originalProvider, provider)
							}
							assert.Same(t, restored.Backend, controller.backend, "the restored backend must be rebound to its controller")
						}
					}
					afterDurable, readErr := pm.stateRoot.ReadFile(stateFileName)
					require.NoError(t, readErr)
					assert.Equal(t, beforeDurable, afterDurable)
					_, proofErr := pm.stateRoot.ReadFile(archiveRecoveryName("flux"))
					assert.True(t, os.IsNotExist(proofErr), "only successful restoration may clear proof")
				}

				afterIdentity, identityErr := pm.pluginsRoot.DirectoryIdentity("flux")
				require.NoError(t, identityErr)
				assert.Equal(t, beforeIdentity, afterIdentity, "retain the original complete directory inode")
				assert.Equal(t, beforeTree, archiveDeadRuntimeTree(t, pm.pluginsRoot.ResolvePath("flux")), "preserve all original files, directory modes, executable bytes and user store")
				if dev {
					assert.Equal(t, sourceBefore, archiveDeadRuntimeTree(t, source), "the caller's source remains untouched")
					assert.True(t, servers.IsManaged("flux"))
					assert.Equal(t, source, servers.state.DevPath)
				}
				afterArchive, readErr := os.ReadFile(archive)
				require.NoError(t, readErr)
				assert.Equal(t, beforeArchive, afterArchive)
				assert.Equal(t, beforeVisible, visibleInventory, "an existing inventory consumer must not observe a successful replacement")
				for _, event := range consumer.getEvents() {
					assert.NotEqual(t, EventInventoryChanged, event.event)
					assert.NotEqual(t, EventInstallFinished, event.event)
				}
			})
		}
	}
}
