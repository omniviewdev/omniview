package exec

import (
	"context"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// admitSessionReference keeps built-in and native resource execution on the same
// host authorization path. Native planning does not grant broader permissions.
func (c *controller) admitSessionReference(ctx context.Context, plugin, connectionID string, opts execsdk.SessionOptions) (context.Context, error) {
	if opts.Reference == nil {
		return ctx, nil
	}
	if c.referenceAdmitter == nil {
		return nil, resourcev2.NewError("UNSUPPORTED", "Resource reference admission is unavailable.")
	}
	if opts.Route == nil || opts.Route.Connection != connectionID {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Resource route does not match the selected connection.")
	}
	return c.referenceAdmitter(ctx, "exec.CreateSession", plugin, *opts.Route, *opts.Reference)
}

func (c *controller) launcher() nativeTerminalLauncher {
	if c.nativeLauncher != nil {
		return c.nativeLauncher
	}
	return macNativeTerminal{}
}

func (c *controller) GetNativeTerminalSupport() bool {
	return c.launcher().Supported()
}

// OpenNativeSession plans and launches a fresh process for an admitted resource.
// It never creates, indexes, attaches, closes, or transfers a terminal session.
func (c *controller) OpenNativeSession(plugin, connectionID string, opts execsdk.SessionOptions) error {
	if err := execsdk.ValidateNativeCommandOptions(opts); err != nil {
		return err
	}
	if plugin == "local" {
		return resourcev2.NewError("INVALID_REQUEST", "Native resource shells require a resource plugin.")
	}
	launcher := c.launcher()
	if !launcher.Supported() {
		return resourcev2.NewError("UNSUPPORTED", "External resource shells are supported only on macOS.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ctx, err := c.admitSessionReference(ctx, plugin, connectionID, opts)
	if err != nil {
		return err
	}
	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		return apperror.PluginNotFound(plugin)
	}
	provider, ok := client.(execsdk.NativeCommandProvider)
	if !ok {
		return resourcev2.NewError("UNSUPPORTED", "Native command planning is unavailable for this plugin.")
	}
	application := "terminal"
	if c.settingsProvider != nil {
		application, err = c.settingsProvider.GetString("terminal.nativeApplication")
		if err != nil {
			return resourcev2.NewError("UNAVAILABLE", "Cannot read the native terminal setting. Choose Terminal or iTerm2 in Settings.")
		}
	}
	if _, err := nativeApplicationID(application); err != nil {
		return err
	}
	pc := c.getConnectedCtx(ctx, plugin, connectionID)
	if pc == nil {
		return resourcev2.NewError("UNAVAILABLE", "The selected resource connection is unavailable. Reconnect and retry.")
	}
	command, err := provider.PlanNativeCommand(pc, opts)
	if err != nil {
		return err
	}
	if err := execsdk.ValidateNativeCommand(command); err != nil {
		return err
	}
	return launcher.Launch(ctx, application, command)
}
