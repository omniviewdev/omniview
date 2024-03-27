package ui

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"go.uber.org/zap"
)

// ComponentManager is responsible for managing UI components.
type componentManager struct {
	logger                 *zap.SugaredLogger
	resourceComponentStore ResourceComponentStore
}

func NewComponentManager(logger *zap.SugaredLogger) *componentManager {
	return &componentManager{
		logger:                 logger.Named("ComponentManager"),
		resourceComponentStore: NewResourceComponentStore(),
	}
}

var _ types.PluginManager = (*componentManager)(nil)

func (cm *componentManager) OnPluginInit(_ context.Context, meta config.PluginMeta) error {
	logger := cm.logger.With("plugin", meta.ID, "action", "OnPluginInit")
	logger.Debug("initializing plugin")

	cm.resourceComponentStore.AddPlugin(meta.ID)
	return nil
}

func (cm *componentManager) OnPluginStart(_ context.Context, meta config.PluginMeta) error {
	logger := cm.logger.With("plugin", meta.ID, "action", "OnPluginStart")
	logger.Debug("starting plugin")

	rc := loadResourceComponents(meta)
	for _, c := range rc {
		logger.Debug("adding component", c.String())

		if err := cm.resourceComponentStore.AddComponent(c); err != nil {
			// log error
			cm.logger.Errorw("error adding component", "error", err)
		}
	}
	return nil
}

func (cm *componentManager) OnPluginStop(_ context.Context, meta config.PluginMeta) error {
	logger := cm.logger.With("plugin", meta.ID, "action", "OnPluginStop")
	logger.Debug("stopping plugin")

	// nothing to do here
	cm.resourceComponentStore.RemovePlugin(meta.ID)
	return nil
}

func (cm *componentManager) OnPluginShutdown(_ context.Context, meta config.PluginMeta) error {
	logger := cm.logger.With("plugin", meta.ID, "action", "OnPluginShutdown")
	logger.Debug("shutting down plugin")
	cm.resourceComponentStore.RemovePlugin(meta.ID)
	return nil
}

func (cm *componentManager) OnPluginDestroy(_ context.Context, meta config.PluginMeta) error {
	logger := cm.logger.With("plugin", meta.ID, "action", "OnPluginDestroy")
	logger.Debug("destroying plugin")
	// not super necessary, but just in case
	cm.resourceComponentStore.RemovePlugin(meta.ID)
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
