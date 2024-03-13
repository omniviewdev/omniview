package types

import "github.com/omniviewdev/plugin/pkg/types"

type ResourceProviderInput[I OperationInput] struct {
	Input       I
	ResourceID  string
	NamespaceID string
}

type RegisterPreHookRequest[I OperationInput] struct {
	Hook  PreHookFunc[I]
	ID    string
	Phase PreHookType
}

// ResourceProvider provides an interface for performing operations against a resource backend
// given a resource namespace and a resource identifier.
type ResourceProvider interface {
	// Get returns a single resource in the given resource namespace.
	Get(ctx *types.PluginContext, key string, input GetInput) (*GetResult, error)
	// Get returns a single resource in the given resource namespace.
	List(ctx *types.PluginContext, key string, input ListInput) (*ListResult, error)
	// FindResources returns a list of resources in the given resource namespace that
	// match a set of given options.
	Find(ctx *types.PluginContext, key string, input FindInput) (*FindResult, error)
	// Create creates a new resource in the given resource namespace.
	Create(
		ctx *types.PluginContext,
		key string,
		input CreateInput,
	) (*CreateResult, error)
	// Update updates an existing resource in the given resource namespace.
	Update(
		ctx *types.PluginContext,
		key string,
		input UpdateInput,
	) (*UpdateResult, error)
	// Delete deletes an existing resource in the given resource namespace.
	Delete(
		ctx *types.PluginContext,
		key string,
		input DeleteInput,
	) (*DeleteResult, error)
	// StartContextInformer signals the resource provider to start an informer for the given resource backend context
	StartContextInformer(ctx *types.PluginContext, contextID string) error
	// StopContextInformer signals the resource provider to stop an informer for the given resource backend context
	StopContextInformer(ctx *types.PluginContext, contextID string) error
	// ListenForEvents registers a listener for resource events
	ListenForEvents(
		ctx *types.PluginContext,
		addStream chan InformerAddPayload,
		updateStream chan InformerUpdatePayload,
		deleteStream chan InformerDeletePayload,
	) error

	// TODO - rework/remove this, the IDE should be the one doing the lifecycle hooking on the data, not the plugin
	//
	// // RegisterPreGetHook registers a pre-get hook that will be called before a resource is retrieved
	// RegisterPreGetHook(PreHook[GetInput]) error
	// // RegisterPreListHook registers a pre-list hook that will be called before a resource is listed
	// RegisterPreListHook(PreHook[ListInput]) error
	// // RegisterPreFindHook registers a pre-find hook that will be called before a resource is found
	// RegisterPreFindHook(PreHook[FindInput]) error
	// // RegisterPreCreateHook registers a pre-create hook that will be called before a resource is created
	// RegisterPreCreateHook(PreHook[CreateInput]) error
	// // RegisterPreUpdateHook registers a pre-update hook that will be called before a resource is updated
	// RegisterPreUpdateHook(PreHook[UpdateInput]) error
	// // RegisterPreDeleteHook registers a pre-delete hook that will be called before a resource is deleted
	// RegisterPreDeleteHook(PreHook[DeleteInput]) error
	//
	// // RegisterPostGetHook registers a post-create hook that will be called after a resource is created
	// RegisterPostGetHook(PostHook[GetResult]) error
	// // RegisterPostListHook registers a post-create hook that will be called after a resource is created
	// RegisterPostListHook(PostHook[ListResult]) error
	// // RegisterPostFindHook registers a post-create hook that will be called after a resource is created
	// RegisterPostFindHook(PostHook[FindResult]) error
	// // RegisterPostCreateHook registers a post-create hook that will be called after a resource is created
	// RegisterPostCreateHook(PostHook[CreateResult]) error
	// // RegisterPostUpdateHook registers a post-create hook that will be called after a resource is created
	// RegisterPostUpdateHook(PostHook[UpdateResult]) error
	// // RegisterPostDeleteHook registers a post-create hook that will be called after a resource is created
	// RegisterPostDeleteHook(PostHook[DeleteResult]) error
}
