package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	sdkstate "github.com/omniviewdev/plugin-sdk/pkg/state"
)

const uninstallRecoveryPrefix = ".uninstall-recovery-"

// A fixed JSON envelope permits advancing one byte through the validated marker
// FD. No pathname replacement can overwrite another owner's recovery record.
const uninstallRecoveryHeader = "{\"cleanupStarted\":0,\"record\":"
const uninstallCleanupOffset = len("{\"cleanupStarted\":")

type uninstallRecovery struct {
	Version         int                           `json:"version"`
	ProfileRoot     string                        `json:"profileRoot"`
	ProfileIdentity appstate.FilesystemIdentity   `json:"profileIdentity"`
	PluginsIdentity appstate.FilesystemIdentity   `json:"pluginsIdentity"`
	Plugin          plugintypes.PluginStateRecord `json:"plugin"`
	Stage           string                        `json:"stage"`
	StageIdentity   appstate.FilesystemIdentity   `json:"stageIdentity"`
	OwnedIdentity   appstate.FilesystemIdentity   `json:"ownedIdentity"`
	markerIdentity  appstate.FilesystemIdentity
	cleanupStarted  bool
}

func uninstallRecoveryName(id string) string {
	return uninstallRecoveryPrefix + id + ".json"
}

func readUninstallRecoveryHeader(file *os.File) (bool, error) {
	var header [len(uninstallRecoveryHeader)]byte
	if _, err := file.ReadAt(header[:], 0); err != nil {
		return false, err
	}
	phase := header[uninstallCleanupOffset]
	if phase != '0' && phase != '1' {
		return false, errors.New("invalid uninstall disposal phase")
	}
	header[uninstallCleanupOffset] = '0'
	if string(header[:]) != uninstallRecoveryHeader {
		return false, errors.New("invalid uninstall recovery envelope")
	}
	return phase == '1', nil
}

func (pm *pluginManager) readUninstallRecovery(id string) (*uninstallRecovery, error) {
	if err := sdkstate.ValidateComponent(id); err != nil {
		return nil, err
	}
	file, identity, err := pm.stateRoot.OpenPrivateFile(uninstallRecoveryName(id), os.O_RDONLY)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() > 1<<20 {
		return nil, errors.Join(err, errors.New("uninstall recovery exceeds its size limit"))
	}
	started, err := readUninstallRecoveryHeader(file)
	if err != nil {
		return nil, err
	}
	var envelope struct {
		CleanupStarted uint8              `json:"cleanupStarted"`
		Record         *uninstallRecovery `json:"record"`
	}
	decoder := json.NewDecoder(io.LimitReader(file, 1<<20))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&envelope); err != nil {
		return nil, fmt.Errorf("invalid uninstall recovery for %s: %w", id, err)
	}
	recovery := envelope.Record
	if recovery == nil || envelope.CleanupStarted > 1 || started != (envelope.CleanupStarted == 1) {
		return nil, errors.New("uninstall recovery disposal phase changed or is invalid")
	}
	recovery.cleanupStarted = started
	if err = decoder.Decode(new(any)); err != io.EOF {
		return nil, errors.New("uninstall recovery contains trailing data")
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
	if recovery.Version != 1 || recovery.Plugin.ID != id || recovery.Plugin.Metadata.ID != id ||
		recovery.ProfileRoot != profile || recovery.ProfileIdentity != profileIdentity || recovery.PluginsIdentity != pluginsIdentity ||
		filepath.Base(recovery.Stage) != recovery.Stage || !strings.HasPrefix(recovery.Stage, ".uninstall-"+id+"-") ||
		recovery.OwnedIdentity == (appstate.FilesystemIdentity{}) || recovery.StageIdentity == (appstate.FilesystemIdentity{}) {
		return nil, errors.New("uninstall recovery ownership does not match this profile and plugin")
	}
	recovery.markerIdentity = identity
	return recovery, nil
}

func syncUninstallDirectory(root *appstate.ScopedRoot, name string) error {
	// Windows has no portable directory fsync. Its recovery marker is flushed
	// as a regular file before any synchronous, handle-relative native rename.
	if runtime.GOOS == "windows" {
		return nil
	}
	file, err := root.OpenFile(name, os.O_RDONLY, 0)
	if err != nil {
		return err
	}
	defer file.Close()
	return file.Sync()
}

func (pm *pluginManager) prepareUninstallRecovery(id string, record *plugintypes.PluginRecord) (*uninstallRecovery, error) {
	recovery, err := pm.readUninstallRecovery(id)
	if err != nil || recovery != nil {
		return recovery, err
	}
	owned, err := pm.pluginsRoot.DirectoryIdentity(id)
	if os.IsNotExist(err) {
		return nil, nil // Failed inventory may have no installation to stage.
	}
	if err != nil {
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
	stage, err := pm.pluginsRoot.MkdirTemp(".uninstall-" + id + "-")
	if err != nil {
		return nil, err
	}
	directory := pm.pluginsRoot.ResolvePath(stage)
	stageIdentity, err := pm.pluginsRoot.DirectoryIdentity(stage)
	if err != nil {
		return nil, fmt.Errorf("uninstall staging retained at %s: %w", directory, err)
	}
	state := record.ToStateRecord()
	state.Phase = lifecycle.PhaseStopped
	recovery = &uninstallRecovery{Version: 1, ProfileRoot: profile, ProfileIdentity: profileIdentity,
		PluginsIdentity: pluginsIdentity, Plugin: state, Stage: stage, StageIdentity: stageIdentity, OwnedIdentity: owned}
	file, err := pm.stateRoot.OpenFile(uninstallRecoveryName(id), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, fmt.Errorf("uninstall staging retained at %s: %w", directory, err)
	}
	_, encodeErr := file.WriteString(uninstallRecoveryHeader)
	if encodeErr == nil {
		encodeErr = json.NewEncoder(file).Encode(recovery)
	}
	if encodeErr == nil {
		_, encodeErr = file.WriteString("}\n")
	}
	if encodeErr == nil {
		encodeErr = file.Sync()
	}
	closeErr := file.Close()
	if err = errors.Join(encodeErr, closeErr); err != nil {
		return nil, fmt.Errorf("uninstall recovery retained at %s: %w", pm.stateRoot.ResolvePath(uninstallRecoveryName(id)), err)
	}
	if err = errors.Join(syncUninstallDirectory(pm.stateRoot, "."), syncUninstallDirectory(pm.pluginsRoot, stage), syncUninstallDirectory(pm.pluginsRoot, ".")); err != nil {
		return nil, err
	}
	return pm.readUninstallRecovery(id)
}

// locateUninstallRecovery never establishes ownership from a newly observed
// canonical directory. Every existing object must match the pre-unload proof.
func (pm *pluginManager) locateUninstallRecovery(recovery *uninstallRecovery) (canonical, staged bool, err error) {
	if recovery == nil {
		return false, false, nil
	}
	id := recovery.Plugin.ID
	identity, statErr := pm.pluginsRoot.DirectoryIdentity(id)
	if statErr == nil {
		if recovery.cleanupStarted {
			return false, false, errors.New("canonical entry appeared after uninstall disposal began")
		}
		if identity != recovery.OwnedIdentity {
			return false, false, errors.New("canonical plugin directory is a foreign replacement")
		}
		canonical = true
	} else if !os.IsNotExist(statErr) {
		return false, false, statErr
	}
	stageIdentity, statErr := pm.pluginsRoot.DirectoryIdentity(recovery.Stage)
	if os.IsNotExist(statErr) {
		if canonical {
			return false, false, errors.New("owned uninstall staging directory disappeared")
		}
		return false, false, nil // Cleanup may have completed before marker removal.
	}
	if statErr != nil || stageIdentity != recovery.StageIdentity {
		return false, false, errors.Join(statErr, errors.New("uninstall staging directory identity changed"))
	}
	info, statErr := pm.pluginsRoot.Stat(recovery.Stage)
	if statErr != nil || (runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
		return false, false, errors.Join(statErr, errors.New("uninstall staging directory is not private"))
	}
	entries, statErr := pm.pluginsRoot.ReadDir(recovery.Stage)
	if statErr != nil {
		return false, false, statErr
	}
	for _, entry := range entries {
		if entry.Name() != "plugin" {
			return false, false, errors.New("uninstall staging contains an unowned entry")
		}
		identity, statErr = pm.pluginsRoot.DirectoryIdentity(filepath.Join(recovery.Stage, "plugin"))
		if statErr != nil || identity != recovery.OwnedIdentity {
			return false, false, errors.Join(statErr, errors.New("staged plugin directory identity changed"))
		}
		staged = true
	}
	if canonical && staged {
		return false, false, errors.New("plugin ownership proof appears at multiple paths")
	}
	return canonical, staged, nil
}

func (pm *pluginManager) beginUninstallDisposal(recovery *uninstallRecovery) (err error) {
	file, identity, err := pm.stateRoot.OpenPrivateFile(uninstallRecoveryName(recovery.Plugin.ID), os.O_RDWR)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, file.Close()) }()
	if identity != recovery.markerIdentity {
		return errors.New("uninstall recovery marker was replaced before disposal")
	}
	started, err := readUninstallRecoveryHeader(file)
	if err != nil {
		return err
	}
	// Be conservative even if the write or Sync fails: no partial tree may be
	// restored once this process has attempted to publish disposal intent.
	recovery.cleanupStarted = true
	if !started {
		phase := [1]byte{'1'}
		if written, writeErr := file.WriteAt(phase[:], int64(uninstallCleanupOffset)); writeErr != nil || written != len(phase) {
			return errors.Join(writeErr, io.ErrShortWrite)
		}
	}
	// Re-sync a resumed phase too; an earlier Sync failure never permits delete.
	return file.Sync()
}

func (pm *pluginManager) removeUninstallRecovery(recovery *uninstallRecovery) error {
	if recovery == nil {
		return nil
	}
	canonical, staged, err := pm.locateUninstallRecovery(recovery)
	if err != nil {
		return err
	}
	if canonical {
		return errors.New("cannot finalize uninstall while the original installation remains canonical")
	}
	if err = pm.beginUninstallDisposal(recovery); err != nil {
		return err
	}
	if _, staged, err = pm.locateUninstallRecovery(recovery); err != nil {
		return err
	}
	if staged {
		if err = pm.pluginsRoot.RemoveAll(recovery.Stage); err != nil {
			return err
		}
	} else if _, err = pm.pluginsRoot.Stat(recovery.Stage); err == nil {
		if err = pm.pluginsRoot.Remove(recovery.Stage); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if _, _, err = pm.locateUninstallRecovery(recovery); err != nil {
		return err
	}
	file, identity, err := pm.stateRoot.OpenPrivateFile(uninstallRecoveryName(recovery.Plugin.ID), os.O_RDONLY)
	if err != nil {
		return err
	}
	file.Close()
	if identity != recovery.markerIdentity {
		return errors.New("uninstall recovery marker was replaced")
	}
	if err = pm.stateRoot.Remove(uninstallRecoveryName(recovery.Plugin.ID)); err != nil {
		return err
	}
	return nil
}

func (pm *pluginManager) guardUninstallRecovery(id string) error {
	recovery, err := pm.readUninstallRecovery(id)
	if err != nil {
		return apperror.Internal(err, "Invalid pending plugin uninstall").WithInstance(id)
	}
	if recovery != nil {
		return apperror.Internal(fmt.Errorf("complete the pending uninstall; owned recovery files remain at %s", pm.pluginsRoot.ResolvePath(recovery.Stage)),
			"Plugin uninstall requires recovery").WithInstance(id)
	}
	return nil
}

func (pm *pluginManager) restoreUninstallRecoveries() (map[string]bool, error) {
	entries, err := pm.stateRoot.ReadDir(".")
	if err != nil {
		return nil, err
	}
	blocked := make(map[string]bool)
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), uninstallRecoveryPrefix) || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(strings.TrimPrefix(entry.Name(), uninstallRecoveryPrefix), ".json")
		recovery, err := pm.readUninstallRecovery(id)
		if err != nil || recovery == nil {
			return nil, errors.Join(err, fmt.Errorf("cannot validate pending uninstall for %s", id))
		}
		state := recovery.Plugin
		record := plugintypes.NewPluginRecord(id, state.Metadata, lifecycle.PhaseFailed)
		record.Enabled, record.DevMode, record.DevPath = state.Enabled, state.DevMode, state.DevPath
		record.ErrorCount, record.InstalledAt = state.ErrorCount, state.InstalledAt
		_, _, ownershipErr := pm.locateUninstallRecovery(recovery)
		record.LastError = fmt.Sprintf("pending uninstall; owned recovery files at %s", pm.pluginsRoot.ResolvePath(recovery.Stage))
		if ownershipErr != nil {
			record.LastError += ": " + ownershipErr.Error()
		}
		pm.recordsMu.Lock()
		pm.records[id] = record
		pm.recordsMu.Unlock()
		blocked[id], blocked[recovery.Stage] = true, true
	}
	return blocked, nil
}
