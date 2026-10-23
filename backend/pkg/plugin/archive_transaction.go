package plugin

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Only the transaction holding the original marker identity may cross its
// recovery barrier. Public loads, source changes and removals cannot adopt it.
func (pm *pluginManager) checkArchiveAccess(id string, recovery *archiveRecovery) error {
	if recovery == nil {
		return pm.guardArchiveRecovery(id)
	}
	if recovery.ID != id {
		return errors.New("archive transaction identity mismatch")
	}
	file, err := pm.openArchiveRecovery(recovery, os.O_RDONLY)
	if err != nil {
		return err
	}
	return file.Close()
}

func (pm *pluginManager) checkArchiveLoad(id string, opts *LoadPluginOptions) error {
	var recovery *archiveRecovery
	if opts != nil {
		recovery = opts.archive
	}
	if err := pm.checkArchiveAccess(id, recovery); err != nil || recovery == nil {
		return err
	}
	if err := pm.validateArchiveRecovery(recovery); err != nil {
		return err
	}
	expected := recovery.CandidateIdentity
	if opts.archiveRestore {
		if recovery.committed {
			return errors.New("committed archive backup must never be restored")
		}
		expected = recovery.PreviousIdentity
	}
	actual, err := pm.pluginsRoot.DirectoryIdentity(id)
	if err != nil || expected == (appstate.FilesystemIdentity{}) || actual != expected {
		return errors.Join(err, errors.New("archive load does not name its captured installation"))
	}
	return nil
}

func (pm *pluginManager) beginArchivePersistence(id string) error {
	stateMu.Lock()
	defer stateMu.Unlock()
	states, err := pm.readPluginStateJSONLocked()
	if err != nil {
		return err
	}
	var previous *plugintypes.PluginStateRecord
	for i := range states {
		if states[i].ID == id {
			previous = &states[i]
			break
		}
	}
	pm.recordsMu.Lock()
	defer pm.recordsMu.Unlock()
	if _, pending := pm.pendingArchiveState[id]; pending {
		return errors.New("plugin already has a pending archive publication")
	}
	if pm.pendingArchiveState == nil {
		pm.pendingArchiveState = make(map[string]*plugintypes.PluginStateRecord)
	}
	pm.pendingArchiveState[id] = previous
	return nil
}

func (pm *pluginManager) endArchivePersistence(id string) {
	stateMu.Lock()
	defer stateMu.Unlock()
	pm.recordsMu.Lock()
	delete(pm.pendingArchiveState, id)
	pm.recordsMu.Unlock()
}

// Usually a rejected commit never changed the durable preimage. If rename
// succeeded before a later sync failed, restore only this transaction's state;
// never roll another plugin's legitimate update back with a whole-file copy.
func (pm *pluginManager) restoreArchivePersistence(id string) error {
	stateMu.Lock()
	defer stateMu.Unlock()
	states, err := pm.readPluginStateJSONLocked()
	if err != nil {
		return err
	}
	pm.recordsMu.RLock()
	previous, pending := pm.pendingArchiveState[id]
	pm.recordsMu.RUnlock()
	if !pending {
		return errors.New("archive durable preimage is unavailable")
	}
	matches := previous == nil
	for _, state := range states {
		if state.ID == id {
			matches = previous != nil && reflect.DeepEqual(*previous, state)
			break
		}
	}
	if matches {
		return nil
	}
	return pm.writePluginStateRecords(pm.pluginStateSnapshot(""))
}

// A successful state write followed by a marker failure is not reversible:
// the committed byte may already be visible despite a failed Sync. The caller
// must retain both installations and report explicit committed recovery state.
func (pm *pluginManager) commitArchiveInventory(recovery *archiveRecovery) (stateWritten bool, err error) {
	stateMu.Lock()
	defer stateMu.Unlock()
	if err = pm.validateArchiveRecovery(recovery); err != nil {
		return false, err
	}
	if err = pm.writePluginStateRecords(pm.pluginStateSnapshot(recovery.ID)); err != nil {
		return false, err
	}
	stateWritten = true
	err = pm.markArchiveCommitted(recovery)
	pm.recordsMu.Lock()
	delete(pm.pendingArchiveState, recovery.ID)
	pm.recordsMu.Unlock()
	return stateWritten, err
}

func (pm *pluginManager) preflightArchive(metadata config.PluginMeta, candidate string) error {
	location := pm.pluginsRoot.ResolvePath(candidate)
	if err := validateForLoad(metadata.ID, metadata, location, false); err != nil {
		return err
	}
	if !metadata.HasBackendCapabilities() {
		return nil
	}
	manifest := os.Getenv(devcontract.WorkspaceEnvironment)
	if manifest == "" {
		return nil
	}
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{
		EnvironmentManifest: manifest,
		StateRoot:           pm.stateRoot.ResolvePath(""),
	})
	if err != nil {
		return err
	}
	return instance.VerifyPluginArtifact(workspace, metadata.ID, filepath.Join(location, "bin", "plugin"))
}

// Unlike public unload, this private path may stop its captured runtime while
// a recovery marker exists. It never removes or adopts a canonical directory.
func (pm *pluginManager) unloadArchivePlugin(recovery *archiveRecovery) error {
	if err := pm.checkArchiveAccess(recovery.ID, recovery); err != nil {
		return err
	}
	if pm.healthChecker != nil {
		pm.healthChecker.CancelRecovery(recovery.ID)
	}
	if pm.devServerMgr != nil && pm.devServerMgr.IsManaged(recovery.ID) {
		if err := pm.devServerMgr.StopDevServer(recovery.ID); err != nil {
			return apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusConflict,
				"Failed to stop existing dev server").WithInstance(recovery.ID)
		}
	}
	ops := pm.pluginOpsLock(recovery.ID)
	ops.Lock()
	defer ops.Unlock()
	if err := pm.checkArchiveAccess(recovery.ID, recovery); err != nil {
		return err
	}
	if err := pm.unloadPluginLocked(recovery.ID); err != nil {
		return apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusConflict,
			"Failed to unload existing plugin").WithInstance(recovery.ID)
	}
	return nil
}

func restoreArchiveRecordFields(record *plugintypes.PluginRecord, previous *plugintypes.PluginStateRecord) {
	record.Metadata = previous.Metadata
	record.Phase, record.Enabled = previous.Phase, previous.Enabled
	record.DevMode, record.DevPath = previous.DevMode, previous.DevPath
	record.LastError, record.ErrorCount = previous.LastError, previous.ErrorCount
	record.InstalledAt = previous.InstalledAt
}

func archiveRuntimeUsable(record *plugintypes.PluginRecord) bool {
	return record != nil && (!record.Metadata.HasBackendCapabilities() ||
		(record.Backend != nil && record.Backend.Healthy() && !record.Backend.Exited()))
}

// A failed controller shutdown can leave a Running record after its process has
// exited. Retire that false fast path under the normal lifecycle lock so rollback
// must construct a genuinely live original backend.
func (pm *pluginManager) retireInactiveArchiveRuntime(recovery *archiveRecovery) error {
	ops := pm.pluginOpsLock(recovery.ID)
	ops.Lock()
	defer ops.Unlock()
	if err := pm.checkArchiveAccess(recovery.ID, recovery); err != nil {
		return err
	}
	pm.recordsMu.RLock()
	record := pm.records[recovery.ID]
	pm.recordsMu.RUnlock()
	if record == nil || archiveRuntimeUsable(record) {
		return nil
	}
	pm.recordsMu.Lock()
	stopped := pm.records[recovery.ID] == record && record.Phase == lifecycle.PhaseRunning
	if stopped {
		record.Phase = lifecycle.PhaseStopped
	}
	pm.recordsMu.Unlock()
	if stopped && record.StateMachine != nil {
		record.StateMachine.ForcePhase(lifecycle.PhaseStopped, "archive rollback retired an exited backend")
	}
	return nil
}

func (pm *pluginManager) restoreArchiveRuntime(recovery *archiveRecovery, original *plugintypes.PluginRecord, wasManaged, unloaded bool) error {
	previous := recovery.Previous
	if previous == nil {
		return nil
	}
	installedAt := previous.InstalledAt
	if original != nil {
		installedAt = original.InstalledAt
	}
	if err := pm.retireInactiveArchiveRuntime(recovery); err != nil {
		return err
	}
	if wasManaged && previous.DevMode {
		state, err := pm.devServerMgr.StartDevServerForPath(recovery.ID, previous.DevPath)
		if err != nil {
			return err
		}
		if previous.Phase == lifecycle.PhaseRunning &&
			(state.GoStatus == devserver.DevProcessStatusError || state.ViteStatus == devserver.DevProcessStatusError) {
			return fmt.Errorf("original managed source did not recover: %s", state.LastError)
		}
	}
	if previous.Phase == lifecycle.PhaseRunning {
		if !unloaded && archiveRuntimeUsable(original) {
			// An unload refusal may have stopped some controllers without killing
			// the old backend. Resume them using that same original runtime.
			resumed := plugintypes.NewPluginRecord(recovery.ID, previous.Metadata, previous.Phase)
			restoreArchiveRecordFields(resumed, previous)
			resumed.InstalledAt, resumed.Backend = installedAt, original.Backend
			if resumed.Backend != nil {
				if err := pm.startPlugin(resumed, resumed.Backend); err != nil {
					return err
				}
			}
			if !archiveRuntimeUsable(resumed) {
				return errors.New("original backend exited while its controllers were being restored")
			}
			pm.registerStateObserver(resumed.StateMachine)
			pm.recordsMu.Lock()
			pm.records[recovery.ID] = resumed
			pm.recordsMu.Unlock()
			return nil
		}
		_, err := pm.LoadPlugin(recovery.ID, &LoadPluginOptions{
			ExistingState: previous, archive: recovery, archiveRestore: true,
		})
		if err != nil {
			return err
		}
		pm.recordsMu.RLock()
		restored := pm.records[recovery.ID]
		pm.recordsMu.RUnlock()
		if !archiveRuntimeUsable(restored) {
			return errors.New("original backend is not live after archive rollback")
		}
		pm.recordsMu.Lock()
		restoreArchiveRecordFields(pm.records[recovery.ID], previous)
		pm.records[recovery.ID].InstalledAt = installedAt
		pm.recordsMu.Unlock()
		return nil
	}
	record := plugintypes.NewPluginRecord(recovery.ID, previous.Metadata, previous.Phase)
	restoreArchiveRecordFields(record, previous)
	record.InstalledAt = installedAt
	pm.recordsMu.Lock()
	pm.records[recovery.ID] = record
	pm.recordsMu.Unlock()
	return nil
}

// The marker's commit bit must be durable before deleting previous bytes. A
// rejected candidate is disposable; an uncommitted original never is.
func (pm *pluginManager) disposeArchiveStage(recovery *archiveRecovery) error {
	if err := pm.validateArchiveRecovery(recovery); err != nil {
		return err
	}
	previous := filepath.Join(recovery.Stage, "previous")
	if _, err := pm.pluginsRoot.DirectoryIdentity(previous); err == nil {
		if !recovery.committed {
			return errors.New("refusing to dispose of an uncommitted original installation")
		}
		if err := pm.pluginsRoot.RemoveAll(previous); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := pm.validateArchiveRecovery(recovery); err != nil {
		return err
	}
	candidate := filepath.Join(recovery.Stage, "candidate")
	if _, err := pm.pluginsRoot.DirectoryIdentity(candidate); err == nil {
		if err := pm.pluginsRoot.RemoveAll(candidate); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := pm.validateArchiveRecovery(recovery); err != nil {
		return err
	}
	if err := pm.pluginsRoot.Remove(recovery.Stage); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := syncUninstallDirectory(pm.pluginsRoot, "."); err != nil {
		return err
	}
	return pm.removeArchiveRecoveryMarker(recovery)
}

func (pm *pluginManager) archiveRecoveryFailure(recovery *archiveRecovery, cause error) error {
	pm.endArchivePersistence(recovery.ID)
	pm.recordsMu.Lock()
	record := pm.records[recovery.ID]
	if record == nil || record.Backend == nil {
		record = plugintypes.NewPluginRecord(recovery.ID, recovery.Candidate, lifecycle.PhaseFailed)
		if recovery.Previous != nil {
			restoreArchiveRecordFields(record, recovery.Previous)
		}
	}
	record.Phase = lifecycle.PhaseFailed
	record.LastError = fmt.Sprintf("archive replacement requires recovery at %s: %v", pm.pluginsRoot.ResolvePath(recovery.Stage), cause)
	pm.records[recovery.ID] = record
	pm.recordsMu.Unlock()
	if record.StateMachine != nil {
		record.StateMachine.ForcePhase(lifecycle.PhaseFailed, "archive rollback requires recovery")
	}
	persistErr := pm.persistPluginOperation(recovery.ID)
	detail := fmt.Errorf("archive replacement requires recovery at %s: %w", pm.pluginsRoot.ResolvePath(recovery.Stage), errors.Join(cause, persistErr))
	return apperror.Wrap(detail, apperror.TypePluginInstallFailed,
		http.StatusInternalServerError, "Plugin archive rollback requires recovery").WithInstance(recovery.ID).
		WithSuggestions("The original installation is retained in the private recovery directory; do not replace or delete unrelated canonical entries.")
}

func (pm *pluginManager) archivePublicationFailure(recovery *archiveRecovery, cause error) error {
	pm.endArchivePersistence(recovery.ID)
	errorType := apperror.TypePluginCommitUncertain
	title := "Plugin publication requires recovery"
	description := "candidate inventory was written, but logical commit could not be confirmed; retain both installations and recovery proof"
	if recovery.committed {
		errorType = apperror.TypePluginCommittedCleanupPending
		title = "Plugin committed; backup cleanup pending"
		description = "candidate commit is confirmed; do not restore the previous backup"
	}
	detail := fmt.Errorf("%s; recovery files at %s: %w", description, pm.pluginsRoot.ResolvePath(recovery.Stage), cause)
	pm.recordsMu.Lock()
	if record := pm.records[recovery.ID]; record != nil {
		record.LastError = detail.Error()
	}
	pm.recordsMu.Unlock()
	persistErr := pm.persistPluginOperation(recovery.ID)
	return apperror.Wrap(errors.Join(detail, persistErr), errorType,
		http.StatusInternalServerError, title).WithInstance(recovery.ID)
}

func (pm *pluginManager) rollbackArchive(recovery *archiveRecovery, original *plugintypes.PluginRecord, wasManaged, oldUnloaded, candidatePublished bool, cause error) error {
	if candidatePublished {
		if err := pm.unloadArchivePlugin(recovery); err != nil {
			return pm.archiveRecoveryFailure(recovery, errors.Join(cause, err))
		}
	}
	if err := pm.validateArchiveRecovery(recovery); err != nil {
		return pm.archiveRecoveryFailure(recovery, errors.Join(cause, err))
	}
	canonical, err := pm.pluginsRoot.DirectoryIdentity(recovery.ID)
	if err == nil && canonical == recovery.CandidateIdentity {
		if err = pm.pluginsRoot.RenameDirectoryNoReplace(recovery.ID, filepath.Join(recovery.Stage, "candidate")); err != nil {
			return pm.archiveRecoveryFailure(recovery, errors.Join(cause, err))
		}
	} else if err != nil && !os.IsNotExist(err) {
		return pm.archiveRecoveryFailure(recovery, errors.Join(cause, err))
	}
	if recovery.PreviousIdentity != (appstate.FilesystemIdentity{}) {
		previous := filepath.Join(recovery.Stage, "previous")
		if _, err = pm.pluginsRoot.DirectoryIdentity(previous); err == nil {
			if err = pm.pluginsRoot.RenameDirectoryNoReplace(previous, recovery.ID); err != nil {
				return pm.archiveRecoveryFailure(recovery, errors.Join(cause, err))
			}
		} else if !os.IsNotExist(err) {
			return pm.archiveRecoveryFailure(recovery, errors.Join(cause, err))
		}
		actual, identityErr := pm.pluginsRoot.DirectoryIdentity(recovery.ID)
		if identityErr != nil || actual != recovery.PreviousIdentity {
			return pm.archiveRecoveryFailure(recovery, errors.Join(cause, identityErr, errors.New("original archive installation could not be restored")))
		}
	}
	if err := pm.restoreArchiveRuntime(recovery, original, wasManaged, oldUnloaded); err != nil {
		return pm.archiveRecoveryFailure(recovery, errors.Join(cause, err))
	}
	if err := pm.restoreArchivePersistence(recovery.ID); err != nil {
		return pm.archiveRecoveryFailure(recovery, errors.Join(cause, err))
	}
	if err := pm.disposeArchiveStage(recovery); err != nil {
		return pm.archiveRecoveryFailure(recovery, errors.Join(cause, err))
	}
	pm.endArchivePersistence(recovery.ID)
	return cause
}

func (pm *pluginManager) installArchiveCandidate(path string, metadata *config.PluginMeta) (statePublished bool, err error) {
	stage, err := pm.pluginsRoot.MkdirTemp(".archive-" + metadata.ID + "-")
	if err != nil {
		return false, apperror.Internal(err, "Failed to create private archive staging")
	}
	stageIdentity, err := pm.pluginsRoot.DirectoryIdentity(stage)
	if err != nil {
		return false, err
	}
	preserveStage := false
	defer func() {
		if preserveStage {
			return
		}
		actual, identityErr := pm.pluginsRoot.DirectoryIdentity(stage)
		if identityErr != nil || actual != stageIdentity {
			err = errors.Join(err, identityErr, errors.New("archive staging identity changed; refusing cleanup"))
			return
		}
		err = errors.Join(err, pm.pluginsRoot.RemoveAll(stage))
	}()
	candidate := filepath.Join(stage, "candidate")
	if err = pm.pluginsRoot.MkdirAll(candidate, 0700); err != nil {
		return false, err
	}
	if err = unpackPluginArchive(path, pm.pluginsRoot.ResolvePath(candidate)); err != nil {
		return false, apperror.Wrap(err, apperror.TypePluginInstallFailed, http.StatusInternalServerError, "Failed to unpack plugin package")
	}
	actualMetadata, metadataErr := sdktypes.LoadPluginMetadata(pm.pluginsRoot.ResolvePath(candidate))
	if metadataErr != nil {
		return false, apperror.Wrap(metadataErr, apperror.TypePluginInstallFailed,
			http.StatusUnprocessableEntity, "Invalid extracted plugin metadata")
	}
	if actualMetadata.ID != metadata.ID {
		return false, apperror.New(apperror.TypeValidation, http.StatusUnprocessableEntity,
			"Extracted plugin identity changed", "The extracted plugin ID does not match the requested archive transaction.")
	}
	// The loader consumes the extracted file, not an earlier tar entry.
	// All capability, trust, publication and event decisions use that same data.
	*metadata = actualMetadata
	pm.emitter.Emit(EventInstallStarted, metadata)
	if err = pm.preflightArchive(*metadata, candidate); err != nil {
		return false, apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "Plugin archive preflight rejected")
	}

	ops := pm.pluginOpsLock(metadata.ID)
	ops.Lock()
	pm.recordsMu.RLock()
	original := pm.records[metadata.ID]
	var previous *plugintypes.PluginStateRecord
	if original != nil {
		state := original.ToStateRecord()
		previous = &state
	}
	pm.recordsMu.RUnlock()
	wasManaged := pm.devServerMgr != nil && pm.devServerMgr.IsManaged(metadata.ID)
	if err = pm.beginArchivePersistence(metadata.ID); err != nil {
		ops.Unlock()
		return false, err
	}
	recovery, prepareErr := pm.prepareArchiveRecovery(metadata.ID, stage, previous, *metadata)
	ops.Unlock()
	if prepareErr != nil {
		pm.endArchivePersistence(metadata.ID)
		marker, _, markerErr := pm.stateRoot.OpenPrivateFile(archiveRecoveryName(metadata.ID), os.O_RDONLY)
		if markerErr == nil {
			_ = marker.Close()
		}
		preserveStage = !os.IsNotExist(markerErr)
		return false, apperror.Wrap(prepareErr, apperror.TypePluginInstallFailed, http.StatusInternalServerError, "Failed to prepare owned archive recovery")
	}
	preserveStage = true // All subsequent cleanup requires this captured proof.
	if previous != nil && previous.Phase == lifecycle.PhaseRunning && recovery.PreviousIdentity == (appstate.FilesystemIdentity{}) {
		cause := apperror.New(apperror.TypePluginInstallFailed, http.StatusConflict,
			"Original installation is unavailable", "Refusing to stop a running plugin without a complete installation to preserve.").WithInstance(metadata.ID)
		if cleanupErr := pm.disposeArchiveStage(recovery); cleanupErr != nil {
			return false, pm.archiveRecoveryFailure(recovery, errors.Join(cause, cleanupErr))
		}
		pm.endArchivePersistence(metadata.ID)
		return false, cause
	}
	if err = pm.unloadArchivePlugin(recovery); err != nil {
		return false, pm.rollbackArchive(recovery, original, wasManaged, false, false, err)
	}
	if err = pm.validateArchiveRecovery(recovery); err != nil {
		return false, pm.rollbackArchive(recovery, original, wasManaged, true, false, err)
	}
	if recovery.PreviousIdentity != (appstate.FilesystemIdentity{}) {
		if err = pm.pluginsRoot.RenameDirectoryNoReplace(metadata.ID, filepath.Join(stage, "previous")); err != nil {
			return false, pm.rollbackArchive(recovery, original, wasManaged, true, false, err)
		}
	}
	if err = pm.validateArchiveRecovery(recovery); err != nil {
		return false, pm.rollbackArchive(recovery, original, wasManaged, true, false, err)
	}
	if err = pm.pluginsRoot.RenameDirectoryNoReplace(candidate, metadata.ID); err != nil {
		return false, pm.rollbackArchive(recovery, original, wasManaged, true, false, err)
	}
	if _, err = pm.LoadPlugin(metadata.ID, &LoadPluginOptions{archive: recovery}); err != nil {
		cause := apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "Failed to load plugin after install")
		return false, pm.rollbackArchive(recovery, original, wasManaged, true, true, cause)
	}
	stateWritten, commitErr := pm.commitArchiveInventory(recovery)
	if recovery.committed {
		pm.emitter.Emit(EventInventoryChanged)
		pm.emitter.Emit(EventInstallFinished, metadata)
	}
	if commitErr != nil {
		if stateWritten {
			return true, pm.archivePublicationFailure(recovery, commitErr)
		}
		pm.emitter.Emit(EventStateWriteError, StateWriteErrorPayload{PluginID: metadata.ID, Detail: commitErr.Error()})
		return false, pm.rollbackArchive(recovery, original, wasManaged, true, true,
			apperror.Internal(commitErr, "Failed to persist plugin state").WithInstance(metadata.ID))
	}
	if err = pm.disposeArchiveStage(recovery); err != nil {
		return true, pm.archivePublicationFailure(recovery, err)
	}
	return true, nil
}
