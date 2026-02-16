package types

import (
	plugin "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Resourcer is an interface that all resources must implement in order
// to be registered with the plugin system and the resource manager.
//
// Resourcers are responsibile for for the business logic of listing,
// creating, updating, and deleting resources in a resource backend.
// Each resource type should have its own Resourcer implementation that
// knows how to interact with the backend for that resource type. Operations here are
// resource-namespace agnostic, and will be provided a client scoped to a resource
// namesspace from the resource manager when they are invoked.
//
// Some resources may have additional functionality, such as with the Kubernetes
// client, which allows the setup of an informer (also used in the informer) of
// which the Resourcer uses a shared client. As such, Resourcers should be written
// agnostic of the underlying resource client, and should be able to be used
// with any resource client that implements the ResourceClient interface.
//
// For example, the Kubernetes plugin defines a Resourcer for each
// GroupVersionKind that it supports, such as core.v1.Pod, core.v1.Service, etc.
// Each of these Resourcers knows how to interact with the Kubernetes API server
// for that resource type.
//
// Static resourcers (bound to one type at registration) may ignore the
// ResourceMeta parameter. Pattern resourcers (registered with wildcard
// patterns) use it to determine the concrete resource being operated on.
type Resourcer[ClientT any] interface {
	// Get returns a single resource in the given resource namespace.
	Get(ctx *plugin.PluginContext, client *ClientT, meta ResourceMeta, input GetInput) (*GetResult, error)

	// List returns a list of resources in the given resource namespace.
	List(ctx *plugin.PluginContext, client *ClientT, meta ResourceMeta, input ListInput) (*ListResult, error)

	// FindResources returns a list of resources in the given resource namespace that
	// match a set of given options.
	//
	// Due to the dynamic nature of the options, the options are passed as an interface
	// and the Resourcer is responsible for casting the options to the correct type.
	Find(ctx *plugin.PluginContext, client *ClientT, meta ResourceMeta, input FindInput) (*FindResult, error)

	// Create creates a new resource in the given resource namespace.
	Create(ctx *plugin.PluginContext, client *ClientT, meta ResourceMeta, input CreateInput) (*CreateResult, error)

	// Update updates an existing resource in the given resource namespace.
	Update(ctx *plugin.PluginContext, client *ClientT, meta ResourceMeta, input UpdateInput) (*UpdateResult, error)

	// Delete deletes an existing resource in the given resource namespace.
	Delete(ctx *plugin.PluginContext, client *ClientT, meta ResourceMeta, input DeleteInput) (*DeleteResult, error)
}
