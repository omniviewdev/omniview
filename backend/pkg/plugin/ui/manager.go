package ui

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
	logging "github.com/omniviewdev/plugin-sdk/log"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// ComponentManager is responsible for managing UI components.
type componentManager struct {
	logger                 logging.Logger
	resourceComponentStore ResourceComponentStore
}

// ServiceWrapper exposes only frontend-safe methods of componentManager.
// Internal plugin lifecycle methods (OnPluginInit, OnPluginStart, etc.)
// are excluded to prevent frontend invocation.
type ServiceWrapper struct {
	cm *componentManager
}

// NewServiceWrapper creates a ServiceWrapper around a componentManager.
func NewServiceWrapper(cm *componentManager) *ServiceWrapper {
	return &ServiceWrapper{cm: cm}
}

func (s *ServiceWrapper) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return s.cm.ServiceStartup(ctx, options)
}

func (s *ServiceWrapper) ServiceShutdown() error {
	return s.cm.ServiceShutdown()
}

func (s *ServiceWrapper) GetPluginComponents(params GetPluginComponentsInput) map[string][]ResourceComponent {
	return s.cm.GetPluginComponents(params)
}

func (s *ServiceWrapper) GetResourceComponents(params GetResourceComponentsInput) []ResourceComponent {
	return s.cm.GetResourceComponents(params)
}

func (s *ServiceWrapper) GetResourceAreaComponent(params GetResourceAreaComponentInput) *ResourceComponent {
	return s.cm.GetResourceAreaComponent(params)
}

func NewComponentManager(logger logging.Logger) *componentManager {
	return &componentManager{
		logger:                 logger.Named("ComponentManager"),
		resourceComponentStore: NewResourceComponentStore(),
	}
}

func (cm *componentManager) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return nil
}

func (cm *componentManager) ServiceShutdown() error {
	return nil
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

// =========================== Service methods (formerly in client.go) =========================== //

type GetPluginComponentsInput struct {
	Plugin string `json:"plugin"`
}

// GetPluginComponents returns all the registered components for a plugin.
func (cm *componentManager) GetPluginComponents(
	params GetPluginComponentsInput,
) map[string][]ResourceComponent {
	store := cm.GetResourceComponentStore()
	return store.GetComponentsByResource(params.Plugin)
}

type GetResourceComponentsInput struct {
	Plugin   string `json:"plugin"`
	Resource string `json:"resource"`
}

// GetResourceComponents returns all the registered components for a plugin's resource.
func (cm *componentManager) GetResourceComponents(params GetResourceComponentsInput) []ResourceComponent {
	store := cm.GetResourceComponentStore()
	return store.GetComponentsForResource(params.Plugin, params.Resource)
}

type GetResourceAreaComponentInput struct {
	Plugin   string                `json:"plugin"`
	Resource string                `json:"resource"`
	Area     ResourceComponentArea `json:"area"`
}

// GetResourceAreaComponent returns the preferred component to display for the resource area.
func (cm *componentManager) GetResourceAreaComponent(params GetResourceAreaComponentInput) *ResourceComponent {
	store := cm.GetResourceComponentStore()
	components := store.GetComponentsForResource(params.Plugin, params.Resource)
	for _, component := range components {
		if component.Area == params.Area {
			return &component
		}
	}
	return nil
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
