package controllers

import (
	"context"
	"errors"
	"fmt"
	"reflect"

	"go.uber.org/zap"

	"github.com/omniviewdev/plugin/pkg/resource/services"
	"github.com/omniviewdev/plugin/pkg/resource/types"
)

// ResourceController is responsible for managing the execution of resource operations.
// The resource controller will take in requests from requesters, both inside the IDE
// and outside, and will execute the necessary operations on the resource manager.
//
// This controller is the primary entrypoint for executing operations on resources.
// TODO
type ResourceController interface {
	Get(ctx context.Context, model interface{}, resource string, namespace string, input types.GetInput) (*types.GetResult[any], error)
	List(ctx context.Context, model interface{}, resource string, namespace string, input types.ListInput) (*types.ListResult[any], error)
	Create(ctx context.Context, model interface{}, resource string, namespace string, input types.CreateInput) (*types.CreateResult[any], error)
	Update(ctx context.Context, model interface{}, resource string, namespace string, input types.UpdateInput) (*types.UpdateResult[any], error)
	Delete(ctx context.Context, resource string, namespace string, input types.DeleteInput) (*types.DeleteResult, error)
}

// NewResourceController creates a new resource controller.
func NewResourceController[ClientT, OptionsT any](
	logger *zap.SugaredLogger,
	resourceManager services.ResourceManager[ClientT],
	hookManager services.ResourceHookManager,
	namespaceManager services.ResourceNamespaceManager[ClientT, OptionsT],
	resourceTypeManager services.ResourceTypeManager,
) ResourceController {
	return &resourceController[ClientT, OptionsT]{
		logger:              logger,
		resourceManager:     resourceManager,
		hookManager:         hookManager,
		namespaceManager:    namespaceManager,
		resourceTypeManager: resourceTypeManager,
	}
}

type resourceController[ClientT, OptionsT any] struct {
	// logger is the logger for the resource controller.
	logger *zap.SugaredLogger
	// resourceManager is the resource manager that the controller will execute operations on.
	resourceManager services.ResourceManager[ClientT]
	// hookManager is the hook manager that the controller will use to attach hooks to operations.
	hookManager services.ResourceHookManager
	// namespaceManager is the namespace manager that the controller will use to manage resource namespaces.
	namespaceManager services.ResourceNamespaceManager[ClientT, OptionsT]
	// resourceTypeManager is the resource type manager that the controller will use to manage resource types.
	resourceTypeManager services.ResourceTypeManager
}

// get our client and resourcer outside to slim down the methods.
func (c *resourceController[ClientT, OptionsT]) retrieveClientResourcer(
	resource, namespace string,
) (*ClientT, types.Resourcer[ClientT], error) {
	var nilClient *ClientT
	var nilResourcer types.Resourcer[ClientT]

	// get the resourcer for the given resource type, and check type
	if ok := c.resourceTypeManager.HasResourceType(resource); !ok {
		return nilClient, nilResourcer, fmt.Errorf("resource type %s not found in resource type manager", resource)
	}

	resourcer, err := c.resourceManager.GetResourcer(resource)
	if err != nil {
		return nilClient, nilResourcer, fmt.Errorf("resourcer not found for resource type %s: %w", resource, err)
	}

	// 2. Get the client for the given resource namespace, ensuring it is of the correct type
	client, err := c.namespaceManager.GetNamespaceClient(namespace)
	if err != nil {
		return nilClient, nilResourcer, fmt.Errorf("client unable to be retrieved for namespace %s: %w", namespace, err)
	}

	// ensure the client is of the correct type for the resource controller
	expectedType := reflect.TypeOf((*ClientT)(nil)).Elem()
	clientType := reflect.TypeOf(client)

	// check the type enforcement first before continuing
	if clientType != expectedType {
		return nilClient, nilResourcer, fmt.Errorf(
			"client type %s does not match expected type %s for namespace %s",
			clientType,
			expectedType,
			namespace,
		)
	}

	return client, resourcer, nil
}

// run our prehooks on the input.
func runPreHooks[I types.OperationInput, H types.OperationResult[any]](input I, hooks services.Hooks[I, H]) error {
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
func runPostHooks[I types.OperationInput, H types.OperationResult[any]](result *H, hooks services.Hooks[I, H]) error {
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

// Get gets a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, OptionsT]) Get(
	ctx context.Context,
	model interface{},
	resource string,
	namespace string,
	input types.GetInput,
) (*types.GetResult[any], error) {
	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return nil, err
	}

	// create our final result object
	result := types.NewGetResult(model)
	hooks := c.hookManager.GetHooksForGet(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return nil, err
	}

	// execute the resourcer
	if err = resourcer.Get(ctx, client, input, result); err != nil {
		return nil, fmt.Errorf("resourcer failed to get resource: %w", err)
	}

	// ensure the returned resource is of the correct type
	if reflect.TypeOf(result.Result) != reflect.TypeOf(model) {
		return nil, errors.New("resource returned from resourcer is not of the correct type")
	}

	// run the post-operation hooks
	if err = runPostHooks(result, hooks); err != nil {
		return nil, err
	}

	return result, nil
}

// List lists resources within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, OptionsT]) List(
	ctx context.Context,
	model interface{},
	resource string,
	namespace string,
	input types.ListInput,
) (*types.ListResult[any], error) {
	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return nil, err
	}

	result := types.NewListResult(model)
	hooks := c.hookManager.GetHooksForList(resource)

	if err = runPreHooks(input, hooks); err != nil {
		return nil, err
	}

	if err = resourcer.List(ctx, client, input, result); err != nil {
		return nil, fmt.Errorf("resourcer failed to list resources: %w", err)
	}

	if err = runPostHooks(result, hooks); err != nil {
		return nil, err
	}

	return result, nil
}

// Create creates a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, OptionsT]) Create(
	ctx context.Context,
	model interface{},
	resource string,
	namespace string,
	input types.CreateInput,
) (*types.CreateResult[any], error) {
	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return nil, err
	}

	result := types.NewCreateResult(model)
	hooks := c.hookManager.GetHooksForCreate(resource)

	if err = runPreHooks(input, hooks); err != nil {
		return nil, err
	}

	if err = resourcer.Create(ctx, client, input, result); err != nil {
		return nil, fmt.Errorf("resourcer failed to create resource: %w", err)
	}

	if err = runPostHooks(result, hooks); err != nil {
		return nil, err
	}

	return result, nil
}

// Update updates a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, OptionsT]) Update(
	ctx context.Context,
	model interface{},
	resource string,
	namespace string,
	input types.UpdateInput,
) (*types.UpdateResult[any], error) {
	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return nil, err
	}

	result := types.NewUpdateResult(model)
	hooks := c.hookManager.GetHooksForUpdate(resource)

	if err = runPreHooks(input, hooks); err != nil {
		return nil, err
	}

	if err = resourcer.Update(ctx, client, input, result); err != nil {
		return nil, fmt.Errorf("resourcer failed to update resource: %w", err)
	}

	if err = runPostHooks(result, hooks); err != nil {
		return nil, err
	}

	return result, nil
}

// Delete deletes a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, OptionsT]) Delete(
	ctx context.Context,
	resource string,
	namespace string,
	input types.DeleteInput,
) (*types.DeleteResult, error) {
	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return nil, err
	}

	result := types.NewDeleteResult()
	hooks := c.hookManager.GetHooksForDelete(resource)

	if err = runPreHooks(input, hooks); err != nil {
		return nil, err
	}

	if err = resourcer.Delete(ctx, client, input, result); err != nil {
		return nil, fmt.Errorf("resourcer failed to delete resource: %w", err)
	}

	if err = runPostHooks(result, hooks); err != nil {
		return nil, err
	}

	return result, nil
}
