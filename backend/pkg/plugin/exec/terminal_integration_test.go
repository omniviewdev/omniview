//go:build !windows

package exec

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	"github.com/omniviewdev/plugin-sdk/settings"
)

func integrationSetting(value bool) settings.Provider {
	return settings.NewProvider(settings.ProviderOpts{PluginSettings: []settings.Category{{
		ID: "terminal", Settings: map[string]settings.Setting{"shellIntegration": {ID: "shellIntegration", Type: settings.Toggle, Default: value}},
	}}})
}

// The opt-out of the user's Settings reaches the manager that starts the terminals, and is read for every terminal.
func TestTheShellIntegrationSettingIsReadForEveryTerminal(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	command := shell(t)

	// `sh` is a shell the integration has no script for: with the setting on, that is what the answer says.
	fx.ctrl.settingsProvider = integrationSetting(true)
	on := fx.open(page, terminal.Options{Command: command})
	assert.Equal(t, terminal.Integration{State: terminal.IntegrationSkipped, Reason: terminal.SkipUnsupportedShell}, on.Integration)

	fx.ctrl.settingsProvider = integrationSetting(false)
	off, err := fx.openAs(page, terminal.Options{Command: command})
	require.NoError(t, err)
	assert.Equal(t, terminal.Integration{State: terminal.IntegrationOff, Reason: ""}, off.Integration)
}

// A manager with no settings to ask (a host that has none yet) keeps the default: on.
func TestTheShellIntegrationIsOnWhenThereAreNoSettingsToAsk(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	fx.ctrl.settingsProvider = nil
	session := fx.open(page, terminal.Options{Command: shell(t)})
	assert.Equal(t, terminal.IntegrationSkipped, session.Integration.State, "the default is on: a shell without a script is skipped, not off")
}

// A setting that cannot be read is not a yes.
func TestAShellIntegrationSettingThatCannotBeReadSkipsTheIntegration(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	fx.ctrl.settingsProvider = settings.NewProvider(settings.ProviderOpts{PluginSettings: []settings.Category{{ID: "terminal", Settings: map[string]settings.Setting{}}}})
	session := fx.open(page, terminal.Options{Command: shell(t)})
	assert.Equal(t, terminal.Integration{State: terminal.IntegrationSkipped, Reason: terminal.SkipSettingUnreadable}, session.Integration)
}
