package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const archiveCommitCandidateYAML = "id: flux\nversion: 0.4.0\ncapabilities: [ui]\n"

// This is a Go event consumer, not execution of PluginService or JavaScript.
// Like the existing ready-module consumer in PluginService, inventory changes
// alone cannot replace its loaded module: only install_finished reloads it.
// The replacement is read from canonical files and durable inventory, never
// copied from the emitted metadata or the install method's response.
type archiveCommitModuleSnapshot struct {
	bundle          string
	metadataVersion string
	durableVersion  string
	phase           lifecycle.PluginPhase
}

func readArchiveCommitModule(t *testing.T, pm *pluginManager) archiveCommitModuleSnapshot {
	t.Helper()
	bundle, err := pm.pluginsRoot.ReadFile("flux/assets/entry.js")
	require.NoError(t, err)
	metadata, err := parseMetadataFromPluginPath(pm.pluginsRoot.ResolvePath("flux"))
	require.NoError(t, err)
	states, err := pm.readPluginStateJSON()
	require.NoError(t, err)
	require.Len(t, states, 1)
	require.Equal(t, "flux", states[0].ID)
	return archiveCommitModuleSnapshot{
		bundle: string(bundle), metadataVersion: metadata.Version,
		durableVersion: states[0].Metadata.Version, phase: states[0].Phase,
	}
}

type archiveCommitModuleConsumer struct {
	t             *testing.T
	pm            *pluginManager
	module        archiveCommitModuleSnapshot
	inventory     string
	notifications int
	invalidations int
}

func (consumer *archiveCommitModuleConsumer) Emit(event string, data ...any) {
	switch event {
	case EventInstallFinished:
		consumer.notifications++
		require.Len(consumer.t, data, 1)
		metadata, ok := data[0].(*config.PluginMeta)
		require.True(consumer.t, ok, "module notification must identify the installed plugin")
		require.NotNil(consumer.t, metadata)
		require.Equal(consumer.t, "flux", metadata.ID)
		consumer.module = readArchiveCommitModule(consumer.t, consumer.pm)
		assert.Equal(consumer.t, "0.4.0", metadata.Version)
		assert.Equal(consumer.t, archiveCommitModuleSnapshot{
			bundle: "candidate module bytes", metadataVersion: "0.4.0",
			durableVersion: "0.4.0", phase: lifecycle.PhaseRunning,
		}, consumer.module, "notification must not precede canonical and durable candidate publication")
	case EventInventoryChanged:
		consumer.invalidations++
		inventory := consumer.pm.ListPlugins()
		require.Len(consumer.t, inventory, 1)
		consumer.inventory = inventory[0].Metadata.Version
		assert.Equal(consumer.t, "0.4.0", consumer.inventory)
		assert.Equal(consumer.t, "0.4.0", readArchiveCommitModule(consumer.t, consumer.pm).durableVersion)
	}
}

func archiveCommitInstalledFixture(t *testing.T) (*pluginManager, *archiveCommitModuleConsumer) {
	t.Helper()
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
	require.NoError(t, pm.pluginsRoot.WriteFile("flux/assets/entry.js", []byte("original module bytes"), 0644))
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	consumer := &archiveCommitModuleConsumer{
		t: t, pm: pm, module: readArchiveCommitModule(t, pm), inventory: "1.0.0",
	}
	pm.emitter = consumer
	return pm, consumer
}

func TestArchiveCommitBoundary_StateWriteWithoutSyncedMarkerIsUncertain(t *testing.T) {
	for _, phase := range []string{"phase0_uncertain", "phase1_cleanup_pending"} {
		t.Run(phase, func(t *testing.T) {
			pm, consumer := archiveCommitInstalledFixture(t)
			oldModule := consumer.module
			previous := pm.records["flux"].ToStateRecord()
			require.NoError(t, pm.beginArchivePersistence("flux"))
			stage, err := pm.pluginsRoot.MkdirTemp(".archive-flux-")
			require.NoError(t, err)
			candidate := filepath.Join(stage, "candidate")
			require.NoError(t, pm.pluginsRoot.MkdirAll(filepath.Join(candidate, "assets"), 0700))
			require.NoError(t, pm.pluginsRoot.WriteFile(filepath.Join(candidate, "plugin.yaml"), []byte(archiveCommitCandidateYAML), 0644))
			require.NoError(t, pm.pluginsRoot.WriteFile(filepath.Join(candidate, "assets/entry.js"), []byte("candidate module bytes"), 0644))
			metadata, err := parseMetadataFromPluginPath(pm.pluginsRoot.ResolvePath(candidate))
			require.NoError(t, err)
			recovery, err := pm.prepareArchiveRecovery("flux", stage, &previous, *metadata)
			require.NoError(t, err)
			require.NoError(t, pm.unloadArchivePlugin(recovery))
			require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace("flux", filepath.Join(stage, "previous")))
			require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace(candidate, "flux"))
			_, err = pm.LoadPlugin("flux", &LoadPluginOptions{archive: recovery})
			require.NoError(t, err)

			// Reproduce the exact stateWritten=true boundary using the real
			// synced state writer. No syscall hook exists for a deterministic
			// post-state-write marker Sync failure. Invoke the actual current
			// failure handler at that boundary rather than polling the filesystem
			// or claiming to have injected a kernel Sync failure. Phase 0 is a
			// real durable journal, not a fabricated recovery object.
			stateMu.Lock()
			writeErr := pm.writePluginStateRecords(pm.pluginStateSnapshot("flux"))
			stateMu.Unlock()
			require.NoError(t, writeErr)
			require.False(t, recovery.committed)
			wantType := "omniview:plugin/commit-uncertain"
			if phase == "phase1_cleanup_pending" {
				require.NoError(t, pm.markArchiveCommitted(recovery))
				wantType = "omniview:plugin/committed-cleanup-pending"
			}
			proofBefore, err := pm.stateRoot.ReadFile(archiveRecoveryName("flux"))
			require.NoError(t, err)
			var envelope struct {
				Committed uint8 `json:"committed"`
			}
			require.NoError(t, json.Unmarshal(proofBefore, &envelope))
			if phase == "phase0_uncertain" {
				require.Zero(t, envelope.Committed)
			} else {
				require.Equal(t, uint8(1), envelope.Committed)
			}
			require.NoError(t, pm.validateArchiveRecovery(recovery))
			require.Equal(t, "0.4.0", readArchiveCommitModule(t, pm).durableVersion)

			cause := &os.PathError{Op: "sync", Path: pm.stateRoot.ResolvePath(archiveRecoveryName("flux")), Err: syscall.EIO}
			err = pm.archivePublicationFailure(recovery, cause)
			var appErr *apperror.AppError
			require.ErrorAs(t, err, &appErr)
			assert.Equal(t, wantType, appErr.Type, "candidate state alone is not proof of a synced commit marker")
			assert.ErrorIs(t, err, syscall.EIO)
			assert.Equal(t, "flux", appErr.Instance)

			proofAfter, err := pm.stateRoot.ReadFile(archiveRecoveryName("flux"))
			require.NoError(t, err)
			assert.Equal(t, proofBefore, proofAfter, "error reporting must retain the original durable proof")
			canonicalIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
			require.NoError(t, err)
			assert.Equal(t, recovery.CandidateIdentity, canonicalIdentity, "uncertainty must not roll the candidate back")
			previousIdentity, err := pm.pluginsRoot.DirectoryIdentity(filepath.Join(stage, "previous"))
			require.NoError(t, err)
			assert.Equal(t, recovery.PreviousIdentity, previousIdentity)
			oldBytes, err := pm.pluginsRoot.ReadFile(filepath.Join(stage, "previous/assets/entry.js"))
			require.NoError(t, err)
			assert.Equal(t, "original module bytes", string(oldBytes), "uncertainty must not dispose of the original")
			assert.Equal(t, archiveCommitModuleSnapshot{
				bundle: "candidate module bytes", metadataVersion: "0.4.0",
				durableVersion: "0.4.0", phase: lifecycle.PhaseRunning,
			}, readArchiveCommitModule(t, pm))
			assert.Equal(t, oldModule, consumer.module)
			assert.Zero(t, consumer.notifications, "the private failure boundary must not publish logical module success")
			assert.Zero(t, consumer.invalidations)
			assert.Error(t, pm.guardArchiveRecovery("flux"), "unresolved proof must continue to block public mutations")
		})
	}
}

func TestArchiveCommitBoundary_ModulePublicationFollowsProvenCommit(t *testing.T) {
	for _, outcome := range []string{"ordinary_success", "partial_backup_disposal", "precommit_state_rejection"} {
		t.Run(outcome, func(t *testing.T) {
			if outcome == "partial_backup_disposal" && (runtime.GOOS == "windows" || os.Geteuid() == 0) {
				t.Skip("real Unix permission-denied backup disposal requires an unprivileged user")
			}
			pm, consumer := archiveCommitInstalledFixture(t)
			oldModule := consumer.module
			oldIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
			require.NoError(t, err)
			if outcome == "partial_backup_disposal" {
				// Match the existing real-FS partial-disposal regression: an
				// ordinary file is removed, but an unreadable child survives.
				require.NoError(t, pm.pluginsRoot.WriteFile("flux/a-removed.txt", []byte("disposable original bytes"), 0644))
				require.NoError(t, pm.pluginsRoot.MkdirAll("flux/z-blocked", 0700))
				require.NoError(t, pm.pluginsRoot.WriteFile("flux/z-blocked/keep.txt", []byte("original backup survivor"), 0644))
				require.NoError(t, os.Chmod(pm.pluginsRoot.ResolvePath("flux/z-blocked"), 0000))
				t.Cleanup(func() {
					_ = os.Chmod(pm.pluginsRoot.ResolvePath("flux/z-blocked"), 0700)
					entries, _ := pm.pluginsRoot.ReadDir(".")
					for _, entry := range entries {
						if entry.IsDir() {
							_ = os.Chmod(pm.pluginsRoot.ResolvePath(filepath.Join(entry.Name(), "previous/z-blocked")), 0700)
						}
					}
				})
			}
			if outcome == "precommit_state_rejection" {
				require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0700))
			}
			archive := writeTestTarball(t, []tarEntry{
				{name: "plugin.yaml", mode: 0644, body: archiveCommitCandidateYAML},
				{name: "assets/", mode: 0755, dir: true},
				{name: "assets/entry.js", mode: 0644, body: "candidate module bytes"},
			})
			metadata, installErr := pm.InstallPluginFromPath(archive)
			switch outcome {
			case "ordinary_success":
				require.NoError(t, installErr)
				require.NotNil(t, metadata)
				assert.NoFileExists(t, pm.stateRoot.ResolvePath(archiveRecoveryName("flux")))
			case "partial_backup_disposal":
				require.Error(t, installErr)
				require.NotNil(t, metadata, "proven commit retains candidate result despite maintenance failure")
				var appErr *apperror.AppError
				require.ErrorAs(t, installErr, &appErr)
				assert.Equal(t, "omniview:plugin/committed-cleanup-pending", appErr.Type)
				assert.ErrorIs(t, installErr, os.ErrPermission)
				recovery, err := pm.readArchiveRecovery("flux")
				require.NoError(t, err)
				require.True(t, recovery.committed, "phase 1 must be durable before partial backup disposal")
				previous := filepath.Join(recovery.Stage, "previous")
				identity, err := pm.pluginsRoot.DirectoryIdentity(previous)
				require.NoError(t, err)
				assert.Equal(t, oldIdentity, identity)
				_, err = pm.pluginsRoot.Stat(filepath.Join(previous, "a-removed.txt"))
				assert.True(t, os.IsNotExist(err), "prove real partial deletion, not merely cleanup refusal")
				require.NoError(t, os.Chmod(pm.pluginsRoot.ResolvePath(filepath.Join(previous, "z-blocked")), 0700))
				survivor, err := pm.pluginsRoot.ReadFile(filepath.Join(previous, "z-blocked/keep.txt"))
				require.NoError(t, err)
				assert.Equal(t, "original backup survivor", string(survivor))
			case "precommit_state_rejection":
				require.Error(t, installErr)
				assert.Nil(t, metadata, "rejected durable publication is not a logical install")
				assert.Zero(t, consumer.notifications)
				assert.Zero(t, consumer.invalidations)
				assert.Equal(t, oldModule, consumer.module)
				assert.Equal(t, oldModule, readArchiveCommitModule(t, pm))
				identity, err := pm.pluginsRoot.DirectoryIdentity("flux")
				require.NoError(t, err)
				assert.Equal(t, oldIdentity, identity)
				return
			}
			assert.Equal(t, 1, consumer.notifications, "every proven commit must reload the existing module exactly once, including cleanup failure")
			assert.Equal(t, 1, consumer.invalidations, "every proven commit must invalidate inventory exactly once")
			assert.Equal(t, "0.4.0", consumer.inventory)
			assert.Equal(t, archiveCommitModuleSnapshot{
				bundle: "candidate module bytes", metadataVersion: "0.4.0",
				durableVersion: "0.4.0", phase: lifecycle.PhaseRunning,
			}, consumer.module, "inventory invalidation cannot leave the existing module on original bytes")
			assert.Equal(t, consumer.module, readArchiveCommitModule(t, pm))
		})
	}
}
