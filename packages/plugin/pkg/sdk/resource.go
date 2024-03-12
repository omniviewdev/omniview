package sdk

import (
	"context"

	"github.com/omniviewdev/plugin/pkg/resource/controllers"
	"github.com/omniviewdev/plugin/pkg/resource/factories"
	resource "github.com/omniviewdev/plugin/pkg/resource/plugin"
	"github.com/omniviewdev/plugin/pkg/resource/services"
	"github.com/omniviewdev/plugin/pkg/resource/types"
)

// StaticResourcePluginOpts is a set of options for configuring a resource plugin. A resource plugin
// must consist of a client factory and a set of resourcers that the plugin will manage.
type StaticResourcePluginOpts[ClientT any] struct {
	ClientFactory factories.ResourceClientFactory[ClientT]
	Resourcers    map[types.ResourceMeta]types.Resourcer[ClientT]
}

// Registers and runs a static resource plugin with the given options. Static resource plugins are
// plugins that do not assess a user's access to specific resource types per resource namespace.
//
// This is most common when dealing with things like clouds, where the types of resources available
// does not change with different resource namepsace connections. If the resource that's being connected
// to may have a different set of available resources based on the resource namespace being connected to (like
// various Kubernetes clusters, where different clusters may have different resources available), then
// a dynamic resource plugin should be used instead.
func RegisterStaticResourcePlugin[ClientT, InformerT any](
	plugin *Plugin,
	opts StaticResourcePluginOpts[ClientT],
) {
	if plugin == nil {
		// improper use of plugin
		panic("plugin cannot be nil")
	}

	metas := make([]types.ResourceMeta, 0, len(opts.Resourcers))
	for meta := range opts.Resourcers {
		metas = append(metas, meta)
	}

	controller := controllers.NewResourceController[ClientT, InformerT](
		services.NewResourceManager[ClientT](),
		services.NewHookManager(),
		services.NewNamespaceManager(opts.ClientFactory),
		services.NewStaticResourceTypeManager(metas),
	)

	// Register the resource plugin with the plugin system.
	plugin.registerCapability("resource", &resource.ResourcePlugin{Impl: controller})
}

// DynamicResourcePluginOpts is a set of options for configuring a dynamic resource plugin. A dynamic resource
// plugin must consist of a discovery client factory, a discovery function, a client factory, and a set of
// resourcers that the plugin will manage.
type DynamicResourcePluginOpts[ClientT, DiscoveryClientT any] struct {
	DiscoveryClientFactory factories.ResourceDiscoveryClientFactory[DiscoveryClientT]
	DiscoveryFunc          func(context.Context, *DiscoveryClientT) ([]types.ResourceMeta, error)
	ClientFactory          factories.ResourceClientFactory[ClientT]
	Resourcers             map[types.ResourceMeta]types.Resourcer[ClientT]
}

// Registers and runs a dynamic resource plugin with the given options. Dynamic resource plugins are
// plugins that assess a user's access to specific resource types per resource namespace, or where the
// types of resources available may change with different resource namespace connections. The plugin
// must provide an addition discovery client factory that can be used to determine the available resources
// for a given resource namespace.
//
// This is most common when dealing with things like Kubernetes clusters, where different clusters may
// have different resources available, and the user's access to those resources may change based on the
// resource namespace being connected to.
//
// If the resource that's being connected to does not have a different set of available resources based on
// the resource namespace being connected to (like various clouds, where the types of resources available does
// not change with different resource namespace connections), then a static resource plugin should be used instead.
func RegisterDynamicResourcePlugin[ClientT, InformerT, DiscoveryClientT any](
	plugin *Plugin,
	opts DynamicResourcePluginOpts[ClientT, DiscoveryClientT],
) {
	if plugin == nil {
		// improper use of plugin
		panic("plugin cannot be nil")
	}
	metas := make([]types.ResourceMeta, 0, len(opts.Resourcers))
	for meta := range opts.Resourcers {
		metas = append(metas, meta)
	}
	controller := controllers.NewResourceController[ClientT, InformerT](
		services.NewResourceManager[ClientT](),
		services.NewHookManager(),
		services.NewNamespaceManager(opts.ClientFactory),
		services.NewDynamicResourceTypeManager(
			metas,
			opts.DiscoveryClientFactory,
			opts.DiscoveryFunc,
		),
	)
	// Register the resource plugin with the plugin system.
	plugin.registerCapability("resource", &resource.ResourcePlugin{Impl: controller})
}
