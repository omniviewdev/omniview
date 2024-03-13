package services

import (
	"fmt"
	"sync"

	"github.com/omniviewdev/plugin/pkg/resource/factories"
	"github.com/omniviewdev/plugin/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin/pkg/types"
)

// ResourceTypeManager is the interface for which resource type managers must implement.
//
// If a resource backend has a dynamic set of resource types that can change with each
// auth context (for example, different Kubernetes Clusters running different versions),
// it should instantiate a DynamicResourceTypeManager.
//
// If a resource backend has a static set of resource types that does not change with each
// auth context (for example, AWS, GCP, Azure, etc.), it should instantiate the
// StaticResourceTypeManager.
type ResourceTypeManager interface {
	// GetResourceTypes returns the all of the available resource types for the resource manager
	GetResourceTypes() map[string]types.ResourceMeta

	// GetResourceType returns the resource type information by it's string representation
	// For example, "core::v1::Pod" or "ec2::2012-12-01::EC2Instance"
	GetResourceType(string) (*types.ResourceMeta, error)

	// HasResourceType checks to see if the resource type exists
	HasResourceType(string) bool

	// GetAvailableResourceTypes returns the available resource types for the given namespace
	GetContextResourceTypes(string) ([]types.ResourceMeta, error)

	// SyncResourceNamespace sets up a given auth context with the manager, and syncs the available resource types
	// given a set of options
	SyncAuthContext(*pkgtypes.PluginContext, *pkgtypes.AuthContext) error

	// and stops the client for the namespace
	RemoveAuthContext(*pkgtypes.PluginContext, *pkgtypes.AuthContext) error
}

// StaticResourceTypeManager is a resource type manager that provides a static set of resource types
// that does not change with each auth context. This is useful for resource backends that have
// a static set of resource types that does not change with each auth context, for example, AWS,
// GCP, Azure, etc.
type StaticResourceTypeManager struct {
	// resourceTypes is a map of available resource types for the resource manager
	resourceTypes map[string]types.ResourceMeta

	// namespacedResourceTypes is a map of available resource types for a given auth context
	namespacedResourceTypes map[string][]types.ResourceMeta

	sync.RWMutex // embed this last for pointer receiver semantics
}

// NewStaticResourceTypeManager creates a new resource type manager with a static set of resource types
// that does not change with each auth context
// For example, AWS, GCP, Azure, etc.
func NewStaticResourceTypeManager(
	resourceTypes []types.ResourceMeta,
) ResourceTypeManager {
	manager := newStaticResourceTypeManager(resourceTypes)
	return &manager
}

func newStaticResourceTypeManager(
	resourceTypes []types.ResourceMeta,
) StaticResourceTypeManager {
	resourceTypesMap := make(map[string]types.ResourceMeta)
	for _, resource := range resourceTypes {
		resourceTypesMap[resource.String()] = resource
	}
	return StaticResourceTypeManager{
		resourceTypes:           resourceTypesMap,
		namespacedResourceTypes: make(map[string][]types.ResourceMeta),
	}
}

func (r *StaticResourceTypeManager) GetResourceTypes() map[string]types.ResourceMeta {
	r.RLock()
	defer r.RUnlock()

	return r.resourceTypes
}

func (r *StaticResourceTypeManager) GetResourceType(
	s string,
) (*types.ResourceMeta, error) {
	r.RLock()
	defer r.RUnlock()

	if resource, ok := r.resourceTypes[s]; ok {
		return &resource, nil
	}
	return nil, fmt.Errorf("resource type %s does not exist", s)
}

func (r *StaticResourceTypeManager) HasResourceType(s string) bool {
	r.RLock()
	defer r.RUnlock()

	_, ok := r.resourceTypes[s]
	return ok
}

func (r *StaticResourceTypeManager) SyncAuthContext(
	pluginCtx *pkgtypes.PluginContext,
	authCtx *pkgtypes.AuthContext,
) error {
	r.Lock()
	defer r.Unlock()

	if _, ok := r.namespacedResourceTypes[authCtx.ID]; !ok {
		r.namespacedResourceTypes[authCtx.ID] = make(
			[]types.ResourceMeta,
			0,
			len(r.resourceTypes),
		)
		for _, resource := range r.resourceTypes {
			r.namespacedResourceTypes[authCtx.ID] = append(
				r.namespacedResourceTypes[authCtx.ID],
				resource,
			)
		}
	}
	return nil
}

func (r *StaticResourceTypeManager) GetContextResourceTypes(
	authCtxID string,
) ([]types.ResourceMeta, error) {
	r.RLock()
	defer r.RUnlock()
	if availableResourceTypes, ok := r.namespacedResourceTypes[authCtxID]; ok {
		return availableResourceTypes, nil
	}
	return nil, fmt.Errorf("no available resource types for auth context %s", authCtxID)
}

func (r *StaticResourceTypeManager) RemoveAuthContext(
	pluginCtx *pkgtypes.PluginContext,
	authCtx *pkgtypes.AuthContext,
) error {
	r.Lock()
	defer r.Unlock()

	delete(r.namespacedResourceTypes, authCtx.ID)
	return nil
}

func (r *StaticResourceTypeManager) GetAvailableResourceTypes(
	ctx *pkgtypes.PluginContext,
	authCtx *pkgtypes.AuthContext,
) ([]types.ResourceMeta, error) {
	r.RLock()
	defer r.RUnlock()

	if availableResourceTypes, ok := r.namespacedResourceTypes[authCtx.ID]; ok {
		return availableResourceTypes, nil
	}
	return nil, fmt.Errorf("no available resource types for auth context %s", authCtx.ID)
}

// DynamicResourceTypeManager is an resource type manager that provides a dynamic set of resource types
// that can change with each auth context. This is useful for resource backends that have a dynamic
// set of resource types that can change with each auth context, for example, different Kubernetes
// Clusters running different versions.
//
// The discovery manager requires defining the the type of the discovery client, as well as
// the options type for the discovery client. The discovery client is responsible for
// discovering the available resource types within a auth context, e.g. a Kubernetes
// cluster, AWS account, etc.
//
// This discovery manager is optional, and if none is provided, the resource manager will
// use all resource types provided by the resource type manager.
type DynamicResourceTypeManager[DiscoveryClientT any] struct {
	// clientFactory is the client factory for the resource type discovery manager
	clientFactory factories.ResourceDiscoveryClientFactory[DiscoveryClientT]

	// clients is a map of clients for the resource type discovery manager
	clients map[string]*DiscoveryClientT

	// syncer is the getter function that, taking in the respective client, can retrieve and then
	// return the available resource types for a given namespace
	syncer func(ctx *pkgtypes.PluginContext, client *DiscoveryClientT) ([]types.ResourceMeta, error)

	StaticResourceTypeManager // embed this last for pointer receiver semantics
}

// NewDynamicResourceTypeManager creates a new resource type discovery manager to be
// used with the the resource backend, given a client factory and a sync function.
func NewDynamicResourceTypeManager[DiscoveryClientT any](
	resourceTypes []types.ResourceMeta,
	factory factories.ResourceDiscoveryClientFactory[DiscoveryClientT],
	syncer func(ctx *pkgtypes.PluginContext, client *DiscoveryClientT) ([]types.ResourceMeta, error),
) ResourceTypeManager {
	return &DynamicResourceTypeManager[DiscoveryClientT]{
		StaticResourceTypeManager: newStaticResourceTypeManager(
			resourceTypes,
		),
		clientFactory: factory,
		clients:       make(map[string]*DiscoveryClientT),
		syncer:        syncer,
	}
}

func (r *DynamicResourceTypeManager[DiscoveryClientT]) SyncResourceNamespace(
	ctx *pkgtypes.PluginContext,
	authCtx *pkgtypes.AuthContext,
) error {
	r.Lock()
	defer r.Unlock()

	// check if the client already exists for the namespace
	if _, ok := r.clients[authCtx.ID]; !ok {
		// create the client for the namespace
		client, err := r.clientFactory.CreateClient(ctx, authCtx)
		if err != nil {
			err = fmt.Errorf(
				"failed to create client for auth context %s: %w",
				authCtx.ID,
				err,
			)
			return err
		}

		// start the client
		if err = r.clientFactory.StartClient(ctx, client); err != nil {
			err = fmt.Errorf(
				"failed to start client for auth context %s: %w",
				authCtx.ID,
				err,
			)
			return err
		}

		r.clients[authCtx.ID] = client
	}

	// get the client for the namespace and sync the available resource types
	client := r.clients[authCtx.ID]
	availableResourceTypes, err := r.syncer(ctx, client)
	if err != nil {
		return err
	}
	if availableResourceTypes == nil {
		return fmt.Errorf(
			"syncer returned nil available resource types for auth context %s",
			authCtx.ID,
		)
	}

	return nil
}

func (r *DynamicResourceTypeManager[DiscoveryClientT]) RemoveAuthContext(
	ctx *pkgtypes.PluginContext,
	authCtx *pkgtypes.AuthContext,
) error {
	r.Lock()
	defer r.Unlock()

	// stop the client for the namespace if the namespace exists
	if client, ok := r.clients[authCtx.ID]; ok {
		if err := r.clientFactory.StopClient(ctx, client); err != nil {
			return err
		}
	}

	// delete the client and the available resource types for the namespace if the namespace exists
	delete(r.clients, authCtx.ID)
	delete(r.namespacedResourceTypes, authCtx.ID)

	return nil
}

// GetAvailableResourceTypes returns the available resource types for the given namespace.
func (r *DynamicResourceTypeManager[DiscoveryClientT]) GetAvailableResourceTypes(
	ctx *pkgtypes.PluginContext,
	authCtx *pkgtypes.AuthContext,
) ([]types.ResourceMeta, error) {
	r.Lock()
	defer r.Unlock()
	// check if the available resource types for the namespace exist
	if availableResourceTypes, ok := r.namespacedResourceTypes[authCtx.ID]; ok {
		return availableResourceTypes, nil
	}

	return nil, fmt.Errorf("no available resource types for auth context %s", authCtx.ID)
}
