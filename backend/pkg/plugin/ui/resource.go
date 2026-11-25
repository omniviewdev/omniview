package ui

import (
	"errors"
	"fmt"
	"sync"
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
//
// The host initialises, starts and stops its plugins from a pool of workers
// (pluginManager.loadPluginsConcurrently) while the frontend asks the service what is
// registered, so one store is used by many goroutines at once. It owns its lock, as the
// controllers of the other plugin managers do, and what it hands out is a copy: a caller (the
// service encodes it for the frontend while another plugin loads) never shares memory with it.
// Use the pointer NewResourceComponentStore answers.
type ResourceComponentStore struct {
	mu      sync.RWMutex
	plugins map[string]map[string][]ResourceComponent
}

// NewResourceComponentStore creates a new ResourceComponentStore.
func NewResourceComponentStore() *ResourceComponentStore {
	return &ResourceComponentStore{
		mu:      sync.RWMutex{},
		plugins: make(map[string]map[string][]ResourceComponent),
	}
}

// AddPlugin adds a plugin to the store.
func (pcs *ResourceComponentStore) AddPlugin(plugin string) {
	pcs.mu.Lock()
	defer pcs.mu.Unlock()

	if _, ok := pcs.plugins[plugin]; !ok {
		pcs.plugins[plugin] = make(map[string][]ResourceComponent)
	}
}

// RemovePlugin removes a plugin from the store.
func (pcs *ResourceComponentStore) RemovePlugin(plugin string) {
	pcs.mu.Lock()
	defer pcs.mu.Unlock()

	delete(pcs.plugins, plugin)
}

// cloneComponents copies a list of components, and the extensions of each, so that the copy shares
// no memory with the list it was made from. A list that is nil stays nil.
func cloneComponents(components []ResourceComponent) []ResourceComponent {
	if components == nil {
		return nil
	}

	cloned := make([]ResourceComponent, len(components))
	for i, component := range components {
		component.Extensions = cloneComponents(component.Extensions)
		cloned[i] = component
	}
	return cloned
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
func (pcs *ResourceComponentStore) AddComponent(resource ResourceComponent) error {
	if err := validateResourceComponent(resource); err != nil {
		return err
	}

	// The check for a double and the adding are one step: two callers that add the same component
	// at once must not both pass the check.
	pcs.mu.Lock()
	defer pcs.mu.Unlock()

	found, ok := pcs.plugins[resource.Plugin]
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

	// all good, add the resource component (its own copy: the caller keeps what it passed)
	resource.Extensions = cloneComponents(resource.Extensions)
	found[resource.Resource] = append(found[resource.Resource], resource)
	pcs.plugins[resource.Plugin] = found
	return nil
}

// GetComponentsForResource returns the components for a given plugin and resource: a copy.
func (pcs *ResourceComponentStore) GetComponentsForResource(
	plugin, resource string,
) []ResourceComponent {
	if plugin == "" || resource == "" {
		return nil
	}

	pcs.mu.RLock()
	defer pcs.mu.RUnlock()

	return cloneComponents(pcs.plugins[plugin][resource])
}

// GetComponentsByResource returns the components for a given plugin, by resource: a copy. A plugin
// that is not in the store has none (nil); one that is has a map, empty when it has no components.
func (pcs *ResourceComponentStore) GetComponentsByResource(
	plugin string,
) map[string][]ResourceComponent {
	if plugin == "" {
		return nil
	}

	pcs.mu.RLock()
	defer pcs.mu.RUnlock()

	found, ok := pcs.plugins[plugin]
	if !ok {
		return nil
	}

	byResource := make(map[string][]ResourceComponent, len(found))
	for resource, components := range found {
		byResource[resource] = cloneComponents(components)
	}
	return byResource
}
