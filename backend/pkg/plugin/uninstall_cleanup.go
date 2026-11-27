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
// complete. The uninstall is incomplete: it fails, and the host retries the erase
// at its next start and whenever the plugin is uninstalled again. Its text reaches
// the plugin's recorded last error and the UI, so it names the class of the cause
// and never the cause text, which a store could fill with a value; the cause stays
// attached for errors.Is and errors.As.
type uninstallCleanupError struct {
	cause error
}

func (e *uninstallCleanupError) Error() string {
	return "the plugin's files are removed, but the host could not erase the credential state it stored for it (" +
		telemetryutil.ErrorClass(e.cause) + "); it retries at the next start, and uninstalling the plugin again retries now"
}

func (e *uninstallCleanupError) Unwrap() error { return e.cause }

// finishUninstall runs once the uninstall has disposed of the installation, from
// inside the recovery path: after the installation directory and its staging are
// gone and the inventory is persisted, and before the recovery marker is
// removed. Disposal is irrevocable by then, so nothing is erased for an uninstall
// that rolls back, while a failure here, or a process that dies here, leaves the
// marker behind and the erase is retried until it succeeds: at the next start,
// before any plugin loads, and by uninstalling the plugin again. Until it has
// succeeded the ID cannot be installed again, so a new installation never inherits
// what was not erased.
func (pm *pluginManager) finishUninstall(ctx context.Context, id string) error {
	// A holder that kept a root on the disposed directories gets os.ErrClosed, and
	// a plugin installed again under the ID gets roots on its own new ones. This
	// cannot fail and is repeated by a retry.
	pm.releasePluginState(id)
	return errors.Join(pm.removeExtensionReceipt(id), pm.notifyUninstalled(ctx, id))
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

// finishPendingUninstall completes an uninstall whose disposal had begun when the
// host last stopped: it removes what is left of the staged installation, releases
// and erases the state kept outside it, and removes the marker. It tells the window
// nothing: no window holds an interface of a plugin in a host that has just started,
// and the stop was told when the uninstall began.
func (pm *pluginManager) finishPendingUninstall(recovery *uninstallRecovery) error {
	id := recovery.Plugin.ID
	ctx := pm.installBaseContext()
	err := pm.removeUninstallRecovery(recovery, func() error { return pm.finishUninstall(ctx, id) })
	if err != nil {
		pm.installLogger().Warnw(ctx, "pending plugin uninstall could not be completed at startup",
			"pluginID", id, "errorClass", telemetryutil.ErrorClass(err))
		return err
	}
	pm.installLogger().Infow(ctx, "pending plugin uninstall completed at startup", "pluginID", id)
	return nil
}
