package plugin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"

	"go.opentelemetry.io/otel/attribute"
	"gopkg.in/yaml.v3"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
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
//
//nolint:nonamedreturns // Deferred telemetry records the publication state and error.
func (pm *pluginManager) commitArchiveInventory(
	ctx context.Context, recovery *archiveRecovery,
) (stateWritten bool, err error) {
	ctx, span := installSpanChild(ctx, "plugin.archive.commit", recovery.ID)
	defer func() {
		span.SetAttributes(attribute.Bool("state_written", stateWritten))
		installSpanEnd(span, err)
	}()
	stateMu.Lock()
	defer stateMu.Unlock()
	if err = pm.validateArchiveRecovery(recovery); err != nil {
		return false, err
	}
	installSpanPhase(ctx, "validated")
	if err = pm.writePluginStateRecords(pm.pluginStateSnapshot(recovery.ID)); err != nil {
		return false, err
	}
	stateWritten = true
	installSpanPhase(ctx, "state_written")
	err = pm.markArchiveCommitted(recovery)
	if err == nil {
		installSpanPhase(ctx, "marker_committed")
	}
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
	record.ReleaseChannel = previous.ReleaseChannel
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

//nolint:gocognit,funlen // Recovery handles distinct runtime and ownership states.
func (pm *pluginManager) restoreArchiveRuntime(
	ctx context.Context, recovery *archiveRecovery, original *plugintypes.PluginRecord, wasManaged, unloaded bool,
) (err error) {
	previous := recovery.Previous
	if previous == nil {
		return nil
	}
	ctx, span := installSpanChild(ctx, "plugin.archive.recover", recovery.ID,
		attribute.Bool("was_managed", wasManaged),
		attribute.Bool("previous_running", previous.Phase == lifecycle.PhaseRunning))
	defer func() { installSpanEnd(span, err) }()
	installedAt := previous.InstalledAt
	if original != nil {
		installedAt = original.InstalledAt
	}
	if err := pm.retireInactiveArchiveRuntime(recovery); err != nil {
		return err
	}
	installSpanPhase(ctx, "inactive_runtime_retired")
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
			installSpanPhase(ctx, "resume_original_backend")
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
			pm.registerStateObserver(recovery.ID, resumed.StateMachine)
			pm.recordsMu.Lock()
			pm.records[recovery.ID] = resumed
			pm.recordsMu.Unlock()
			return nil
		}
		installSpanPhase(ctx, "reload_original")
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
	pm.installLogger().Errorw(pm.installBaseContext(), "plugin archive rollback requires recovery",
		"pluginID", recovery.ID, "errorClass", telemetryutil.ErrorClass(cause))
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
	pm.installLogger().Errorw(pm.installBaseContext(), "plugin archive publication requires recovery",
		"pluginID", recovery.ID, "committed", recovery.committed, "errorClass", telemetryutil.ErrorClass(cause))
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

// moveArchiveState transfers directory capabilities, not copies of their bytes.
// Cached appstate roots and controller-held handles must keep naming the same
// inodes after either publication or rollback.
func (pm *pluginManager) moveArchiveState(ctx context.Context, recovery *archiveRecovery, from, to string) error {
	if err := pm.validateArchiveRecovery(recovery); err != nil {
		return err
	}
	for _, name := range []string{"data", "store"} {
		source := filepath.Join(from, name)
		if _, err := pm.pluginsRoot.DirectoryIdentity(source); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return err
		}
		if err := pm.pluginsRoot.RenameDirectoryNoReplace(source, filepath.Join(to, name)); err != nil {
			return err
		}
		installSpanPhase(ctx, "moved_"+name)
	}
	return errors.Join(syncUninstallDirectory(pm.pluginsRoot, from), syncUninstallDirectory(pm.pluginsRoot, to))
}

//nolint:gocognit // Rollback preserves ownership checks across each transaction phase.
func (pm *pluginManager) rollbackArchive(
	ctx context.Context, recovery *archiveRecovery, original *plugintypes.PluginRecord,
	wasManaged, oldUnloaded, candidatePublished bool, cause error,
) (result error) {
	ctx, span := installSpanChild(ctx, "plugin.archive.rollback", recovery.ID,
		attribute.Bool("candidate_published", candidatePublished), attribute.Bool("old_unloaded", oldUnloaded))
	// The rollback span reports the rollback's own outcome, not the install cause it answers.
	defer func() { installSpanEnd(span, result) }()
	log := pm.installLogger()
	log.Warnw(ctx, "plugin archive rollback started", "pluginID", recovery.ID, "candidatePublished", candidatePublished,
		"errorClass", telemetryutil.ErrorClass(cause))
	fail := func(step string, err error) error {
		log.Warnw(ctx, "plugin archive rollback step failed", "pluginID", recovery.ID, "step", step,
			"errorClass", telemetryutil.ErrorClass(err))
		span.SetAttributes(attribute.String("failed_step", step))
		return pm.archiveRecoveryFailure(recovery, errors.Join(cause, err))
	}
	if candidatePublished {
		installSpanPhase(ctx, "unload_candidate")
		if err := pm.unloadArchivePlugin(recovery); err != nil {
			return fail("unload_candidate", err)
		}
	}
	if err := pm.validateArchiveRecovery(recovery); err != nil {
		return fail("validate", err)
	}
	canonical, err := pm.pluginsRoot.DirectoryIdentity(recovery.ID)
	if err == nil && canonical == recovery.CandidateIdentity {
		if recovery.PreviousIdentity != (appstate.FilesystemIdentity{}) {
			installSpanPhase(ctx, "move_state_to_previous")
			if err = pm.moveArchiveState(ctx, recovery, recovery.ID, filepath.Join(recovery.Stage, "previous")); err != nil {
				return fail("move_state_to_previous", err)
			}
		}
		installSpanPhase(ctx, "stage_candidate")
		if err = pm.pluginsRoot.RenameDirectoryNoReplace(recovery.ID, filepath.Join(recovery.Stage, "candidate")); err != nil {
			return fail("stage_candidate", err)
		}
	} else if err != nil && !os.IsNotExist(err) {
		return fail("identify_canonical", err)
	}
	if recovery.PreviousIdentity != (appstate.FilesystemIdentity{}) {
		previous := filepath.Join(recovery.Stage, "previous")
		if _, err = pm.pluginsRoot.DirectoryIdentity(previous); err == nil {
			installSpanPhase(ctx, "restore_previous")
			if err = pm.pluginsRoot.RenameDirectoryNoReplace(previous, recovery.ID); err != nil {
				return fail("restore_previous", err)
			}
		} else if !os.IsNotExist(err) {
			return fail("identify_previous", err)
		}
		actual, identityErr := pm.pluginsRoot.DirectoryIdentity(recovery.ID)
		if identityErr != nil || actual != recovery.PreviousIdentity {
			return fail("verify_previous",
				errors.Join(identityErr, errors.New("original archive installation could not be restored")))
		}
	}
	installSpanPhase(ctx, "restore_runtime")
	if err = pm.restoreArchiveRuntime(ctx, recovery, original, wasManaged, oldUnloaded); err != nil {
		return fail("restore_runtime", err)
	}
	installSpanPhase(ctx, "restore_persistence")
	if err := pm.restoreArchivePersistence(recovery.ID); err != nil {
		return fail("restore_persistence", err)
	}
	installSpanPhase(ctx, "dispose_stage")
	if err := pm.disposeArchiveStage(recovery); err != nil {
		return fail("dispose_stage", err)
	}
	pm.endArchivePersistence(recovery.ID)
	return cause
}

//nolint:gocognit,gocyclo,cyclop,funlen,nonamedreturns // Transaction and deferred telemetry require this structure.
func (pm *pluginManager) installArchiveCandidate(
	ctx context.Context, path string, metadata *config.PluginMeta, version, channel string,
) (statePublished bool, err error) {
	if err := pm.guardProductOwned(metadata.ID); err != nil {
		return false, err
	}
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
	extractCtx, extractSpan := installSpanChild(ctx, "plugin.Extract", metadata.ID)
	err = unpackPluginArchive(path, pm.pluginsRoot.ResolvePath(candidate))
	installSpanEnd(extractSpan, err)
	if err != nil {
		pm.installLogger().Warnw(extractCtx, "plugin archive extraction failed", "pluginID", metadata.ID,
			"errorClass", telemetryutil.ErrorClass(err))
		return false, apperror.Wrap(err, apperror.TypePluginInstallFailed, http.StatusInternalServerError, "Failed to unpack plugin package")
	}
	// Runtime state belongs to the installed plugin, never to package contents.
	// Resolve reserved paths through the destination filesystem so case aliases
	// are rejected on case-insensitive volumes without banning distinct names.
	for _, name := range []string{"data", "store"} {
		if _, statErr := pm.pluginsRoot.Stat(filepath.Join(candidate, name)); statErr == nil {
			return false, fmt.Errorf("plugin package contains reserved runtime directory %q", name)
		} else if !os.IsNotExist(statErr) {
			return false, statErr
		}
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
	if version != "" {
		// Registry verification already authenticated the downloaded archive.
		// Change only the private extracted metadata, never the signed archive.
		if err = persistArchiveVersion(filepath.Join(pm.pluginsRoot.ResolvePath(candidate), pluginMetaFile), version); err != nil {
			return false, apperror.Internal(err, "Failed to persist marketplace plugin version")
		}
		metadata.Version = version
	}
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
			if closeErr := marker.Close(); closeErr != nil {
				pm.installLogger().Debugw(ctx, "archive recovery marker close failed", "pluginID", metadata.ID,
					"errorClass", telemetryutil.ErrorClass(closeErr))
			}
		}
		preserveStage = !os.IsNotExist(markerErr)
		return false, apperror.Wrap(prepareErr, apperror.TypePluginInstallFailed, http.StatusInternalServerError, "Failed to prepare owned archive recovery")
	}
	preserveStage = true // All subsequent cleanup requires this captured proof.
	ctx, commitSpan := installSpanChild(ctx, "plugin.Commit", metadata.ID)
	defer func() {
		commitSpan.SetAttributes(attribute.Bool("state_published", statePublished))
		installSpanEnd(commitSpan, err)
	}()
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
		return false, pm.rollbackArchive(ctx, recovery, original, wasManaged, false, false, err)
	}
	installSpanPhase(ctx, "previous_unloaded")
	if err = pm.validateArchiveRecovery(recovery); err != nil {
		return false, pm.rollbackArchive(ctx, recovery, original, wasManaged, true, false, err)
	}
	if recovery.PreviousIdentity != (appstate.FilesystemIdentity{}) {
		if err = pm.pluginsRoot.RenameDirectoryNoReplace(metadata.ID, filepath.Join(stage, "previous")); err != nil {
			return false, pm.rollbackArchive(ctx, recovery, original, wasManaged, true, false, err)
		}
		installSpanPhase(ctx, "previous_staged")
	}
	if err = pm.validateArchiveRecovery(recovery); err != nil {
		return false, pm.rollbackArchive(ctx, recovery, original, wasManaged, true, false, err)
	}
	if err = pm.pluginsRoot.RenameDirectoryNoReplace(candidate, metadata.ID); err != nil {
		return false, pm.rollbackArchive(ctx, recovery, original, wasManaged, true, false, err)
	}
	installSpanPhase(ctx, "candidate_published")
	if recovery.PreviousIdentity != (appstate.FilesystemIdentity{}) {
		if err = pm.moveArchiveState(ctx, recovery, filepath.Join(stage, "previous"), metadata.ID); err != nil {
			return false, pm.rollbackArchive(ctx, recovery, original, wasManaged, true, false, err)
		}
	}
	if _, err = pm.LoadPlugin(metadata.ID, &LoadPluginOptions{archive: recovery}); err != nil {
		cause := apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "Failed to load plugin after install")
		return false, pm.rollbackArchive(ctx, recovery, original, wasManaged, true, true, cause)
	}
	pm.recordsMu.Lock()
	if record := pm.records[metadata.ID]; record != nil {
		if channel != "" {
			record.ReleaseChannel = channel
		} else if previous != nil {
			record.ReleaseChannel = previous.ReleaseChannel
		}
	}
	pm.recordsMu.Unlock()
	installSpanPhase(ctx, "candidate_loaded")
	stateWritten, commitErr := pm.commitArchiveInventory(ctx, recovery)
	if recovery.committed {
		pm.emitter.Emit(EventInventoryChanged)
		pm.emitter.Emit(EventInstallFinished, metadata)
	}
	if commitErr != nil {
		if stateWritten {
			return true, pm.archivePublicationFailure(recovery, commitErr)
		}
		pm.emitter.Emit(EventStateWriteError, StateWriteErrorPayload{PluginID: metadata.ID, Detail: commitErr.Error()})
		return false, pm.rollbackArchive(ctx, recovery, original, wasManaged, true, true,
			apperror.Internal(commitErr, "Failed to persist plugin state").WithInstance(metadata.ID))
	}
	if err = pm.disposeArchiveStage(recovery); err != nil {
		return true, pm.archivePublicationFailure(recovery, err)
	}
	return true, nil
}

// Preserve unknown manifest fields while making the registry version durable
// before the candidate can replace the canonical installation.
func persistArchiveVersion(path, version string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var document yaml.Node
	if err = yaml.Unmarshal(data, &document); err != nil {
		return err
	}
	if len(document.Content) != 1 || document.Content[0].Kind != yaml.MappingNode {
		return errors.New("plugin metadata must be a mapping")
	}
	mapping := document.Content[0]
	found := false
	for i := 0; i < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == "version" {
			mapping.Content[i+1] = &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: version}
			found = true
			break
		}
	}
	if !found {
		mapping.Content = append(mapping.Content,
			&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "version"},
			&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: version})
	}
	data, err = yaml.Marshal(&document)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, 0)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(data)
	syncErr := file.Sync()
	return errors.Join(writeErr, syncErr, file.Close())
}
