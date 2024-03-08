package types

import (
	"net/rpc"
	"time"

	"github.com/hashicorp/go-plugin"
)

type ResourceProviderInput[I OperationInput] struct {
	input       I
	resourceID  string
	namespaceID string
}

type ResourceInformerAddInput struct {
	// A timestamp of when the resource was created. If this is a zero-value time,
	// the time at when the informer message was recieved will be upserted.
	Timestamp time.Time
	// The resource that was created
	Resource interface{}
	// The identifier for the resource
	ID string
}

type ResourceInformerUpdateInput struct {
	// A timestamp of when the resource was created. If this is a zero-value time,
	// the time at when the informer message was recieved will be upserted.
	Timestamp time.Time
	// The updated resource object after modification
	NewResource interface{}
	// The old resource object prior to modification. This is optional,
	// and the IDE will perform a nil check and instead use existing state
	// for the diff calculation.
	OldResource interface{}
	// The identifier for the resource
	ID string
}

type ResourceInformerDeleteInput struct {
	// A timestamp of when the resource was created. If this is a zero-value time,
	// the time at when the informer message was recieved will be upserted.
	Timestamp time.Time
	// The identifier for the resource
	ID string
}

// ResourceInformer adds additional functionality on top of a resource provider to signal
// back to the IDE when resources have changed automatically.
type ResourceInformer interface {
	// InformAdd notifies the IDE that a resource has been created within the resource backend
	InformAdd(resourceID string, namespaceID string, input ResourceInformerAddInput) error
	// InformUpdate notifies the IDE that a resource has been updated within the resource backend
	InformUpdate(resourceID string, namespaceID string, input ResourceInformerUpdateInput) error
	// InformDelete notifies the IDE that a resource has been deleted within the resource backend
	InformDelete(resourceID string, namespaceID string, input ResourceInformerDeleteInput) error
}

// ResourceProvider provides an interface for performing operations against a resource backend
// given a resource namespace and a resource identifier.
type ResourceProvider interface {
	// Get returns a single resource in the given resource namespace.
	Get(resourceID string, namespaceID string, input GetInput) GetResult[any]

	// Get returns a single resource in the given resource namespace.
	List(resourceID string, namespaceID string, input ListInput) ListResult[any]

	// FindResources returns a list of resources in the given resource namespace that
	// match a set of given options.
	//
	// Due to the dynamic nature of the options, the options are passed as an interface
	// and the Resourcer is responsible for casting the options to the correct type.
	Find(resourceID string, namespaceID string, input FindInput) FindResult[any]

	// Create creates a new resource in the given resource namespace.
	Create(resourceID string, namespaceID string, input CreateInput) CreateResult[any]

	// Update updates an existing resource in the given resource namespace.
	Update(resourceID string, namespaceID string, input UpdateInput) UpdateResult[any]

	// Delete deletes an existing resource in the given resource namespace.
	Delete(resourceID string, namespaceID string, input DeleteInput) DeleteResult
}

// Here is an implementation that talks over RPC.
type ResourcePluginClient struct{ client *rpc.Client }

func (r *ResourcePluginClient) Get(resourceID string, namespaceID string, input GetInput) GetResult[any] {
	var resp GetResult[any]
	req := ResourceProviderInput[GetInput]{
		input:       input,
		resourceID:  resourceID,
		namespaceID: namespaceID,
	}

	if err := r.client.Call("Plugin.Get", &req, &resp); err != nil {
		// You usually want your interfaces to return errors. If they don't,
		// there isn't much other choice here.
		panic(err)
	}

	return resp
}

func (r *ResourcePluginClient) List(resourceID string, namespaceID string, input ListInput) ListResult[any] {
	var resp ListResult[any]
	req := ResourceProviderInput[ListInput]{
		input:       input,
		resourceID:  resourceID,
		namespaceID: namespaceID,
	}

	if err := r.client.Call("Plugin.List", &req, &resp); err != nil {
		panic(err)
	}

	return resp
}

func (r *ResourcePluginClient) Find(resourceID string, namespaceID string, input FindInput) FindResult[any] {
	var resp FindResult[any]
	req := ResourceProviderInput[FindInput]{
		input:       input,
		resourceID:  resourceID,
		namespaceID: namespaceID,
	}

	if err := r.client.Call("Plugin.Find", &req, &resp); err != nil {
		panic(err)
	}

	return resp
}

func (r *ResourcePluginClient) Create(resourceID string, namespaceID string, input CreateInput) CreateResult[any] {
	var resp CreateResult[any]
	req := ResourceProviderInput[CreateInput]{
		input:       input,
		resourceID:  resourceID,
		namespaceID: namespaceID,
	}

	if err := r.client.Call("Plugin.Create", &req, &resp); err != nil {
		panic(err)
	}

	return resp
}

func (r *ResourcePluginClient) Update(resourceID string, namespaceID string, input UpdateInput) UpdateResult[any] {
	var resp UpdateResult[any]
	req := ResourceProviderInput[UpdateInput]{
		input:       input,
		resourceID:  resourceID,
		namespaceID: namespaceID,
	}

	if err := r.client.Call("Plugin.Update", &req, &resp); err != nil {
		panic(err)
	}

	return resp
}

func (r *ResourcePluginClient) Delete(resourceID string, namespaceID string, input DeleteInput) DeleteResult {
	var resp DeleteResult
	req := ResourceProviderInput[DeleteInput]{
		input:       input,
		resourceID:  resourceID,
		namespaceID: namespaceID,
	}

	if err := r.client.Call("Plugin.Delete", &req, &resp); err != nil {
		panic(err)
	}

	return resp
}

// This is the implementation of plugin.Plugin so we can serve/consume this.
type ResourcePlugin struct {
	// Concrete implementation, written in Go. This is only used for plugins
	// that are written in Go.
	Impl ResourceProvider
}

func (p *ResourcePlugin) Server(*plugin.MuxBroker) (interface{}, error) {
	return &ResourcePlugin{Impl: p.Impl}, nil
}

func (ResourcePlugin) Client(_ *plugin.MuxBroker, c *rpc.Client) (interface{}, error) {
	return &ResourcePluginClient{client: c}, nil
}
