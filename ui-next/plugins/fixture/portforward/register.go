package portforward

import (
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
)

// Register gives the plugin the networker capability, with the fixture's forwarder for the target server: the shape a plugin registers its forwarders in (the SDK's `networker.RegisterPlugin`), keyed by ResourceKey.
// The host dispenses the capability by the name `networker`, and a plugin whose connection registry is bound (the SDK does it when the plugin also serves `resource`) starts a forward only on a connection that is started.
func Register(plugin *sdk.Plugin, target *Server) error {
	return networker.RegisterPlugin(plugin, networker.PluginOpts{
		ResourceForwarders: map[string]networker.ResourceForwarder{ResourceKey: NewForwarder(target.Addr())},
		StaticForwarders:   nil,
	})
}
