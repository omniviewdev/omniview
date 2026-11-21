package plugin

import (
	"context"
	"errors"
	"fmt"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

// uninstallCleanupError reports that the installation of an uninstalled plugin
// is gone but the erase of the state it kept outside the installation did not
// complete. The uninstall is incomplete: it fails, and uninstalling the plugin
// again retries. Its text reaches the plugin's recorded last error and the UI,
// so it names the class of the cause and never the cause text, which a store
// could fill with a value; the cause stays attached for errors.Is and errors.As.
type uninstallCleanupError struct {
	cause error
}

func (e *uninstallCleanupError) Error() string {
	return "the plugin's files are removed, but the host could not erase the credential state it stored for it (" +
		telemetryutil.ErrorClass(e.cause) + "); uninstall the plugin again to retry"
}

func (e *uninstallCleanupError) Unwrap() error { return e.cause }

// finishUninstall runs once the uninstall has disposed of the installation, from
// inside the recovery path: after the installation directory and its staging are
// gone and the inventory is persisted, and before the recovery marker is
// removed. Disposal is irrevocable by then, so nothing is erased for an uninstall
// that rolls back, while a failure here, or a process that dies here, leaves the
// marker behind and the erase is retried until it succeeds: by uninstalling the
// plugin again, also after a restart. Until it has succeeded the ID cannot be
// installed again, so a new installation never inherits what was not erased.
func (pm *pluginManager) finishUninstall(ctx context.Context, id string) error {
	// A holder that kept a root on the disposed directories gets os.ErrClosed, and
	// a plugin installed again under the ID gets roots on its own new ones. This
	// cannot fail and is repeated by a retry.
	pm.releasePluginState(id)
	return pm.notifyUninstalled(ctx, id)
}

// releasePluginState tells whoever caches handles on the plugin's state
// directories that the installation is gone for good.
func (pm *pluginManager) releasePluginState(id string) {
	if pm.pluginStateRelease != nil {
		pm.pluginStateRelease(id)
	}
}

// notifyUninstalled asks every controller that keeps state for the plugin outside
// its directory to erase the credential-class part of it and to release what was
// bound to the removed directory. A failure is logged by class, never by cause
// text, and returned as an uninstallCleanupError.
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
	pm.installLogger().Errorw(ctx, "plugin uninstall left stored credential state behind",
		"pluginID", id, "errorClass", telemetryutil.ErrorClass(err))
	return &uninstallCleanupError{cause: err}
}

// observeUninstalled calls the controller's PluginUninstallObserver hook, if it has one.
func observeUninstalled(ctrl any, id string) error {
	observer, ok := ctrl.(plugintypes.PluginUninstallObserver)
	if !ok {
		return nil
	}
	return observer.OnPluginUninstalled(id)
}
