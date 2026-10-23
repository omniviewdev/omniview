package plugin

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

func archiveRecoveryFixture(t *testing.T, previous bool) (*pluginManager, *archiveRecovery) {
	t.Helper()
	pm := newTestManager(t)
	var state *plugintypes.PluginStateRecord
	if previous {
		require.NoError(t, pm.pluginsRoot.MkdirAll("flux", 0755))
		require.NoError(t, pm.pluginsRoot.WriteFile("flux/survivor", []byte("complete original"), 0600))
		record := plugintypes.NewPluginRecord("flux", config.PluginMeta{ID: "flux", Version: "1.0.0"}, lifecycle.PhaseRunning)
		record.Enabled, record.DevMode, record.DevPath = false, true, "/original/source"
		snapshot := record.ToStateRecord()
		state = &snapshot
	}
	stage, err := pm.pluginsRoot.MkdirTemp(".archive-flux-")
	require.NoError(t, err)
	require.NoError(t, pm.pluginsRoot.MkdirAll(filepath.Join(stage, "candidate"), 0755))
	require.NoError(t, pm.pluginsRoot.WriteFile(filepath.Join(stage, "candidate", "bundle"), []byte("candidate bytes"), 0600))
	recovery, err := pm.prepareArchiveRecovery("flux", stage, state, config.PluginMeta{ID: "flux", Version: "2.0.0"})
	require.NoError(t, err)
	require.NotNil(t, recovery)
	return pm, recovery
}

func TestArchiveRecovery_ValidatesMovedAndRemovedOwnedDirectories(t *testing.T) {
	pm, recovery := archiveRecoveryFixture(t, true)
	require.NoError(t, pm.validateArchiveRecovery(recovery))
	require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace("flux", filepath.Join(recovery.Stage, "previous")))
	require.NoError(t, pm.validateArchiveRecovery(recovery))
	require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace(filepath.Join(recovery.Stage, "candidate"), "flux"))
	require.NoError(t, pm.validateArchiveRecovery(recovery))
	require.NoError(t, pm.markArchiveCommitted(recovery))
	assert.True(t, recovery.committed)
	read, err := pm.readArchiveRecovery("flux")
	require.NoError(t, err)
	assert.True(t, read.committed, "restart must retain the irreversible previous-disposal phase")
	assert.Equal(t, recovery.markerIdentity, read.markerIdentity, "commit must advance the captured marker rather than replace it")
	require.NoError(t, pm.pluginsRoot.RemoveAll(recovery.Stage))
	require.NoError(t, pm.validateArchiveRecovery(recovery))
	require.NoError(t, pm.removeArchiveRecoveryMarker(recovery))
	assert.NoError(t, pm.guardArchiveRecovery("flux"))
	bundle, err := pm.pluginsRoot.ReadFile("flux/bundle")
	require.NoError(t, err)
	assert.Equal(t, "candidate bytes", string(bundle), "marker removal must never remove the installation")
}

func TestArchiveRecovery_CommitNeverAllowsPreviousCanonicalAdoption(t *testing.T) {
	pm, recovery := archiveRecoveryFixture(t, true)
	require.NoError(t, pm.pluginsRoot.WriteFile("flux/disposed", []byte("old artifact"), 0600))
	require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace("flux", filepath.Join(recovery.Stage, "previous")))
	require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace(filepath.Join(recovery.Stage, "candidate"), "flux"))
	require.NoError(t, pm.markArchiveCommitted(recovery))
	require.NoError(t, pm.pluginsRoot.Remove(filepath.Join(recovery.Stage, "previous", "disposed")))
	require.NoError(t, pm.pluginsRoot.RemoveAll("flux"))
	require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace(filepath.Join(recovery.Stage, "previous"), "flux"))
	restarted := newTestManager(t)
	restarted.stateRoot, restarted.pluginsRoot = pm.stateRoot, pm.pluginsRoot
	read, err := restarted.readArchiveRecovery("flux")
	require.NoError(t, err)
	require.True(t, read.committed)
	assert.Error(t, restarted.validateArchiveRecovery(read), "an exact old inode is not a complete installation after backup disposal began")
	assert.Error(t, restarted.removeArchiveRecoveryMarker(read))
	blocked, err := restarted.reconcileArchiveRecoveries()
	require.NoError(t, err)
	assert.True(t, blocked["flux"])
	assert.True(t, blocked[recovery.Stage])
	record := restarted.records["flux"]
	require.NotNil(t, record)
	assert.Equal(t, lifecycle.PhaseFailed, record.Phase)
	assert.Equal(t, "2.0.0", record.Metadata.Version, "committed recovery inventory must describe the new installed candidate")
	assert.False(t, record.DevMode)
	assert.Empty(t, record.DevPath)
	assert.True(t, record.Enabled)
	assert.True(t, record.InstalledAt.IsZero(), "recovery must not invent an uncaptured installation timestamp")
	assert.Contains(t, record.LastError, "must not be restored")
	assert.NoFileExists(t, pm.pluginsRoot.ResolvePath("flux/disposed"), "a partially disposed old tree must not be reconstructed")
	survivor, err := pm.pluginsRoot.ReadFile("flux/survivor")
	require.NoError(t, err)
	assert.Equal(t, "complete original", string(survivor))
}

func TestArchiveRecovery_ReconcileBlocksForeignCanonicalWithoutAdoptingIt(t *testing.T) {
	pm, recovery := archiveRecoveryFixture(t, true)
	require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace("flux", filepath.Join(recovery.Stage, "previous")))
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux", 0700))
	require.NoError(t, pm.pluginsRoot.WriteFile("flux/foreign", []byte("never adopt"), 0600))
	foreign, err := pm.pluginsRoot.DirectoryIdentity("flux")
	require.NoError(t, err)
	restarted := newTestManager(t)
	restarted.stateRoot, restarted.pluginsRoot = pm.stateRoot, pm.pluginsRoot
	blocked, err := restarted.reconcileArchiveRecoveries()
	require.NoError(t, err)
	assert.True(t, blocked["flux"])
	assert.True(t, blocked[recovery.Stage])
	record := restarted.records["flux"]
	require.NotNil(t, record)
	assert.Equal(t, lifecycle.PhaseFailed, record.Phase)
	assert.Equal(t, lifecycle.PhaseFailed, record.StateMachine.Phase())
	assert.True(t, record.DevMode)
	assert.False(t, record.Enabled)
	assert.Equal(t, "/original/source", record.DevPath)
	assert.Equal(t, "1.0.0", record.Metadata.Version)
	assert.Contains(t, record.LastError, pm.pluginsRoot.ResolvePath(recovery.Stage))
	assert.Contains(t, record.LastError, "foreign")
	assert.Error(t, restarted.guardArchiveRecovery("flux"))
	assert.Error(t, restarted.removeArchiveRecoveryMarker(recovery))
	after, err := pm.pluginsRoot.DirectoryIdentity("flux")
	require.NoError(t, err)
	assert.Equal(t, foreign, after)
	original, err := pm.pluginsRoot.ReadFile(filepath.Join(recovery.Stage, "previous", "survivor"))
	require.NoError(t, err)
	assert.Equal(t, "complete original", string(original))
}

func TestArchiveRecovery_ReconcileCandidateInventoryWithoutPrevious(t *testing.T) {
	pm, recovery := archiveRecoveryFixture(t, false)
	blocked, err := pm.reconcileArchiveRecoveries()
	require.NoError(t, err)
	assert.True(t, blocked[recovery.Stage])
	assert.Equal(t, "2.0.0", pm.records["flux"].Metadata.Version)
	assert.Equal(t, lifecycle.PhaseFailed, pm.records["flux"].Phase)
	assert.False(t, pm.records["flux"].DevMode)
	assert.Contains(t, pm.records["flux"].LastError, pm.pluginsRoot.ResolvePath(recovery.Stage))
}

func TestArchiveRecovery_RejectsForeignChildrenAndNonprivateStage(t *testing.T) {
	for _, change := range []string{"candidate", "previous", "extra", "mode", "symlink"} {
		t.Run(change, func(t *testing.T) {
			pm, recovery := archiveRecoveryFixture(t, true)
			switch change {
			case "candidate":
				require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace(filepath.Join(recovery.Stage, "candidate"), "displaced-candidate"))
				require.NoError(t, pm.pluginsRoot.MkdirAll(filepath.Join(recovery.Stage, "candidate"), 0700))
			case "previous":
				require.NoError(t, pm.pluginsRoot.MkdirAll(filepath.Join(recovery.Stage, "previous"), 0700))
			case "extra":
				require.NoError(t, pm.pluginsRoot.WriteFile(filepath.Join(recovery.Stage, "unowned"), []byte("keep"), 0600))
			case "mode":
				if runtime.GOOS == "windows" {
					t.Skip("Unix directory mode semantics")
				}
				require.NoError(t, os.Chmod(pm.pluginsRoot.ResolvePath(recovery.Stage), 0755))
			case "symlink":
				if runtime.GOOS == "windows" {
					t.Skip("directory symlink creation requires additional Windows privileges")
				}
				require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace(recovery.Stage, recovery.Stage+"-displaced"))
				require.NoError(t, os.Symlink(recovery.Stage+"-displaced", pm.pluginsRoot.ResolvePath(recovery.Stage)))
			}
			assert.Error(t, pm.validateArchiveRecovery(recovery))
			assert.Error(t, pm.markArchiveCommitted(recovery))
			assert.Error(t, pm.removeArchiveRecoveryMarker(recovery))
			assert.FileExists(t, pm.stateRoot.ResolvePath(".archive-recovery-flux.json"))
		})
	}
}

func TestArchiveRecovery_RejectsReplacedMarkerBeforeCommitOrRemoval(t *testing.T) {
	pm, recovery := archiveRecoveryFixture(t, true)
	name := ".archive-recovery-flux.json"
	proof, err := pm.stateRoot.ReadFile(name)
	require.NoError(t, err)
	require.NoError(t, pm.stateRoot.Rename(name, "displaced-archive-proof"))
	require.NoError(t, pm.stateRoot.WriteFile(name, proof, 0600))
	assert.Error(t, pm.markArchiveCommitted(recovery))
	assert.False(t, recovery.committed)
	assert.Error(t, pm.removeArchiveRecoveryMarker(recovery))
	after, err := pm.stateRoot.ReadFile(name)
	require.NoError(t, err)
	assert.Equal(t, proof, after, "a replacement marker must not be advanced or removed")
}

func TestArchiveRecovery_RejectsRewrittenMarkerWithSameFilesystemIdentity(t *testing.T) {
	pm, recovery := archiveRecoveryFixture(t, true)
	name := ".archive-recovery-flux.json"
	proof, err := pm.stateRoot.ReadFile(name)
	require.NoError(t, err)
	rewritten := []byte(strings.Replace(string(proof), "2.0.0", "9.0.0", 1))
	require.NoError(t, pm.stateRoot.WriteFile(name, rewritten, 0600))
	read, err := pm.readArchiveRecovery("flux")
	require.NoError(t, err)
	assert.Equal(t, recovery.markerIdentity, read.markerIdentity, "prove this is an in-place rewrite, not a replacement-marker refusal")
	assert.Error(t, pm.validateArchiveRecovery(recovery))
	assert.Error(t, pm.markArchiveCommitted(recovery))
	assert.Error(t, pm.removeArchiveRecoveryMarker(recovery))
	after, err := pm.stateRoot.ReadFile(name)
	require.NoError(t, err)
	assert.Equal(t, rewritten, after)
}

func TestArchiveRecovery_RejectsInvalidAndForeignProfileProofs(t *testing.T) {
	for _, change := range []string{"trailing", "unknown", "phase", "empty", "foreign", "mode"} {
		t.Run(change, func(t *testing.T) {
			pm, _ := archiveRecoveryFixture(t, true)
			name := ".archive-recovery-flux.json"
			proof, err := pm.stateRoot.ReadFile(name)
			require.NoError(t, err)
			switch change {
			case "trailing":
				proof = append(proof, []byte("{}")...)
			case "unknown":
				proof = []byte(strings.Replace(string(proof), "\"version\":1", "\"unknown\":true,\"version\":1", 1))
			case "phase":
				proof = []byte(strings.Replace(string(proof), "\"committed\":0", "\"committed\":2", 1))
			case "empty":
				proof = nil
			case "foreign":
				other := newTestManager(t)
				pm = other
			case "mode":
				if runtime.GOOS == "windows" {
					t.Skip("Unix file mode semantics")
				}
				require.NoError(t, os.Chmod(pm.stateRoot.ResolvePath(name), 0644))
			}
			require.NoError(t, pm.stateRoot.WriteFile(name, proof, 0600))
			_, err = pm.readArchiveRecovery("flux")
			assert.Error(t, err)
			assert.Error(t, pm.guardArchiveRecovery("flux"))
			_, err = pm.reconcileArchiveRecoveries()
			assert.Error(t, err, "invalid proof must fail closed before automatic loading")
			assert.Empty(t, pm.records)
		})
	}
}

func TestArchiveRecovery_PrepareRefusesUnknownCanonicalAndExistingMarker(t *testing.T) {
	pm, recovery := archiveRecoveryFixture(t, true)
	proof, err := pm.stateRoot.ReadFile(".archive-recovery-flux.json")
	require.NoError(t, err)
	_, err = pm.prepareArchiveRecovery("flux", recovery.Stage, recovery.Previous, recovery.Candidate)
	assert.Error(t, err, "a transaction must never adopt an existing recovery marker")
	after, err := pm.stateRoot.ReadFile(".archive-recovery-flux.json")
	require.NoError(t, err)
	assert.Equal(t, proof, after)
	require.NoError(t, pm.stateRoot.Remove(".archive-recovery-flux.json"))
	_, err = pm.prepareArchiveRecovery("flux", recovery.Stage, nil, recovery.Candidate)
	assert.Error(t, err, "an existing directory without previous inventory is not ours to replace")
	assert.NoFileExists(t, pm.stateRoot.ResolvePath(".archive-recovery-flux.json"))
}
