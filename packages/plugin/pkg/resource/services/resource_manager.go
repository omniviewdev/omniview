package services

import (
	"fmt"
	"sync"

	"github.com/infraview/plugin/pkg/resource/types"
)

// ResourcerManager manages all of the resourcers for a given resource type. It is responsible for
// registering, retreiving, and managing resourcers for a given resource type.
type ResourceManager[ClientT any] interface {
	// RegisterResourcer registers a new resourcer for the given resource type
	RegisterResourcer(resourceType string, resourcer types.Resourcer[ClientT]) error
	// DeregisterResourcer deregisters the resourcer for the given resource type
	DeregisterResourcer(resourceType string) error
	// GetResourcer returns the resourcer for the given resource type
	GetResourcer(resourceType string) (types.Resourcer[ClientT], error)
}

type resourcerManager[ClientT, T any] struct {
	// map of resource type to resourcer
	store map[string]types.Resourcer[ClientT]
	// put this last for pointer byte alignment
	sync.RWMutex
}

// RegisterResourcer registers a new resourcer for the given resource type
func (r *resourcerManager[ClientT, T]) RegisterResourcer(resourceType string, resourcer types.Resourcer[ClientT]) error {
	r.Lock()
	defer r.Unlock()

	if _, exists := r.store[resourceType]; exists {
		return fmt.Errorf("resourcer for resource type %s already exists", resourceType)
	}

	r.store[resourceType] = resourcer
	return nil
}

// DeregisterResourcer deregisters the resourcer for the given resource type
func (r *resourcerManager[ClientT, T]) DeregisterResourcer(resourceType string) error {
	r.Lock()
	defer r.Unlock()
	if _, exists := r.store[resourceType]; !exists {
		return fmt.Errorf("resourcer for resource type %s does not exist", resourceType)
	}
	delete(r.store, resourceType)
	return nil
}

// GetResourcer returns the resourcer for the given resource type
func (r *resourcerManager[ClientT, T]) GetResourcer(resourceType string) (types.Resourcer[ClientT], error) {
	r.RLock()
	defer r.RUnlock()
	resourcer, exists := r.store[resourceType]
	if !exists {
		return nil, fmt.Errorf("resourcer for resource type %s does not exist", resourceType)
	}
	return resourcer, nil
}
