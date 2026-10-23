package plugin

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdkstate "github.com/omniviewdev/plugin-sdk/pkg/state"
)

const archiveRecoveryPrefix = ".archive-recovery-"

// Only this byte may change in an existing marker. Publish and sync it through
// the validated marker FD before disposing of any previous-installation bytes.
const archiveRecoveryHeader = "{\"committed\":0,\"record\":"
const archiveCommittedOffset = len("{\"committed\":")

// archiveRecovery captures ownership before any installation is moved. Reading
// it never establishes ownership from a newly observed canonical or child path.
// Directory moves and disposal belong exclusively to the transaction caller.
type archiveRecovery struct {
	Version           int                            `json:"version"`
	ProfileRoot       string                         `json:"profileRoot"`
	ProfileIdentity   appstate.FilesystemIdentity    `json:"profileIdentity"`
	PluginsIdentity   appstate.FilesystemIdentity    `json:"pluginsIdentity"`
	StageIdentity     appstate.FilesystemIdentity    `json:"stageIdentity"`
	PreviousIdentity  appstate.FilesystemIdentity    `json:"previousIdentity"`
	CandidateIdentity appstate.FilesystemIdentity    `json:"candidateIdentity"`
	ID                string                         `json:"id"`
	Stage             string                         `json:"stage"`
	Previous          *plugintypes.PluginStateRecord `json:"previous"`
	Candidate         config.PluginMeta              `json:"candidate"`
	markerIdentity    appstate.FilesystemIdentity
	committed         bool
}

func archiveRecoveryName(id string) string {
	return archiveRecoveryPrefix + id + ".json"
}

func readArchiveRecoveryHeader(file *os.File) (bool, error) {
	var header [len(archiveRecoveryHeader)]byte
	if _, err := file.ReadAt(header[:], 0); err != nil {
		return false, err
	}
	phase := header[archiveCommittedOffset]
	if phase != '0' && phase != '1' {
		return false, errors.New("invalid archive recovery commit phase")
	}
	header[archiveCommittedOffset] = '0'
	if string(header[:]) != archiveRecoveryHeader {
		return false, errors.New("invalid archive recovery envelope")
	}
	return phase == '1', nil
}

func (pm *pluginManager) validateArchiveRecoveryRecord(recovery *archiveRecovery, id string) error {
	if recovery == nil {
		return errors.New("missing archive recovery record")
	}
	if err := sdkstate.ValidateComponent(id); err != nil {
		return err
	}
	if recovery.Version != 1 || recovery.ID != id || recovery.Candidate.ID != id ||
		filepath.Base(recovery.Stage) != recovery.Stage ||
		!strings.HasPrefix(recovery.Stage, ".archive-"+id+"-") || recovery.Stage == ".archive-"+id+"-" ||
		recovery.StageIdentity == (appstate.FilesystemIdentity{}) || recovery.CandidateIdentity == (appstate.FilesystemIdentity{}) ||
		recovery.StageIdentity == recovery.CandidateIdentity || recovery.PreviousIdentity == recovery.CandidateIdentity ||
		(recovery.PreviousIdentity != (appstate.FilesystemIdentity{}) && recovery.StageIdentity == recovery.PreviousIdentity) {
		return errors.New("archive recovery ownership does not match this plugin")
	}
	if recovery.Previous == nil {
		if recovery.PreviousIdentity != (appstate.FilesystemIdentity{}) {
			return errors.New("archive recovery has an original directory without previous inventory")
		}
	} else if recovery.Previous.ID != id || recovery.Previous.Metadata.ID != id {
		return errors.New("archive recovery previous inventory does not match this plugin")
	}
	profile, err := filepath.EvalSymlinks(pm.stateRoot.ResolvePath(""))
	if err != nil {
		return err
	}
	profileIdentity, err := pm.stateRoot.DirectoryIdentity(".")
	if err != nil {
		return err
	}
	pluginsIdentity, err := pm.pluginsRoot.DirectoryIdentity(".")
	if err != nil {
		return err
	}
	if recovery.ProfileRoot != profile || recovery.ProfileIdentity != profileIdentity || recovery.PluginsIdentity != pluginsIdentity {
		return errors.New("archive recovery ownership does not match this profile")
	}
	// A renamed held root must not validate a different object now occupying its
	// diagnostic pathname. All operations below still use the held capabilities.
	for _, root := range []*appstate.ScopedRoot{pm.stateRoot, pm.pluginsRoot} {
		held, statErr := root.Stat(".")
		if statErr != nil {
			return statErr
		}
		current, statErr := os.Stat(root.ResolvePath(""))
		if statErr != nil || !os.SameFile(held, current) {
			return errors.Join(statErr, errors.New("archive recovery root pathname no longer names its captured scope"))
		}
	}
	return nil
}

func (pm *pluginManager) decodeArchiveRecovery(id string, file *os.File, identity appstate.FilesystemIdentity) (*archiveRecovery, error) {
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() > 1<<20 || (runtime.GOOS != "windows" && info.Mode().Perm() != 0600) {
		return nil, errors.New("archive recovery marker is not a bounded 0600 file")
	}
	committed, err := readArchiveRecoveryHeader(file)
	if err != nil {
		return nil, err
	}
	var envelope struct {
		Committed uint8            `json:"committed"`
		Record    *archiveRecovery `json:"record"`
	}
	decoder := json.NewDecoder(io.NewSectionReader(file, 0, 1<<20))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&envelope); err != nil {
		return nil, fmt.Errorf("invalid archive recovery for %s: %w", id, err)
	}
	if envelope.Record == nil || envelope.Committed > 1 || committed != (envelope.Committed == 1) {
		return nil, errors.New("archive recovery commit phase changed or is invalid")
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		return nil, errors.New("archive recovery contains trailing data")
	}
	recovery := envelope.Record
	recovery.markerIdentity, recovery.committed = identity, committed
	if err = pm.validateArchiveRecoveryRecord(recovery, id); err != nil {
		return nil, err
	}
	return recovery, nil
}

// readArchiveRecovery validates the immutable proof, not the current layout.
// A valid proof with a foreign directory must still produce blocked inventory.
func (pm *pluginManager) readArchiveRecovery(id string) (*archiveRecovery, error) {
	if err := sdkstate.ValidateComponent(id); err != nil {
		return nil, err
	}
	file, identity, err := pm.stateRoot.OpenPrivateFile(archiveRecoveryName(id), os.O_RDONLY)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return pm.decodeArchiveRecovery(id, file, identity)
}

func (pm *pluginManager) prepareArchiveRecovery(id, stage string, previous *plugintypes.PluginStateRecord, candidate config.PluginMeta) (result *archiveRecovery, err error) {
	if err := sdkstate.ValidateComponent(id); err != nil {
		return nil, err
	}
	if err := pm.guardArchiveRecovery(id); err != nil {
		return nil, err
	}
	profile, err := filepath.EvalSymlinks(pm.stateRoot.ResolvePath(""))
	if err != nil {
		return nil, err
	}
	profileIdentity, err := pm.stateRoot.DirectoryIdentity(".")
	if err != nil {
		return nil, err
	}
	pluginsIdentity, err := pm.pluginsRoot.DirectoryIdentity(".")
	if err != nil {
		return nil, err
	}
	stageIdentity, err := pm.pluginsRoot.DirectoryIdentity(stage)
	if err != nil {
		return nil, err
	}
	candidateIdentity, err := pm.pluginsRoot.DirectoryIdentity(filepath.Join(stage, "candidate"))
	if err != nil {
		return nil, err
	}
	previousIdentity, err := pm.pluginsRoot.DirectoryIdentity(id)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if previous == nil && err == nil {
		return nil, errors.New("refusing to adopt an existing canonical plugin without previous inventory")
	}
	recovery := &archiveRecovery{Version: 1, ProfileRoot: profile, ProfileIdentity: profileIdentity,
		PluginsIdentity: pluginsIdentity, StageIdentity: stageIdentity, PreviousIdentity: previousIdentity,
		CandidateIdentity: candidateIdentity, ID: id, Stage: stage, Previous: previous, Candidate: candidate}
	if err = pm.validateArchiveRecoveryRecord(recovery, id); err != nil {
		return nil, err
	}
	if err = pm.validateArchiveRecoveryDirectories(recovery); err != nil {
		return nil, err
	}
	if _, err = pm.pluginsRoot.DirectoryIdentity(filepath.Join(stage, "previous")); !os.IsNotExist(err) {
		return nil, errors.Join(err, errors.New("archive staging already contains a previous installation"))
	}
	recordJSON, err := json.Marshal(recovery)
	if err != nil {
		return nil, err
	}
	file, err := pm.stateRoot.OpenFile(archiveRecoveryName(id), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	defer func() { err = errors.Join(err, file.Close()) }()
	createdInfo, statErr := file.Stat()
	if statErr != nil {
		return nil, statErr
	}
	_, encodeErr := file.WriteString(archiveRecoveryHeader)
	if encodeErr == nil {
		_, encodeErr = file.Write(recordJSON)
	}
	if encodeErr == nil {
		_, encodeErr = file.WriteString("}\n")
	}
	if encodeErr == nil {
		encodeErr = file.Sync()
	}
	if err = encodeErr; err != nil {
		return nil, fmt.Errorf("archive recovery retained at %s: %w", pm.stateRoot.ResolvePath(archiveRecoveryName(id)), err)
	}
	// Reuse the existing platform-specific directory-fsync convention, not the
	// uninstall transaction's intent, proof, or cleanup behavior.
	if err = errors.Join(syncUninstallDirectory(pm.stateRoot, "."), syncUninstallDirectory(pm.pluginsRoot, stage), syncUninstallDirectory(pm.pluginsRoot, ".")); err != nil {
		return nil, err
	}
	marker, identity, err := pm.stateRoot.OpenPrivateFile(archiveRecoveryName(id), os.O_RDONLY)
	if err != nil {
		return nil, err
	}
	defer marker.Close()
	currentInfo, err := marker.Stat()
	if err != nil || !os.SameFile(createdInfo, currentInfo) {
		return nil, errors.Join(err, errors.New("archive recovery marker was replaced during preparation"))
	}
	prepared, err := pm.decodeArchiveRecovery(id, marker, identity)
	if err != nil {
		return nil, err
	}
	preparedJSON, err := json.Marshal(prepared)
	if err != nil || prepared.committed || !bytes.Equal(recordJSON, preparedJSON) {
		return nil, errors.Join(err, errors.New("archive recovery immutable record changed during preparation"))
	}
	if err = pm.validateArchiveRecoveryDirectories(prepared); err != nil {
		return nil, err
	}
	return prepared, nil
}

func (pm *pluginManager) validateArchiveRecoveryDirectories(recovery *archiveRecovery) error {
	canonical, err := pm.pluginsRoot.DirectoryIdentity(recovery.ID)
	if err == nil {
		if canonical == recovery.PreviousIdentity && recovery.PreviousIdentity != (appstate.FilesystemIdentity{}) {
			if recovery.committed {
				return errors.New("previous installation appeared canonical after archive commit; its bytes may be partially disposed")
			}
		} else if canonical != recovery.CandidateIdentity {
			return errors.New("canonical plugin directory is a foreign replacement")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	stageIdentity, err := pm.pluginsRoot.DirectoryIdentity(recovery.Stage)
	if os.IsNotExist(err) {
		return nil // The caller may have finished disposing of its private stage.
	}
	if err != nil || stageIdentity != recovery.StageIdentity {
		return errors.Join(err, errors.New("archive staging directory identity changed"))
	}
	info, err := pm.pluginsRoot.Stat(recovery.Stage)
	if err != nil {
		return err
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0700 {
		return errors.New("archive staging directory is not 0700")
	}
	entries, err := pm.pluginsRoot.ReadDir(recovery.Stage)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		var expected appstate.FilesystemIdentity
		switch entry.Name() {
		case "candidate":
			expected = recovery.CandidateIdentity
		case "previous":
			expected = recovery.PreviousIdentity
		default:
			return errors.New("archive staging contains an unowned entry")
		}
		identity, statErr := pm.pluginsRoot.DirectoryIdentity(filepath.Join(recovery.Stage, entry.Name()))
		if statErr != nil || expected == (appstate.FilesystemIdentity{}) || identity != expected {
			return errors.Join(statErr, fmt.Errorf("staged archive %s directory identity changed", entry.Name()))
		}
		if canonical == identity {
			return errors.New("archive ownership proof appears at multiple paths")
		}
	}
	return nil
}

// openArchiveRecovery validates the full immutable record through the same FD
// subsequently used to advance the commit byte. Replacing or rewriting a marker
// never grants the caller authority over a different record.
func (pm *pluginManager) openArchiveRecovery(recovery *archiveRecovery, flag int) (*os.File, error) {
	if recovery == nil {
		return nil, errors.New("missing archive recovery")
	}
	if err := sdkstate.ValidateComponent(recovery.ID); err != nil {
		return nil, err
	}
	file, identity, err := pm.stateRoot.OpenPrivateFile(archiveRecoveryName(recovery.ID), flag)
	if err != nil {
		return nil, err
	}
	if identity != recovery.markerIdentity {
		file.Close()
		return nil, errors.New("archive recovery marker was replaced")
	}
	current, err := pm.decodeArchiveRecovery(recovery.ID, file, identity)
	if err == nil && !reflect.DeepEqual(current, recovery) {
		err = errors.New("archive recovery record or commit phase changed")
	}
	if err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}

func (pm *pluginManager) validateArchiveRecovery(recovery *archiveRecovery) error {
	file, err := pm.openArchiveRecovery(recovery, os.O_RDONLY)
	if err != nil {
		return err
	}
	return errors.Join(pm.validateArchiveRecoveryDirectories(recovery), file.Close())
}

func (pm *pluginManager) markArchiveCommitted(recovery *archiveRecovery) (err error) {
	file, err := pm.openArchiveRecovery(recovery, os.O_RDWR)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, file.Close()) }()
	if err = pm.validateArchiveRecoveryDirectories(recovery); err != nil {
		return err
	}
	canonical, err := pm.pluginsRoot.DirectoryIdentity(recovery.ID)
	if err != nil || canonical != recovery.CandidateIdentity {
		return errors.Join(err, errors.New("cannot commit archive without its captured candidate canonical"))
	}
	if !recovery.committed {
		phase := [1]byte{'1'}
		if written, writeErr := file.WriteAt(phase[:], int64(archiveCommittedOffset)); writeErr != nil || written != len(phase) {
			return errors.Join(writeErr, io.ErrShortWrite)
		}
	}
	if err = file.Sync(); err != nil {
		return err
	}
	recovery.committed = true
	return nil
}

// removeArchiveRecoveryMarker never disposes of plugin or stage directories.
// The caller must finish its own identity-checked cleanup before clearing proof.
func (pm *pluginManager) removeArchiveRecoveryMarker(recovery *archiveRecovery) error {
	if recovery == nil {
		return nil
	}
	file, err := pm.openArchiveRecovery(recovery, os.O_RDONLY)
	if err != nil {
		return err
	}
	if err = errors.Join(pm.validateArchiveRecoveryDirectories(recovery), file.Close()); err != nil {
		return err
	}
	if err = pm.stateRoot.Remove(archiveRecoveryName(recovery.ID)); err != nil {
		return err
	}
	return syncUninstallDirectory(pm.stateRoot, ".")
}

func (pm *pluginManager) guardArchiveRecovery(id string) error {
	recovery, err := pm.readArchiveRecovery(id)
	if err != nil {
		return apperror.Internal(err, "Invalid pending plugin archive replacement").WithInstance(id)
	}
	if recovery != nil {
		return apperror.Internal(fmt.Errorf("pending archive replacement; recovery files remain at %s", pm.pluginsRoot.ResolvePath(recovery.Stage)),
			"Plugin archive replacement requires recovery").WithInstance(id)
	}
	return nil
}

func (pm *pluginManager) reconcileArchiveRecoveries() (map[string]bool, error) {
	entries, err := pm.stateRoot.ReadDir(".")
	if err != nil {
		return nil, err
	}
	blocked := make(map[string]bool)
	// Validate every proof before publishing any recovery inventory. One foreign
	// profile or malformed marker must stop startup rather than authorize load.
	recoveries := make([]*archiveRecovery, 0)
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), archiveRecoveryPrefix) {
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".json") {
			return nil, fmt.Errorf("invalid archive recovery marker name %q", entry.Name())
		}
		id := strings.TrimSuffix(strings.TrimPrefix(entry.Name(), archiveRecoveryPrefix), ".json")
		recovery, readErr := pm.readArchiveRecovery(id)
		if readErr != nil || recovery == nil {
			return nil, errors.Join(readErr, fmt.Errorf("cannot validate pending archive replacement for %s", id))
		}
		recoveries = append(recoveries, recovery)
	}
	for _, recovery := range recoveries {
		record := plugintypes.NewPluginRecord(recovery.ID, recovery.Candidate, lifecycle.PhaseFailed)
		// The immutable candidate metadata has no captured installation time.
		record.InstalledAt = time.Time{}
		if recovery.Previous != nil && !recovery.committed {
			state := recovery.Previous
			record.Metadata = state.Metadata
			record.Enabled, record.DevMode, record.DevPath = state.Enabled, state.DevMode, state.DevPath
			record.ErrorCount, record.InstalledAt = state.ErrorCount, state.InstalledAt
		}
		record.LastError = fmt.Sprintf("pending archive replacement; recovery files at %s", pm.pluginsRoot.ResolvePath(recovery.Stage))
		if recovery.committed {
			record.LastError = fmt.Sprintf("committed archive replacement requires cleanup; previous installation must not be restored; recovery files at %s", pm.pluginsRoot.ResolvePath(recovery.Stage))
		}
		if ownershipErr := pm.validateArchiveRecovery(recovery); ownershipErr != nil {
			record.LastError += ": " + ownershipErr.Error()
		}
		pm.recordsMu.Lock()
		pm.records[recovery.ID] = record
		pm.recordsMu.Unlock()
		blocked[recovery.ID], blocked[recovery.Stage] = true, true
	}
	return blocked, nil
}
