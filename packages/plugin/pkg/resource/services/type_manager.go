package services

import (
	"context"
	"fmt"
	"sync"

	"go.uber.org/zap"

	"github.com/infraview/plugin/pkg/resource/factories"
	"github.com/infraview/plugin/pkg/resource/types"
)

// ResourceTypeManager is the interface for which resource type managers must implement.
//
// If a resource backend has a dynamic set of resource types that can change with each
// resource namespace (for example, different Kubernetes Clusters running different versions),
// it should instantiate a DynamicResourceTypeManager.
//
// If a resource backend has a static set of resource types that does not change with each
// resource namespace (for example, AWS, GCP, Azure, etc.), it should instantiate the
// StaticResourceTypeManager.
type ResourceTypeManager interface {
	// GetResourceTypes returns the all of the available resource types for the resource manager
	GetResourceTypes() map[string]*types.ResourceMeta

	// GetResourceType returns the resource type information by it's string representation
	// For example, "core::v1::Pod" or "ec2::2012-12-01::EC2Instance"
	GetResourceType(string) (*types.ResourceMeta, error)

	// HasResourceType checks to see if the resource type exists
	HasResourceType(string) bool

	// GetAvailableResourceTypes returns the available resource types for the given namespace
	GetAvailableResourceTypes(string) ([]*types.ResourceMeta, error)

	// SyncResourceNamespace sets up a given resource namespace with the manager, and syncs the available resource types
	// given a set of options
	SyncResourceNamespace(context.Context, string, interface{}) error

	// RemoveResourceNamespace removes a resource namespace from the resource manager
	// and stops the client for the namespace
	RemoveResourceNamespace(context.Context, string) error
}

// StaticResourceTypeManager is a resource type manager that provides a static set of resource types
// that does not change with each resource namespace. This is useful for resource backends that have
// a static set of resource types that does not change with each resource namespace, for example, AWS,
// GCP, Azure, etc.
type StaticResourceTypeManager struct {
	// logger is the logger for the resource type manager
	logger *zap.SugaredLogger

	// resourceTypes is a map of available resource types for the resource manager
	resourceTypes map[string]*types.ResourceMeta

	// namespacedResourceTypes is a map of available resource types for a given resource namespace
	namespacedResourceTypes map[string][]*types.ResourceMeta

	sync.RWMutex // embed this last for pointer receiver semantics
}

// NewStaticResourceTypeManager creates a new resource type manager with a static set of resource types
// that does not change with each resource namespace
// For example, AWS, GCP, Azure, etc.
func NewStaticResourceTypeManager(logger *zap.SugaredLogger, resourceTypes map[string]*types.ResourceMeta) ResourceTypeManager {
	return &StaticResourceTypeManager{
		logger:                  logger,
		resourceTypes:           resourceTypes,
		namespacedResourceTypes: make(map[string][]*types.ResourceMeta),
	}
}

// GetResourceTypes returns the all of the available resource types for the resource manager.
func (r *StaticResourceTypeManager) GetResourceTypes() map[string]*types.ResourceMeta {
	r.RLock()
	defer r.RUnlock()

	return r.resourceTypes
}

// GetResourceType returns the resource type information by it's string representation.
func (r *StaticResourceTypeManager) GetResourceType(s string) (*types.ResourceMeta, error) {
	r.RLock()
	defer r.RUnlock()

	if resource, ok := r.resourceTypes[s]; ok {
		return resource, nil
	}
	return nil, fmt.Errorf("resource type %s does not exist", s)
}

// HasResourceType checks to see if the resource type exists.
func (r *StaticResourceTypeManager) HasResourceType(s string) bool {
	r.RLock()
	defer r.RUnlock()

	_, ok := r.resourceTypes[s]
	return ok
}

// SyncResourceNamespace syncs the available resource types for a given namespace. If the namespace is not
// already initialized, it will create the client for the namespace and then sync the available resource types.
func (r *StaticResourceTypeManager) SyncResourceNamespace(ctx context.Context, namespace string, clientOpts interface{}) error {
	r.Lock()
	defer r.Unlock()

	if _, ok := r.namespacedResourceTypes[namespace]; !ok {
		r.namespacedResourceTypes[namespace] = make([]*types.ResourceMeta, 0, len(r.resourceTypes))
		for _, resource := range r.resourceTypes {
			r.namespacedResourceTypes[namespace] = append(r.namespacedResourceTypes[namespace], resource)
		}
	}
	return nil
}

// RemoveResourceNamespace removes a resource namespace from the resource type manager.
func (r *StaticResourceTypeManager) RemoveResourceNamespace(ctx context.Context, namespace string) error {
	r.Lock()
	defer r.Unlock()

	delete(r.namespacedResourceTypes, namespace)
	return nil
}

// GetAvailableResourceTypes returns the available resource types for the given namespace.
func (r *StaticResourceTypeManager) GetAvailableResourceTypes(namespace string) ([]*types.ResourceMeta, error) {
	r.RLock()
	defer r.RUnlock()

	if availableResourceTypes, ok := r.namespacedResourceTypes[namespace]; ok {
		return availableResourceTypes, nil
	}
	return nil, fmt.Errorf("no available resource types for namespace %s", namespace)
}

// DynamicResourceTypeManager is an resource type manager that provides a dynamic set of resource types
// that can change with each resource namespace. This is useful for resource backends that have a dynamic
// set of resource types that can change with each resource namespace, for example, different Kubernetes
// Clusters running different versions.
//
// The discovery manager requires defining the the type of the discovery client, as well as
// the options type for the discovery client. The discovery client is responsible for
// discovering the available resource types within a resource namespace, e.g. a Kubernetes
// cluster, AWS account, etc.
//
// This discovery manager is optional, and if none is provided, the resource manager will
// use all resource types provided by the resource type manager.
type DynamicResourceTypeManager[T any] struct {
	// clientFactory is the client factory for the resource type discovery manager
	clientFactory factories.ResourceDiscoveryClientFactory[T]

	// clients is a map of clients for the resource type discovery manager
	clients map[string]*T

	// syncer is the getter function that, taking in the respective client, can retrieve and then
	// return the available resource types for a given namespace
	syncer func(ctx context.Context, client *T) ([]*types.ResourceMeta, error)

	StaticResourceTypeManager // embed this last for pointer receiver semantics
}

// NewDynamicResourceTypeManager creates a new resource type discovery manager to be
// used with the the resource backend, given a client factory and a sync function.
func NewDynamicResourceTypeManager[T any](
	logger *zap.SugaredLogger,
	resourceTypes map[string]*types.ResourceMeta,
	factory factories.ResourceDiscoveryClientFactory[T],
	syncer func(ctx context.Context, client *T) ([]*types.ResourceMeta, error),
) ResourceTypeManager {
	return &DynamicResourceTypeManager[T]{
		StaticResourceTypeManager: StaticResourceTypeManager{
			logger:                  logger,
			resourceTypes:           resourceTypes,
			namespacedResourceTypes: make(map[string][]*types.ResourceMeta),
		},
		clientFactory: factory,
		clients:       make(map[string]*T),
		syncer:        syncer,
	}
}

// SyncResourceNamespace syncs the available resource types for a given namespace. If the namespace is not
// already initialized, it will create the client for the namespace and then sync the available resource types.
//
// This operation is idempotent and can be called multiple times without issue.
func (r *DynamicResourceTypeManager[T]) SyncResourceNamespace(ctx context.Context, namespace string, clientOpts interface{}) error {
	r.Lock()
	defer r.Unlock()

	// check if the client already exists for the namespace
	if _, ok := r.clients[namespace]; !ok {
		// create the client for the namespace
		client, err := r.clientFactory.CreateClient(ctx, clientOpts)
		if err != nil {
			err = fmt.Errorf("failed to create client for resource namespace %s: %v", namespace, err)
			return err
		}

		// start the client
		if err = r.clientFactory.StartClient(ctx, client); err != nil {
			err = fmt.Errorf("failed to start client for resource namespace %s: %v", namespace, err)
			return err
		}

		r.clients[namespace] = client
	}

	// get the client for the namespace and sync the available resource types
	client := r.clients[namespace]
	availableResourceTypes, err := r.syncer(ctx, client)
	if err != nil {
		return err
	}
	if availableResourceTypes == nil {
		return fmt.Errorf("syncer returned nil available resource types for namespace %s", namespace)
	}

	return nil
}

// RemoveResourceNamespace removes a resource namespace from the resource type discovery manager
// and stops the client for the namespace.
func (r *DynamicResourceTypeManager[T]) RemoveResourceNamespace(ctx context.Context, namespace string) error {
	r.Lock()
	defer r.Unlock()

	// stop the client for the namespace if the namespace exists
	if client, ok := r.clients[namespace]; ok {
		if err := r.clientFactory.StopClient(ctx, client); err != nil {
			return err
		}
	}

	// delete the client and the available resource types for the namespace if the namespace exists
	delete(r.clients, namespace)
	delete(r.namespacedResourceTypes, namespace)

	return nil
}

// GetAvailableResourceTypes returns the available resource types for the given namespace.
func (r *DynamicResourceTypeManager[T]) GetAvailableResourceTypes(namespace string) ([]*types.ResourceMeta, error) {
	r.Lock()
	defer r.Unlock()
	// check if the available resource types for the namespace exist
	if availableResourceTypes, ok := r.namespacedResourceTypes[namespace]; ok {
		return availableResourceTypes, nil
	}

	return nil, fmt.Errorf("no available resource types for namespace %s", namespace)
}
