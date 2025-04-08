package networker

import "github.com/omniviewdev/plugin-sdk/pkg/types"

// ResourcePortForwarder is a function that is called to forward a resource's port.
type (
	// ResourcePortForwarder is responsible for initiating a port forwarding session given the options
	// coming from the plugin describing a resource to start a port forwarding session for. It should return
	// a UUID that uniquely identifies the session, or an error if any occurred.
	//
	// The Context passed in via the plugin context will be canceled when the port forwarding session is
	// meant to be terminated. This is the plugin's cue to stop the port forwarding session.
	ResourcePortForwarder func(*types.PluginContext, ResourcePortForwardHandlerOpts) (string, error)

	// StaticPortForwarder is responsible for initiating a port forwarding session given the options
	// coming from the plugin describing a static target to initiate a port forward for. It should return
	// a UUID that uniquely identifies the session, or an error if any occurred.
	//
	// The Context passed in via the plugin context will be canceled when the port forwarding session is
	// meant to be terminated. This is the plugin's cue to stop the port forwarding session.
	StaticPortForwarder func(*types.PluginContext, StaticPortForwardHandlerOpts) (string, error)
)

type PluginOpts struct {
	// ResourcePortForwarders is a map of resource type to the function that is called to forward a resource's port.
	ResourcePortForwarders map[string]ResourcePortForwarder
	// StaticPortForwarders is a map of resource type to the function that is called to forward a static target of some
	// kind addressable by standard network addresses.
	StaticPortForwarders map[string]StaticPortForwarder
}
