package portforward

import (
	"testing"

	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
)

func TestRegisterAddsTheNetworkerCapabilityWithTheFixturesForwarder(t *testing.T) {
	plugin := &sdk.Plugin{Log: logging.NewNop()}

	require.NoError(t, Register(plugin, startTarget(t)))

	capability, ok := plugin.GetPluginMap()[networker.PluginID].(*networker.Plugin)
	require.True(t, ok, "the plugin serves the capability the host dispenses as %q", networker.PluginID)
	targets, err := capability.Impl.GetSupportedPortForwardTargets(nil)
	require.NoError(t, err)
	require.Equal(t, []string{ResourceKey}, targets)
}

func TestRegisterRefusesNoPlugin(t *testing.T) {
	require.Error(t, Register(nil, startTarget(t)))
}
