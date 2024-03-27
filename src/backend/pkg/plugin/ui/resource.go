package ui

import (
	"errors"
	"fmt"
)

type ResourceComponentArea string

const (
	ResourceComponentAreaSidebar ResourceComponentArea = "SIDEBAR"
	ResourceComponentAreaTable   ResourceComponentArea = "TABLE"
)

// ResourceComponent represents a UI component that can be displayed as part of the UI.
type ResourceComponent struct {
	Owner          string                `json:"owner"     yaml:"owner"`
	Name           string                `json:"name"      yaml:"name"`
	Plugin         string                `json:"plugin"    yaml:"plugin"`
	Resource       string                `json:"resource"  yaml:"resource"`
	Area           ResourceComponentArea `json:"area"      yaml:"area"`
	ExtensionPoint string                `json:"extension" yaml:"extension"`
	Extensions     []ResourceComponent   `json:"-"         yaml:"-"`
}

func (rc ResourceComponent) String() string {
	return fmt.Sprintf("%s/%s/%s/%s", rc.Owner, rc.Plugin, rc.Resource, rc.Name)
}

// ResourceComponentStore keeps a nested map of plugin->resourceID->Components
// so the UI knows what is available to render.
type ResourceComponentStore map[string]map[string][]ResourceComponent

// NewResourceComponentStore creates a new ResourceComponentStore.
func NewResourceComponentStore() ResourceComponentStore {
	return make(ResourceComponentStore)
}

// AddPlugin adds a plugin to the store.
func (pcs ResourceComponentStore) AddPlugin(plugin string) {
	if _, ok := pcs[plugin]; !ok {
		pcs[plugin] = make(map[string][]ResourceComponent)
	}
}

// RemovePlugin removes a plugin from the store.
func (pcs ResourceComponentStore) RemovePlugin(plugin string) {
	delete(pcs, plugin)
}

func validateResourceComponent(rc ResourceComponent) error {
	if rc.Owner == "" {
		return errors.New("owner is required")
	}
	if rc.Plugin == "" {
		return errors.New("plugin is required")
	}
	if rc.Resource == "" {
		return errors.New("resource is required")
	}
	if rc.Name == "" {
		return errors.New("name is required")
	}
	if rc.Area == "" {
		return errors.New("area is required")
	}
	return nil
}

// AddComponent adds a component to the store.
func (pcs ResourceComponentStore) AddComponent(resource ResourceComponent) error {
	if err := validateResourceComponent(resource); err != nil {
		return err
	}

	found, ok := pcs[resource.Plugin]
	if !ok {
		found = make(map[string][]ResourceComponent)
	} else {
		// prevent double adding the same component
		for _, comp := range found[resource.Resource] {
			if comp.String() == resource.String() {
				return fmt.Errorf(
					"component %s already exists in plugin %s for resource %s",
					resource.Name,
					resource.Plugin,
					resource.Resource,
				)
			}
		}
	}

	// all good, add the resource component
	found[resource.Resource] = append(found[resource.Resource], resource)
	pcs[resource.Plugin] = found
	return nil
}

// GetComponents returns the components for a given plugin and resource.
func (pcs ResourceComponentStore) GetComponentsForResource(
	plugin, resource string,
) []ResourceComponent {
	if plugin == "" || resource == "" {
		return nil
	}

	if _, ok := pcs[plugin]; !ok {
		return nil
	}
	return pcs[plugin][resource]
}

// GetComponentsByPlugin returns the components for a given plugin.
func (pcs ResourceComponentStore) GetComponentsByResource(
	plugin string,
) map[string][]ResourceComponent {
	if plugin == "" {
		return nil
	}

	return pcs[plugin]
}
