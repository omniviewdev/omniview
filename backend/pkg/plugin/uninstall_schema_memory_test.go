package plugin

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// A plugin that did not start in the session in which it is uninstalled (it was
// disabled, it failed to start, or the host restarted) still gets the narrow
// erase: the host remembers the schema its last start reported, and classifies
// its stored values with it.

func TestUninstallKeepsDeclaredValuesOfAPluginThatDidNotStartThisSession(t *testing.T) {
	f := newCredentialFixture(t)
	f.install(t) // the plugin starts; the settings controller learns and remembers its schema
	f.save(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"})
	// A host restart: a controller with no session schema over the same store.
	f.pm.connlessControllers[sdktypes.CapabilitySettings] = settings.NewController(f.pm.logger, f.store)

	_, err := f.pm.UninstallPlugin("flux")
	require.NoError(t, err)

	assert.Equal(t, map[string]any{"theme": "dark"}, f.persisted(t))
}

func TestUninstallErasesEveryValueOfAPluginWhoseSchemaWasNeverRemembered(t *testing.T) {
	f := newCredentialFixture(t)
	f.install(t)
	f.save(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"})
	// A plugin installed before the host remembered schemas, not started since:
	// nothing proves any of its values is ordinary.
	require.NoError(t, f.store.ForgetPluginSchema("flux"))
	f.pm.connlessControllers[sdktypes.CapabilitySettings] = settings.NewController(f.pm.logger, f.store)

	_, err := f.pm.UninstallPlugin("flux")
	require.NoError(t, err)

	assert.Empty(t, f.persisted(t))
}

func TestUninstallKeepsTheRememberedSchemaOfAKeptValueSoAnotherUninstallBehavesTheSame(t *testing.T) {
	f := newCredentialFixture(t)
	f.install(t)
	f.save(t, map[string]any{"apiToken": credentialToken, "clientSecret": credentialSecret, "theme": "dark"})
	_, err := f.pm.UninstallPlugin("flux")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark"}, f.persisted(t))

	// The plugin is installed again with a credential value stored for it, and is
	// uninstalled before it ever starts, by a host that has no session schema.
	f.pm.connlessControllers[sdktypes.CapabilitySettings] = settings.NewController(f.pm.logger, f.store)
	f.save(t, map[string]any{"apiToken": credentialToken})
	installLoadedUIPlugin(t, f.pm)

	_, err = f.pm.UninstallPlugin("flux")
	require.NoError(t, err)

	assert.Equal(t, map[string]any{"theme": "dark"}, f.persisted(t),
		"the schema remembered while the first uninstall kept a value classifies the second")
}
