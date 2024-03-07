package controllers

import (
	"context"

	"github.com/infraview/plugin/pkg/resource/services"
	"go.uber.org/zap"
)

// ResourceController is responsible for managing the execution of resource operations.
// The resource controller will take in requests from requesters, both inside the IDE
// and outside, and will execute the necessary operations on the resource manager.
//
// This controller is the primary entrypoint for executing operations on resources.
// TODO
type ResourceController interface{}

// NewResourceController creates a new resource controller
func NewResourceController[ClientT, OptionsT any](
	ctx context.Context,
	logger *zap.SugaredLogger,
	resourceManager services.ResourceManager[ClientT, OptionsT],
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
	// ctx is the context of the resource controller.
	ctx context.Context
	// logger is the logger for the resource controller.
	logger *zap.SugaredLogger
	// resourceManager is the resource manager that the controller will execute operations on.
	resourceManager services.ResourceManager[ClientT, OptionsT]
	// hookManager is the hook manager that the controller will use to attach hooks to operations.
	hookManager services.ResourceHookManager
	// namespaceManager is the namespace manager that the controller will use to manage resource namespaces.
	namespaceManager services.ResourceNamespaceManager[ClientT, OptionsT]
	// resourceTypeManager is the resource type manager that the controller will use to manage resource types.
	resourceTypeManager services.ResourceTypeManager
}
