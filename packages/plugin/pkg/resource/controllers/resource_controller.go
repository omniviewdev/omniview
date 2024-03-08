package controllers

import (
	"context"
	"errors"
	"fmt"
	"reflect"

	"go.uber.org/zap"

	"github.com/infraview/plugin/pkg/resource/services"
	"github.com/infraview/plugin/pkg/resource/types"
)

// ResourceController is responsible for managing the execution of resource operations.
// The resource controller will take in requests from requesters, both inside the IDE
// and outside, and will execute the necessary operations on the resource manager.
//
// This controller is the primary entrypoint for executing operations on resources.
// TODO
type ResourceController interface{}

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

// Get gets a resource within a resource namespace given an identifier and input options.
// This is the main pipeline for getting a resource from a resource manager.
func (c *resourceController[ClientT, OptionsT]) Get(
	ctx context.Context,
	model interface{},
	resource string,
	namespace string,
	input types.GetInput,
) (*types.GetResult[any], error) {
	// get the resourcer for the given resource type, and check type
	if ok := c.resourceTypeManager.HasResourceType(resource); !ok {
		return nil, fmt.Errorf("resource type %s not found in resource type manager", resource)
	}

	resourcer, err := c.resourceManager.GetResourcer(resource)
	if err != nil {
		return nil, fmt.Errorf("resourcer not found for resource type %s: %w", resource, err)
	}

	// 2. Get the client for the given resource namespace, ensuring it is of the correct type
	client, err := c.namespaceManager.GetNamespaceClient(namespace)
	if err != nil {
		return nil, fmt.Errorf("client unable to be retrieved for namespace %s: %w", namespace, err)
	}

	// ensure the client is of the correct type for the resource controller
	expectedType := reflect.TypeOf((*ClientT)(nil)).Elem()
	clientType := reflect.TypeOf(client)

	// Compare the types.
	if clientType != expectedType {
		return nil, fmt.Errorf(
			"client type %s does not match expected type %s for namespace %s",
			clientType,
			expectedType,
			namespace,
		)
	}

	// create our final result object
	result := types.NewGetResult(model)
	hooks := c.hookManager.GetHooksForGet(resource)

	// run our prehooks
	for _, preMutateHook := range hooks.PreMutatation {
		if err = preMutateHook.Execute(&input); err != nil {
			return nil, fmt.Errorf("pre-mutate hook failed: %w", err)
		}
	}
	for _, preValidationHook := range hooks.PreValidation {
		if err = preValidationHook.Execute(&input); err != nil {
			return nil, fmt.Errorf("pre-validation hook failed: %w", err)
		}
	}
	for _, beforeOperationHook := range hooks.BeforeOperation {
		if err = beforeOperationHook.Execute(&input); err != nil {
			return nil, fmt.Errorf("before-operation hook failed: %w", err)
		}
	}

	// execute the resourcer
	if err = resourcer.Get(ctx, client, input, result); err != nil {
		return nil, fmt.Errorf("resourcer failed to get resource: %w", err)
	}

	// ensure the returned resource is of the correct type
	if reflect.TypeOf(result.Result) != reflect.TypeOf(model) {
		return nil, errors.New("resource returned from resourcer is not of the correct type")
	}

	// 6. Run the post-operation hooks
	for _, afterOperationHook := range hooks.AfterOperation {
		if err = afterOperationHook.Execute(result); err != nil {
			return nil, fmt.Errorf("after-operation hook failed: %w", err)
		}
	}
	for _, postValidationHook := range hooks.PostValidation {
		if err = postValidationHook.Execute(result); err != nil {
			return nil, fmt.Errorf("post-validation hook failed: %w", err)
		}
	}
	for _, postMutateHook := range hooks.PostMutation {
		if err = postMutateHook.Execute(result); err != nil {
			return nil, fmt.Errorf("post-mutate hook failed: %w", err)
		}
	}

	return result, nil
}

// TODO - implement the rest of the methods
// List
// Find
// Create
// Update
// Delete
