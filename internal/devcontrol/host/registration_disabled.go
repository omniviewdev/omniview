//go:build !devcontrol

package host

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	settingsservice "github.com/omniviewdev/omniview/backend/pkg/settings"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
)

// Register leaves control disabled: no registration, listener, or discovery.
func Register(
	_ *application.App,
	_ instance.Profile,
	_ func() devcontract.InstanceDescriptor,
	_ func(devcontract.InstanceDescriptor),
	_ plugin.Manager,
	_ *devserver.DevServerManager,
	_ *settingsservice.Service,
) (func(), error) {
	return nil, nil
}
