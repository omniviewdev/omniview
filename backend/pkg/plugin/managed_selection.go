package plugin

import (
	"fmt"
	"os"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

func (manager *pluginManager) validateManagedSource(id, source string, archive *archiveRecovery) (bool, error) {
	if err := manager.guardUninstallRecovery(id); err != nil {
		return false, err
	}
	if err := manager.checkArchiveAccess(id, archive); err != nil {
		return false, err
	}
	if policy, ok := manager.devServerMgr.(interface {
		ValidateManagedSource(string, string) (bool, error)
	}); ok {
		workspace, err := policy.ValidateManagedSource(id, source)
		if workspace || err != nil {
			return workspace, err
		}
	}
	if os.Getenv(devcontract.WorkspaceEnvironment) != "" {
		return true, fmt.Errorf("workspace managed source policy unavailable; configure the resolved workspace before plugin startup")
	}
	return false, nil
}

// Retain the existing binding as inventory, never rewrite it to a new selected
// source without the canonical install transaction or delete its user data.
func (manager *pluginManager) retainStoppedDevInventory(state plugintypes.PluginStateRecord, reason string) {
	record := plugintypes.NewPluginRecord(state.ID, state.Metadata, lifecycle.PhaseStopped)
	record.Enabled, record.DevMode, record.DevPath = state.Enabled, true, state.DevPath
	record.InstalledAt, record.ErrorCount = state.InstalledAt, state.ErrorCount
	record.LastError = reason
	if reason == "" {
		record.LastError = state.LastError
	}
	manager.recordsMu.Lock()
	manager.records[state.ID] = record
	manager.recordsMu.Unlock()
}

func (manager *pluginManager) requireManagedArtifactStage(id, source string, metadata config.PluginMeta) error {
	states, ok := manager.devServerMgr.(interface {
		GetDevServerState(string) devserver.DevServerState
	})
	if !ok {
		return fmt.Errorf("workspace plugin %s requires the canonical managed start/link lifecycle", id)
	}
	canonical, err := devcontract.CanonicalPath(source)
	if err != nil {
		return err
	}
	state := states.GetDevServerState(id)
	if state.Mode != devserver.DevServerModeManaged || state.Generation == "" || state.DevPath != canonical {
		return fmt.Errorf("workspace plugin %s has no matching managed source build; start or relink the selected source", id)
	}
	if metadata.HasBackendCapabilities() && state.BuildStatus != devserver.StageReady {
		return fmt.Errorf("workspace plugin %s backend build is not ready; start or rebuild the selected source", id)
	}
	if metadata.HasUICapabilities() && state.ViteStatus != devserver.DevProcessStatusReady {
		return fmt.Errorf("workspace plugin %s Vite HTTP endpoint is not ready; start the selected source", id)
	}
	return nil
}
