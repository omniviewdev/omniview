package controllers

import (
	"context"
	"fmt"
	"reflect"

	"github.com/omniviewdev/plugin/pkg/resource/services"
	"github.com/omniviewdev/plugin/pkg/resource/types"
)

// ResourceController is responsible for managing the execution of resource operations.
// The resource controller will take in requests from requesters, both inside the IDE
// and outside, and will execute the necessary operations on the resource manager.
//
// This controller is the primary entrypoint for executing operations on resources, and
// operates as the plugin host for the installed resource plugin.
func NewResourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT any](
	resourceManager services.ResourceManager[ClientT],
	hookManager services.HookManager,
	namespaceManager services.NamespaceManager[ClientT, NamespaceDT, NamespaceSDT],
	resourceTypeManager services.TypeManager[NamespaceDT, NamespaceSDT],
) types.ResourceProvider {
	return &resourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT]{
		resourceManager:     resourceManager,
		hookManager:         hookManager,
		namespaceManager:    namespaceManager,
		resourceTypeManager: resourceTypeManager,
	}
}

func AddInformerManager[ClientT, InformerT, NamespaceDT, NamespaceSDT any](
	controller *resourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT],
	opts services.InformerOptions[ClientT, InformerT, NamespaceDT, NamespaceSDT],
) {
	controller.withInformer = true
	controller.informerManager = services.NewInformerManager(
		opts.Factory,
		opts.RegisterHandler,
		opts.RunHandler,
	)
}

type resourceController[ClientT, InformerT, NamespaceDataT, NamespaceSensitiveDataT any] struct {
	// signal whether informer is enabled
	withInformer bool
	// informerManager is the informer manager that the controller will use to manage informers.
	informerManager *services.InformerManager[ClientT, InformerT, NamespaceDataT, NamespaceSensitiveDataT]
	// resourceManager is the resource manager that the controller will execute operations on.
	resourceManager services.ResourceManager[ClientT]
	// hookManager is the hook manager that the controller will use to attach hooks to operations.
	hookManager services.HookManager
	// namespaceManager is the namespace manager that the controller will use to manage resource namespaces.
	namespaceManager services.NamespaceManager[ClientT, NamespaceDataT, NamespaceSensitiveDataT]
	// resourceTypeManager is the resource type manager that the controller will use to manage resource types.
	resourceTypeManager services.TypeManager[NamespaceDataT, NamespaceSensitiveDataT]
}

// get our client and resourcer outside to slim down the methods.
func (c *resourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) retrieveClientResourcer(
	resource, namespace string,
) (*ClientT, types.Resourcer[ClientT], error) {
	var nilResourcer types.Resourcer[ClientT]

	// get the resourcer for the given resource type, and check type
	if ok := c.resourceTypeManager.HasResourceType(resource); !ok {
		return nil, nilResourcer, fmt.Errorf(
			"resource type %s not found in resource type manager",
			resource,
		)
	}

	resourcer, err := c.resourceManager.GetResourcer(resource)
	if err != nil {
		return nil, nilResourcer, fmt.Errorf(
			"resourcer not found for resource type %s: %w",
			resource,
			err,
		)
	}

	// 2. Get the client for the given resource namespace, ensuring it is of the correct type
	client, err := c.namespaceManager.GetNamespaceClient(namespace)
	if err != nil {
		return nil, nilResourcer, fmt.Errorf(
			"client unable to be retrieved for namespace %s: %w",
			namespace,
			err,
		)
	}

	// ensure the client is of the correct type for the resource controller
	expectedType := reflect.TypeOf((*ClientT)(nil)).Elem()
	clientType := reflect.TypeOf(client)

	// check the type enforcement first before continuing
	if clientType != expectedType {
		return nil, nilResourcer, fmt.Errorf(
			"client type %s does not match expected type %s for namespace %s",
			clientType,
			expectedType,
			namespace,
		)
	}

	return client, resourcer, nil
}

// run our prehooks on the input.
func runPreHooks[I types.OperationInput, H types.OperationResult](
	input I,
	hooks services.Hooks[I, H],
) error {
	for _, preMutateHook := range hooks.PreMutatation {
		if err := preMutateHook.Execute(&input); err != nil {
			return fmt.Errorf("pre-mutate hook failed: %w", err)
		}
	}
	for _, preValidationHook := range hooks.PreValidation {
		if err := preValidationHook.Execute(&input); err != nil {
			return fmt.Errorf("pre-validation hook failed: %w", err)
		}
	}
	for _, beforeOperationHook := range hooks.BeforeOperation {
		if err := beforeOperationHook.Execute(&input); err != nil {
			return fmt.Errorf("before-operation hook failed: %w", err)
		}
	}
	return nil
}

// run our posthooks on the result.
func runPostHooks[I types.OperationInput, H types.OperationResult](
	result *H,
	hooks services.Hooks[I, H],
) error {
	for _, afterOperationHook := range hooks.AfterOperation {
		if err := afterOperationHook.Execute(result); err != nil {
			return fmt.Errorf("after-operation hook failed: %w", err)
		}
	}
	for _, postValidationHook := range hooks.PostValidation {
		if err := postValidationHook.Execute(result); err != nil {
			return fmt.Errorf("post-validation hook failed: %w", err)
		}
	}
	for _, postMutateHook := range hooks.PostMutation {
		if err := postMutateHook.Execute(result); err != nil {
			return fmt.Errorf("post-mutate hook failed: %w", err)
		}
	}
	return nil
}

// TODO - combine the common logic for the operations here, lots of repetativeness
// Get gets a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) Get(
	ctx context.Context,
	resource string,
	namespace string,
	input types.GetInput,
) (*types.GetResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}

	// create our final result object
	hooks := c.hookManager.GetHooksForGet(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return nil, fmt.Errorf("unable to run prehooks: %w", err)
	}

	// execute the resourcer
	result, err := resourcer.Get(ctx, client, input)
	if err != nil {
		return nil, err
	}

	// run the post-operation hooks
	if err = runPostHooks(result, hooks); err != nil {
		return nil, fmt.Errorf("unable to run posthooks: %w", err)
	}

	return result, nil
}

// List lists resources within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) List(
	ctx context.Context,
	resource string,
	namespace string,
	input types.ListInput,
) (*types.ListResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}

	hooks := c.hookManager.GetHooksForList(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return nil, fmt.Errorf("unable to run prehooks: %w", err)
	}

	result, err := resourcer.List(ctx, client, input)
	if err != nil {
		return nil, err
	}

	if err = runPostHooks(result, hooks); err != nil {
		return nil, fmt.Errorf("unable to run posthooks: %w", err)
	}

	return result, nil
}

// Find finds resources within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) Find(
	ctx context.Context,
	resource string,
	namespace string,
	input types.FindInput,
) (*types.FindResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}

	hooks := c.hookManager.GetHooksForFind(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return nil, fmt.Errorf("unable to run prehooks: %w", err)
	}

	result, err := resourcer.Find(ctx, client, input)
	if err != nil {
		return nil, err
	}

	if err = runPostHooks(result, hooks); err != nil {
		return nil, fmt.Errorf("unable to run posthooks: %w", err)
	}

	return result, err
}

// Create creates a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) Create(
	ctx context.Context,
	resource string,
	namespace string,
	input types.CreateInput,
) (*types.CreateResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}

	hooks := c.hookManager.GetHooksForCreate(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return nil, fmt.Errorf("unable to run prehooks: %w", err)
	}

	result, err := resourcer.Create(ctx, client, input)
	if err != nil {
		return nil, err
	}

	if err = runPostHooks(result, hooks); err != nil {
		return nil, fmt.Errorf("unable to run posthooks: %w", err)
	}

	return result, nil
}

// Update updates a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) Update(
	ctx context.Context,
	resource string,
	namespace string,
	input types.UpdateInput,
) (*types.UpdateResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}

	hooks := c.hookManager.GetHooksForUpdate(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return nil, fmt.Errorf("unable to run prehooks: %w", err)
	}

	result, err := resourcer.Update(ctx, client, input)
	if err != nil {
		return nil, err
	}

	if err = runPostHooks(result, hooks); err != nil {
		return nil, fmt.Errorf("unable to run posthooks: %w", err)
	}

	return result, nil
}

// Delete deletes a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) Delete(
	ctx context.Context,
	resource string,
	namespace string,
	input types.DeleteInput,
) (*types.DeleteResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve client and resourcer: %w", err)
	}

	hooks := c.hookManager.GetHooksForDelete(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return nil, fmt.Errorf("unable to run prehooks: %w", err)
	}

	result, err := resourcer.Delete(ctx, client, input)
	if err != nil {
		return nil, err
	}

	if err = runPostHooks(result, hooks); err != nil {
		return nil, fmt.Errorf("unable to run posthooks: %w", err)
	}

	return result, nil
}

// StartContextInformer signals to the listen runner to start the informer for the given context.
// If the informer is not enabled, this method will return a nil error.
func (c *resourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) StartContextInformer(
	ctx context.Context,
	contextID string,
) error {
	if !c.withInformer {
		return nil
	}
	return c.informerManager.StartNamespace(
		ctx,
		types.Namespace[NamespaceDT, NamespaceSDT]{
			ID: contextID,
		},
	)
}

// StopContextInformer signals to the listen runner to stop the informer for the given context.
func (c *resourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) StopContextInformer(
	ctx context.Context,
	contextID string,
) error {
	if !c.withInformer {
		return nil
	}
	return c.informerManager.StopNamespace(
		ctx,
		types.Namespace[NamespaceDT, NamespaceSDT]{
			ID: contextID,
		},
	)
}

// ListenForEvents listens for events from the informer and sends them to the given event channels.
// This method will block until the context is cancelled, and given this will block, the parent
// gRPC plugin host will spin this up in a goroutine.
func (c *resourceController[ClientT, InformerT, NamespaceDT, NamespaceSDT]) ListenForEvents(
	ctx context.Context,
	addChan chan types.InformerAddPayload,
	updateChan chan types.InformerUpdatePayload,
	deleteChan chan types.InformerDeletePayload,
) error {
	if !c.withInformer {
		return nil
	}
	if err := c.informerManager.Run(ctx.Done(), addChan, updateChan, deleteChan); err != nil {
		return fmt.Errorf("error running informer manager: %w", err)
	}
	return nil
}
