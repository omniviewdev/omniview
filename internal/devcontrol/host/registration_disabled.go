//go:build !devcontrol

package host

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	pluginsettings "github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/hostsettings"
	"github.com/omniviewdev/omniview/internal/instance"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// Register leaves control disabled: no registration, listener, or discovery.
func Register(_ *application.App, _ instance.Profile, _ func() devcontract.InstanceDescriptor, _ func(devcontract.InstanceDescriptor), _ plugin.Manager, _ *devserver.DevServerManager, _ pkgsettings.Provider, _ hostsettings.Writer, _ pluginsettings.Controller) (func(), error) {
	return nil, nil
}
