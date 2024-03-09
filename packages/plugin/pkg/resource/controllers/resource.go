package controllers

import (
	"context"
	"errors"
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
func NewResourceController[ClientT, NamespaceDT, NamespaceSDT any](
	resourceManager services.ResourceManager[ClientT],
	hookManager services.HookManager,
	namespaceManager services.NamespaceManager[ClientT, NamespaceDT, NamespaceSDT],
	resourceTypeManager services.TypeManager[NamespaceDT, NamespaceSDT],
) types.ResourceProvider {
	return &resourceController[ClientT, NamespaceDT, NamespaceSDT]{
		resourceManager:     resourceManager,
		hookManager:         hookManager,
		namespaceManager:    namespaceManager,
		resourceTypeManager: resourceTypeManager,
	}
}

type resourceController[ClientT, NamespaceDataT, NamespaceSensitiveDataT any] struct {
	// resourceManager is the resource manager that the controller will execute operations on.
	resourceManager services.ResourceManager[ClientT]
	// hookManager is the hook manager that the controller will use to attach hooks to operations.
	hookManager services.HookManager
	// namespaceManager is the namespace manager that the controller will use to manage resource namespaces.
	namespaceManager services.NamespaceManager[ClientT, NamespaceDataT, NamespaceSensitiveDataT]
	// resourceTypeManager is the resource type manager that the controller will use to manage resource types.
	resourceTypeManager services.TypeManager[NamespaceDataT, NamespaceSensitiveDataT]
}

// RegisterPreGetHook registers a pre-get hook for the given resource type.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) RegisterPreGetHook(
	hook types.PreHook[types.GetInput],
) error {
	c.hookManager.RegisterPreGetHook(hook)
	// TODO - add error checking in hook manager registration
	return nil
}

// RegisterPreListHook registers a pre-list hook for the given resource type.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) RegisterPreListHook(
	hook types.PreHook[types.ListInput],
) error {
	c.hookManager.RegisterPreListHook(hook)
	// TODO - add error checking in hook manager registration
	return nil
}

// RegisterPreFindHook registers a pre-find hook for the given resource type.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) RegisterPreFindHook(
	hook types.PreHook[types.FindInput],
) error {
	c.hookManager.RegisterPreFindHook(hook)
	// TODO - add error checking in hook manager registration
	return nil
}

// RegisterPreCreateHook registers a pre-create hook for the given resource type.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) RegisterPreCreateHook(
	hook types.PreHook[types.CreateInput],
) error {
	c.hookManager.RegisterPreCreateHook(hook)
	// TODO - add error checking in hook manager registration
	return nil
}

// RegisterPreUpdateHook registers a pre-update hook for the given resource type.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) RegisterPreUpdateHook(
	hook types.PreHook[types.UpdateInput],
) error {
	c.hookManager.RegisterPreUpdateHook(hook)
	// TODO - add error checking in hook manager registration
	return nil
}

// RegisterPreDeleteHook registers a pre-delete hook for the given resource type.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) RegisterPreDeleteHook(
	hook types.PreHook[types.DeleteInput],
) error {
	c.hookManager.RegisterPreDeleteHook(hook)
	// TODO - add error checking in hook manager registration
	return nil
}

// RegisterPostGetHook registers a post-get hook for the given resource type.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) RegisterPostGetHook(
	hook types.PostHook[types.GetResult],
) error {
	c.hookManager.RegisterPostGetHook(hook)
	// TODO - add error checking in hook manager registration
	return nil
}

// RegisterPostListHook registers a post-list hook for the given resource type.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) RegisterPostListHook(
	hook types.PostHook[types.ListResult],
) error {
	c.hookManager.RegisterPostListHook(hook)
	// TODO - add error checking in hook manager registration
	return nil
}

// RegisterPostFindHook registers a post-find hook for the given resource type.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) RegisterPostFindHook(
	hook types.PostHook[types.FindResult],
) error {
	c.hookManager.RegisterPostFindHook(hook)
	// TODO - add error checking in hook manager registration
	return nil
}

// RegisterPostCreateHook registers a post-create hook for the given resource type.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) RegisterPostCreateHook(
	hook types.PostHook[types.CreateResult],
) error {
	c.hookManager.RegisterPostCreateHook(hook)
	// TODO - add error checking in hook manager registration
	return nil
}

// RegisterPostUpdateHook registers a post-update hook for the given resource type.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) RegisterPostUpdateHook(
	hook types.PostHook[types.UpdateResult],
) error {
	c.hookManager.RegisterPostUpdateHook(hook)
	// TODO - add error checking in hook manager registration
	return nil
}

// RegisterPostDeleteHook registers a post-delete hook for the given resource type.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) RegisterPostDeleteHook(
	hook types.PostHook[types.DeleteResult],
) error {
	c.hookManager.RegisterPostDeleteHook(hook)
	// TODO - add error checking in hook manager registration
	return nil
}

// get our client and resourcer outside to slim down the methods.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) retrieveClientResourcer(
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
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) Get(
	resource string,
	namespace string,
	input types.GetInput,
) *types.GetResult {
	ctx := context.TODO()

	errHandler := func(err error) *types.GetResult {
		result := types.NewGetResult()
		result.RecordError(err)
		return result
	}

	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return errHandler(fmt.Errorf("unable to retrieve client and resourcer: %w", err))
	}

	// create our final result object
	hooks := c.hookManager.GetHooksForGet(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return errHandler(fmt.Errorf("unable to run prehooks: %w", err))
	}

	// execute the resourcer
	result := resourcer.Get(ctx, client, input)
	if result == nil {
		return errHandler(errors.New("resourcer returned no data"))
	}
	if result.Errors != nil && len(result.Errors) > 0 {
		return result
	}

	// run the post-operation hooks
	if err = runPostHooks(result, hooks); err != nil {
		result.RecordError(fmt.Errorf("unable to run posthooks: %w", err))
		return result
	}

	return result
}

// List lists resources within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) List(
	resource string,
	namespace string,
	input types.ListInput,
) *types.ListResult {
	ctx := context.TODO()

	errHandler := func(err error) *types.ListResult {
		result := types.NewListResult()
		result.RecordError(err)
		return result
	}

	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return errHandler(fmt.Errorf("unable to retrieve client and resourcer: %w", err))
	}

	hooks := c.hookManager.GetHooksForList(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return errHandler(fmt.Errorf("unable to run prehooks: %w", err))
	}

	result := resourcer.List(ctx, client, input)
	if result == nil {
		return errHandler(errors.New("resourcer returned no data"))
	}
	if result.Errors != nil && len(result.Errors) > 0 {
		return result
	}

	if err = runPostHooks(result, hooks); err != nil {
		result.RecordError(fmt.Errorf("unable to run posthooks: %w", err))
		return result
	}

	return result
}

// Find finds resources within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) Find(
	resource string,
	namespace string,
	input types.FindInput,
) *types.FindResult {
	ctx := context.TODO()

	errHandler := func(err error) *types.FindResult {
		result := types.NewFindResult()
		result.RecordError(err)
		return result
	}

	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return errHandler(fmt.Errorf("unable to retrieve client and resourcer: %w", err))
	}

	hooks := c.hookManager.GetHooksForFind(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return errHandler(fmt.Errorf("unable to run prehooks: %w", err))
	}

	result := resourcer.Find(ctx, client, input)
	if result == nil {
		return errHandler(errors.New("resourcer returned no data"))
	}
	if result.Errors != nil && len(result.Errors) > 0 {
		return result
	}
	if err = runPostHooks(result, hooks); err != nil {
		result.RecordError(fmt.Errorf("unable to run posthooks: %w", err))
		return result
	}

	return result
}

// Create creates a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) Create(
	resource string,
	namespace string,
	input types.CreateInput,
) *types.CreateResult {
	ctx := context.TODO()

	errHandler := func(err error) *types.CreateResult {
		result := types.NewCreateResult()
		result.RecordError(err)
		return result
	}

	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return errHandler(fmt.Errorf("unable to retrieve client and resourcer: %w", err))
	}

	hooks := c.hookManager.GetHooksForCreate(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return errHandler(fmt.Errorf("unable to run prehooks: %w", err))
	}

	result := resourcer.Create(ctx, client, input)
	if result == nil {
		return errHandler(errors.New("resourcer returned no data"))
	}
	if result.Errors != nil && len(result.Errors) > 0 {
		return result
	}

	if err = runPostHooks(result, hooks); err != nil {
		result.RecordError(fmt.Errorf("unable to run posthooks: %w", err))
		return result
	}

	return result
}

// Update updates a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) Update(
	resource string,
	namespace string,
	input types.UpdateInput,
) *types.UpdateResult {
	ctx := context.TODO()

	errHandler := func(err error) *types.UpdateResult {
		result := types.NewUpdateResult()
		result.RecordError(err)
		return result
	}

	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return errHandler(fmt.Errorf("unable to retrieve client and resourcer: %w", err))
	}

	hooks := c.hookManager.GetHooksForUpdate(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return errHandler(fmt.Errorf("unable to run prehooks: %w", err))
	}

	result := resourcer.Update(ctx, client, input)
	if result == nil {
		return errHandler(errors.New("resourcer returned no data"))
	}
	if result.Errors != nil && len(result.Errors) > 0 {
		return result
	}

	if err = runPostHooks(result, hooks); err != nil {
		result.RecordError(fmt.Errorf("unable to run posthooks: %w", err))
		return result
	}

	return result
}

// Delete deletes a resource within a resource namespace given an identifier and input options.
func (c *resourceController[ClientT, NamespaceDT, NamespaceSDT]) Delete(
	resource string,
	namespace string,
	input types.DeleteInput,
) *types.DeleteResult {
	ctx := context.TODO()

	errHandler := func(err error) *types.DeleteResult {
		result := types.NewDeleteResult()
		result.RecordError(err)
		return result
	}

	client, resourcer, err := c.retrieveClientResourcer(resource, namespace)
	if err != nil {
		return errHandler(fmt.Errorf("unable to retrieve client and resourcer: %w", err))
	}

	hooks := c.hookManager.GetHooksForDelete(resource)

	// run our prehooks
	if err = runPreHooks(input, hooks); err != nil {
		return errHandler(fmt.Errorf("unable to run prehooks: %w", err))
	}

	result := resourcer.Delete(ctx, client, input)
	if result == nil {
		return errHandler(errors.New("resourcer returned no data"))
	}
	if result.Errors != nil && len(result.Errors) > 0 {
		return result
	}

	if err = runPostHooks(result, hooks); err != nil {
		result.RecordError(fmt.Errorf("unable to run posthooks: %w", err))
		return result
	}

	return result
}
