package plugin

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

// notifyUninstalled runs once per uninstall, after the uninstall is durable: the
// installation directory is removed, the inventory is persisted and the recovery
// marker is gone. It asks every controller that keeps state for the plugin
// outside its directory to erase the credential-class part of it and to release
// what was bound to the removed directory. It never runs for a rolled-back or
// incomplete uninstall, so nothing is erased from an installation that remains.
//
// A failure cannot undo the uninstall. It is logged, and returned as a committed
// cleanup error so that the caller learns the plugin is gone but some of its
// stored credential state is not.
func (pm *pluginManager) notifyUninstalled(ctx context.Context, id string) error {
	var errs []error
	for capability, ctrl := range pm.connfullControllers {
		if err := observeUninstalled(ctrl, id); err != nil {
			errs = append(errs, fmt.Errorf("erase %s state: %w", capability, err))
		}
	}
	for capability, ctrl := range pm.connlessControllers {
		if err := observeUninstalled(ctrl, id); err != nil {
			errs = append(errs, fmt.Errorf("erase %s state: %w", capability, err))
		}
	}
	err := errors.Join(errs...)
	if err == nil {
		return nil
	}
	pm.installLogger().Errorw(ctx, "plugin uninstalled, but its stored credential state could not be erased",
		"pluginID", id, "errorClass", telemetryutil.ErrorClass(err))
	return apperror.WrapWithDetail(err, apperror.TypePluginCommittedCleanupPending, http.StatusInternalServerError,
		"Plugin uninstalled; credential cleanup incomplete",
		"The plugin was uninstalled, but the host could not erase every credential value it stored for it.").
		WithInstance(id).
		WithSuggestions("Install the plugin again, then uninstall it again, to retry erasing its stored credentials.")
}

// observeUninstalled calls the controller's PluginUninstallObserver hook, if it has one.
func observeUninstalled(ctrl any, id string) error {
	observer, ok := ctrl.(plugintypes.PluginUninstallObserver)
	if !ok {
		return nil
	}
	return observer.OnPluginUninstalled(id)
}
