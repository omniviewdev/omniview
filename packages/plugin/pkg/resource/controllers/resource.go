package controllers

import (
	"fmt"
	"reflect"

	"github.com/omniviewdev/plugin/pkg/resource/services"
	"github.com/omniviewdev/plugin/pkg/resource/types"

	pkgtypes "github.com/omniviewdev/plugin/pkg/types"
)

// ResourceController is responsible for managing the execution of resource operations.
// The resource controller will take in requests from requesters, both inside the IDE
// and outside, and will execute the necessary operations on the resource manager.
//
// This controller is the primary entrypoint for executing operations on resources, and
// operates as the plugin host for the installed resource plugin.
func NewResourceController[ClientT, InformerT any](
	resourcerManager services.ResourcerManager[ClientT],
	hookManager services.HookManager,
	authContextManager services.AuthContextManager[ClientT],
	resourceTypeManager services.ResourceTypeManager,
) types.ResourceProvider {
	return &resourceController[ClientT, InformerT]{
		resourcerManager:            resourcerManager,
		hookManager:                 hookManager,
		authContextManager:          authContextManager,
		resourceResourceTypeManager: resourceTypeManager,
	}
}

func AddInformerManager[ClientT, InformerT any](
	controller *resourceController[ClientT, InformerT],
	opts services.InformerOptions[ClientT, InformerT],
) {
	controller.withInformer = true
	controller.informerManager = services.NewInformerManager(
		opts.Factory,
		opts.RegisterHandler,
		opts.RunHandler,
	)
}

type resourceController[ClientT, InformerT any] struct {
	// signal whether informer is enabled
	withInformer bool
	// informerManager is the informer manager that the controller will use to manage informers.
	informerManager *services.InformerManager[ClientT, InformerT]
	// resourcerManager is the resource manager that the controller will execute operations on.
	resourcerManager services.ResourcerManager[ClientT]
	// hookManager is the hook manager that the controller will use to attach hooks to operations.
	hookManager services.HookManager
	// authContextManager is the namespace manager that the controller will use to manage resource namespaces.
	authContextManager services.AuthContextManager[ClientT]
	// resourceResourceTypeManager is the resource type manager that the controller will use to manage resource types.
	resourceResourceTypeManager services.ResourceTypeManager
}

// get our client and resourcer outside to slim down the methods.
func (c *resourceController[ClientT, InformerT]) retrieveClientResourcer(
	ctx *pkgtypes.PluginContext,
	resource string,
) (*ClientT, types.Resourcer[ClientT], error) {
	var nilResourcer types.Resourcer[ClientT]

	// get the resourcer for the given resource type, and check type
	if ok := c.resourceResourceTypeManager.HasResourceType(resource); !ok {
		return nil, nilResourcer, fmt.Errorf(
			"resource type %s not found in resource type manager",
			resource,
		)
	}

	resourcer, err := c.resourcerManager.GetResourcer(resource)
	if err != nil {
		return nil, nilResourcer, fmt.Errorf(
			"resourcer not found for resource type %s: %w",
			resource,
			err,
		)
	}

	// 2. Get the client for the given resource namespace, ensuring it is of the correct type
	client, err := c.authContextManager.GetCurrentContextClient(ctx)
	if err != nil {
		return nil, nilResourcer, fmt.Errorf(
			"client unable to be retrieved for auth context %s: %w",
			ctx.AuthContext.ID,
			err,
		)
	}

	// ensure the client is of the correct type for the resource controller
	expectedType := reflect.TypeOf((*ClientT)(nil)).Elem()
	clientType := reflect.TypeOf(client)

	// check the type enforcement first before continuing
	if clientType != expectedType {
		return nil, nilResourcer, fmt.Errorf(
			"client type %s does not match expected type %s for auth context %s",
			clientType,
			expectedType,
			ctx.AuthContext.ID,
		)
	}

	return client, resourcer, nil
}

// TODO - combine the common logic for the operations here, lots of repetativeness
// Get gets a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, InformerT]) Get(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.GetInput,
) (*types.GetResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}

	// execute the resourcer
	result, err := resourcer.Get(ctx, client, input)
	if err != nil {
		return nil, err
	}

	return result, nil
}

// List lists resources within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, InformerT]) List(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.ListInput,
) (*types.ListResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}
	result, err := resourcer.List(ctx, client, input)
	if err != nil {
		return nil, err
	}

	return result, nil
}

// Find finds resources within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, InformerT]) Find(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.FindInput,
) (*types.FindResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}

	result, err := resourcer.Find(ctx, client, input)
	if err != nil {
		return nil, err
	}

	return result, err
}

// Create creates a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, InformerT]) Create(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.CreateInput,
) (*types.CreateResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}

	result, err := resourcer.Create(ctx, client, input)
	if err != nil {
		return nil, err
	}

	return result, nil
}

// Update updates a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, InformerT]) Update(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.UpdateInput,
) (*types.UpdateResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}

	result, err := resourcer.Update(ctx, client, input)
	if err != nil {
		return nil, err
	}

	return result, nil
}

// Delete deletes a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, InformerT]) Delete(
	ctx *pkgtypes.PluginContext,
	resource string,
	input types.DeleteInput,
) (*types.DeleteResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(ctx, resource)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}

	result, err := resourcer.Delete(ctx, client, input)
	if err != nil {
		return nil, err
	}

	return result, nil
}

// StartContextInformer signals to the listen runner to start the informer for the given context.
// If the informer is not enabled, this method will return a nil error.
func (c *resourceController[ClientT, InformerT]) StartContextInformer(
	ctx *pkgtypes.PluginContext,
	contextID string,
) error {
	if !c.withInformer {
		return nil
	}
	return c.informerManager.StartAuthContext(ctx, contextID)
}

// StopContextInformer signals to the listen runner to stop the informer for the given context.
func (c *resourceController[ClientT, InformerT]) StopContextInformer(
	ctx *pkgtypes.PluginContext,
	contextID string,
) error {
	if !c.withInformer {
		return nil
	}
	return c.informerManager.StopAuthContext(ctx, contextID)
}

// ListenForEvents listens for events from the informer and sends them to the given event channels.
// This method will block until the context is cancelled, and given this will block, the parent
// gRPC plugin host will spin this up in a goroutine.
func (c *resourceController[ClientT, InformerT]) ListenForEvents(
	ctx *pkgtypes.PluginContext,
	addChan chan types.InformerAddPayload,
	updateChan chan types.InformerUpdatePayload,
	deleteChan chan types.InformerDeletePayload,
) error {
	if !c.withInformer {
		return nil
	}
	if err := c.informerManager.Run(ctx.Context.Done(), addChan, updateChan, deleteChan); err != nil {
		return fmt.Errorf("error running informer manager: %w", err)
	}
	return nil
}
