package services

import (
	"context"
	"fmt"
	"sync"

	"github.com/infraview/plugin/pkg/resource/types"
)

// Resourcer is an interface that all resources must implement in order
// to be registered with the plugin system and the resource manager.
//
// Resourcers are responsibile for for the business logic of listing,
// creating, updating, and deleting resources in a resource backend.
// Each resource type should have its own Resourcer implementation that
// knows how to interact with the backend for that resource type. Operations here are
// resource-namespace agnostic, and will be provided a client scoped to a resource
// namesspace from the resource manager when they are invoked.
//
// Some resources may have additional functionality, such as with the Kubernetes
// client, which allows the setup of an informer (also used in the informer) of
// which the Resourcer uses a shared client. As such, Resourcers should be written
// agnostic of the underlying resource client, and should be able to be used
// with any resource client that implements the ResourceClient interface.
//
// For example, the Kubernetes plugin defines a Resourcer for each
// GroupVersionKind that it supports, such as core.v1.Pod, core.v1.Service, etc.
// Each of these Resourcers knows how to interact with the Kubernetes API server
// for that resource type.
type Resourcer[ClientT, T any] interface {
	// Get returns a single resource in the given resource namespace.
	Get(ctx context.Context, client *ClientT, input types.GetInput) (*types.GetResult[T], error)

	// List returns a list of resources in the given resource namespace.
	List(ctx context.Context, client *ClientT, input types.ListInput) (*types.ListResult[T], error)

	// FindResources returns a list of resources in the given resource namespace that
	// match a set of given options.
	//
	// Due to the dynamic nature of the options, the options are passed as an interface
	// and the Resourcer is responsible for casting the options to the correct type.
	Find(ctx context.Context, client *ClientT, input types.FindInput) (*types.FindResult[T], error)

	// Create creates a new resource in the given resource namespace.
	Create(ctx context.Context, client *ClientT, input types.CreateInput) (*types.CreateResult[T], error)

	// Update updates an existing resource in the given resource namespace.
	Update(ctx context.Context, client *ClientT, input types.UpdateInput) (*types.UpdateResult[T], error)

	// Delete deletes an existing resource in the given resource namespace.
	Delete(ctx context.Context, client *ClientT, input types.DeleteInput) (*types.DeleteResult, error)
}

// ResourcerManager manages all of the resourcers for a given resource type. It is responsible for
// registering, retreiving, and managing resourcers for a given resource type.
type ResourceManager[ClientT, T any] interface {
	// RegisterResourcer registers a new resourcer for the given resource type
	RegisterResourcer(resourceType string, resourcer Resourcer[ClientT, T]) error
	// DeregisterResourcer deregisters the resourcer for the given resource type
	DeregisterResourcer(resourceType string) error
	// GetResourcer returns the resourcer for the given resource type
	GetResourcer(resourceType string) (Resourcer[ClientT, T], error)
}

type resourcerManager[ClientT, T any] struct {
	// map of resource type to resourcer
	store map[string]Resourcer[ClientT, T]
	// put this last for pointer byte alignment
	sync.RWMutex
}

// RegisterResourcer registers a new resourcer for the given resource type
func (r *resourcerManager[ClientT, T]) RegisterResourcer(resourceType string, resourcer Resourcer[ClientT, T]) error {
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
func (r *resourcerManager[ClientT, T]) GetResourcer(resourceType string) (Resourcer[ClientT, T], error) {
	r.RLock()
	defer r.RUnlock()
	resourcer, exists := r.store[resourceType]
	if !exists {
		return nil, fmt.Errorf("resourcer for resource type %s does not exist", resourceType)
	}
	return resourcer, nil
}
