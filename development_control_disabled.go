//go:build !devcontrol

package main

import (
	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	pluginsettings "github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	"github.com/omniviewdev/omniview/internal/instance"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Production has no control-host import, registration, listener, or discovery.
func registerDevelopmentControl(_ *application.App, _ instance.Profile, _ *AppService, _ plugin.Manager, _ *devserver.DevServerManager, _ pkgsettings.Provider, _ pluginsettings.Controller) (func(), error) {
	return nil, nil
}
