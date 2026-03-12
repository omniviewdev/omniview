package ui

import (
	"context"

	logging "github.com/omniviewdev/plugin-sdk/log"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// ComponentManager is responsible for managing UI components.
type componentManager struct {
	logger                 logging.Logger
	resourceComponentStore ResourceComponentStore
}

func NewComponentManager(logger logging.Logger) *componentManager {
	return &componentManager{
		logger:                 logger.Named("ComponentManager"),
		resourceComponentStore: NewResourceComponentStore(),
	}
}

var _ types.PluginManager = (*componentManager)(nil)

func (cm *componentManager) OnPluginInit(_ context.Context, pluginID string, meta config.PluginMeta) error {
	logger := cm.logger.With(logging.Any("pluginID", pluginID), logging.Any("action", "OnPluginInit"))
	logger.Debugw(context.Background(), "initializing plugin")

	cm.resourceComponentStore.AddPlugin(pluginID)
	return nil
}

func (cm *componentManager) OnPluginStart(_ context.Context, pluginID string, meta config.PluginMeta) error {
	logger := cm.logger.With(logging.Any("pluginID", pluginID), logging.Any("action", "OnPluginStart"))
	logger.Debugw(context.Background(), "starting plugin")

	rc := loadResourceComponents(meta)
	for _, c := range rc {
		logger.Debugw(context.Background(), "adding component", "component", c.String())

		if err := cm.resourceComponentStore.AddComponent(c); err != nil {
			// log error
			cm.logger.Errorw(context.Background(), "error adding component", "error", err)
		}
	}
	return nil
}

func (cm *componentManager) OnPluginStop(_ context.Context, pluginID string, meta config.PluginMeta) error {
	logger := cm.logger.With(logging.Any("pluginID", pluginID), logging.Any("action", "OnPluginStop"))
	logger.Debugw(context.Background(), "stopping plugin")

	// nothing to do here
	cm.resourceComponentStore.RemovePlugin(pluginID)
	return nil
}

func (cm *componentManager) OnPluginShutdown(_ context.Context, pluginID string, meta config.PluginMeta) error {
	logger := cm.logger.With(logging.Any("pluginID", pluginID), logging.Any("action", "OnPluginShutdown"))
	logger.Debugw(context.Background(), "shutting down plugin")
	cm.resourceComponentStore.RemovePlugin(pluginID)
	logger.Debugw(context.Background(), "plugin shutdown complete")
	return nil
}

func (cm *componentManager) OnPluginDestroy(_ context.Context, pluginID string, meta config.PluginMeta) error {
	logger := cm.logger.With(logging.Any("pluginID", pluginID), logging.Any("action", "OnPluginDestroy"))
	logger.Debugw(context.Background(), "destroying plugin")
	// not super necessary, but just in case
	cm.resourceComponentStore.RemovePlugin(pluginID)
	return nil
}

func (cm *componentManager) GetResourceComponentStore() ResourceComponentStore {
	return cm.resourceComponentStore
}

// =========================== Handlers =========================== //

func loadResourceComponents(meta config.PluginMeta) []ResourceComponent {
	entries := meta.Components.Resource
	components := make([]ResourceComponent, 0, len(entries))
	for _, entry := range entries {
		// plugin owners can register multiple resources to the same type
		for _, resource := range entry.Resources {
			if entry.Plugin == "" {
				// assume the targeted plugin is the owner
				entry.Plugin = meta.ID
			}

			area := ResourceComponentArea(entry.Area)

			components = append(components, ResourceComponent{
				Owner:          meta.ID,
				Name:           entry.Name,
				Plugin:         entry.Plugin,
				Resource:       resource,
				Area:           area,
				ExtensionPoint: entry.ExtensionPoint,
			})
		}
	}
	return components
}
