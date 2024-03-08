package controllers

import (
	"errors"
	"fmt"

	"go.uber.org/zap"

	"github.com/infraview/plugin/internal"
	"github.com/infraview/plugin/pkg/resource/types"
)

type ResourcePluginMessage[M types.OperationInput] struct {
	Payload    M      `json:"payload"`
	ResourceID string `json:"resource_id"`
	Namespace  string `json:"namespace"`
	PluginID   string `json:"plugin_id"`
}

// ResourcePluginController manages the lifecycle and registration of
// resource plugins. It is responsible for registering and unregistering
// resource plugins, starting and stopping resource plugins, and acting as
// the main entry point for the resource plugin system.
//
// To keep with dynamic plugin loading, the resource plugin controller
// proxies all calls to all resource plugins. This allows the resource
// plugin controller to be the main entry point for the resource plugin
// system, and allows for the resource plugins to be loaded and unloaded
// dynamically at runtime.
type ResourcePluginController struct {
	internal.BasePluginController[types.ResourceProvider]
}

// compile time check for interface conformance.
var _ internal.PluginController[types.ResourceProvider] = &ResourcePluginController{}

func NewResourcePluginController(
	logger *zap.SugaredLogger,
	pluginPath string,
	stopCh chan struct{},
) *ResourcePluginController {
	return &ResourcePluginController{
		BasePluginController: internal.NewBasePluginController[types.ResourceProvider](
			logger,
			internal.ResourcePlugin,
			pluginPath,
			stopCh,
		),
	}
}

// GetResource dispatches a get resource request to the appropriate resource plugin.
func (rpc *ResourcePluginController) GetResource(
	message ResourcePluginMessage[types.GetInput],
) (types.GetResult[any], error) {
	rpc.RLock()
	defer rpc.RUnlock()

	empty := types.GetResult[any]{}

	if message.ResourceID == "" {
		return empty, errors.New("dispatch failed: resource ID is empty")
	}

	handler, err := rpc.GetPluginInstance(message.PluginID)
	if err != nil {
		return empty, fmt.Errorf("failed to get plugin handler: %w", err)
	}
	return handler.Get(message.ResourceID, message.Namespace, message.Payload), nil
}

// ListResources dispatches a list resources request to the appropriate resource plugin.
func (rpc *ResourcePluginController) ListResources(
	message ResourcePluginMessage[types.ListInput],
) (types.ListResult[any], error) {
	rpc.RLock()
	defer rpc.RUnlock()

	empty := types.ListResult[any]{}

	handler, err := rpc.GetPluginInstance(message.PluginID)
	if err != nil {
		return empty, fmt.Errorf("failed to get plugin handler: %w", err)
	}
	return handler.List(message.ResourceID, message.Namespace, message.Payload), nil
}

// FindResources dispatches a find resources request to the appropriate resource plugin.
func (rpc *ResourcePluginController) FindResources(
	message ResourcePluginMessage[types.FindInput],
) (types.FindResult[any], error) {
	rpc.RLock()
	defer rpc.RUnlock()

	empty := types.FindResult[any]{}

	handler, err := rpc.GetPluginInstance(message.PluginID)
	if err != nil {
		return empty, fmt.Errorf("failed to get plugin handler: %w", err)
	}
	return handler.Find(message.ResourceID, message.Namespace, message.Payload), nil
}

// CreateResource dispatches a create resource request to the appropriate resource plugin.
func (rpc *ResourcePluginController) CreateResource(
	message ResourcePluginMessage[types.CreateInput],
) (types.CreateResult[any], error) {
	rpc.RLock()
	defer rpc.RUnlock()

	empty := types.CreateResult[any]{}

	handler, err := rpc.GetPluginInstance(message.PluginID)
	if err != nil {
		return empty, fmt.Errorf("failed to get plugin handler: %w", err)
	}
	return handler.Create(message.ResourceID, message.Namespace, message.Payload), nil
}

// UpdateResource dispatches an update resource request to the appropriate resource plugin.
func (rpc *ResourcePluginController) UpdateResource(
	message ResourcePluginMessage[types.UpdateInput],
) (types.UpdateResult[any], error) {
	rpc.RLock()
	defer rpc.RUnlock()

	empty := types.UpdateResult[any]{}

	handler, err := rpc.GetPluginInstance(message.PluginID)
	if err != nil {
		return empty, fmt.Errorf("failed to get plugin handler: %w", err)
	}
	return handler.Update(message.ResourceID, message.Namespace, message.Payload), nil
}

// DeleteResource dispatches a delete resource request to the appropriate resource plugin.
func (rpc *ResourcePluginController) DeleteResource(
	message ResourcePluginMessage[types.DeleteInput],
) (types.DeleteResult, error) {
	rpc.RLock()
	defer rpc.RUnlock()

	empty := types.DeleteResult{}

	handler, err := rpc.GetPluginInstance(message.PluginID)
	if err != nil {
		return empty, fmt.Errorf("failed to get plugin handler: %w", err)
	}
	return handler.Delete(message.ResourceID, message.Namespace, message.Payload), nil
}
