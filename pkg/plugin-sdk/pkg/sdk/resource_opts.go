package sdk

import (
	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ResourcePluginOpts is a set of options for configuring a resource plugin.
type ResourcePluginOpts[ClientT any] struct {
	// LoadConnectionFunc is a function that will be called to load the possible connections
	// for the resource plugin.
	LoadConnectionFunc           func(*pkgtypes.PluginContext) ([]pkgtypes.Connection, error)
	LoadConnectionNamespacesFunc func(*pkgtypes.PluginContext, *ClientT) ([]string, error)
	CheckConnectionFunc          func(*pkgtypes.PluginContext, *pkgtypes.Connection, *ClientT) (pkgtypes.ConnectionStatus, error)
	WatchConnectionsFunc         func(*pkgtypes.PluginContext) (chan []pkgtypes.Connection, error)

	// CreateClient creates a new client for a connection. Required.
	CreateClient func(*pkgtypes.PluginContext) (*ClientT, error)
	// RefreshClient refreshes an existing client (e.g., rotate credentials). Optional; if nil, not called.
	RefreshClient func(*pkgtypes.PluginContext, *ClientT) error
	// StartClient is called when a connection starts. Optional; if nil, no-op.
	StartClient func(*pkgtypes.PluginContext, *ClientT) error
	// StopClient is called when a connection stops. Optional; if nil, no-op.
	StopClient func(*pkgtypes.PluginContext, *ClientT) error

	// DiscoveryProvider handles dynamic resource type discovery. If nil, a static type manager is used.
	DiscoveryProvider types.DiscoveryProvider

	// Resourcers is a map of resource metadata to resourcers that the plugin will manage.
	Resourcers map[types.ResourceMeta]types.Resourcer[ClientT]

	// PatternResourcers is a map of pattern resourcers to use as fallbacks when a registered resourcer is not available.
	PatternResourcers map[string]types.Resourcer[ClientT]

	// ResourceGroups is an optional array of resource groups to provide more details about the groups.
	ResourceGroups []types.ResourceGroup

	// ResourceDefinitions is a map of resource names to their definitions.
	ResourceDefinitions map[string]types.ResourceDefinition

	// DefaultResourceDefinition is the default resource definition to use for resources that do not have
	// a specific definition.
	DefaultResourceDefinition types.ResourceDefinition

	// CreateInformerFunc creates an InformerHandle for a given connection client. If nil, informers are disabled.
	CreateInformerFunc types.CreateInformerHandleFunc[ClientT]

	// LayoutOpts allows for customizing the layout within the UI
	LayoutOpts *types.LayoutOpts
}
