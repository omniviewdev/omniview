package resourcers

import (
	"sync"

	"github.com/omniview/kubernetes/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/services"
	"go.uber.org/zap"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"

	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	AddChannelBufferSize    = 100
	UpdateChannelBufferSize = 100
	DeleteChannelBufferSize = 100
)

// All kubernetes objects extending this implement the following base interface.
type MetaAccessor interface {
	GetName() string
	GetNamespace() string
	GetLabels() map[string]string
}

// KubernetesResourcerBase provides a base implementation of the ResourceService interface.
// It manages the lifecycle of informers for a specific Kubernetes resource and handles context switching,
// ensuring that resource data is consistently up-to-date and accessible.
type KubernetesResourcerBase[T MetaAccessor] struct {
	sync.RWMutex
	// Logger
	log *zap.SugaredLogger
	// resourceType is the group version resource for the resource this service manages.
	resourceType schema.GroupVersionResource
	// informer is the informer for the resource type
	informer informers.GenericInformer
}

// NewKubernetesResourcerBase creates a new instance of KubernetesResourcerBase for interacting
// with informers and resources in a Kubernetes cluster.
func NewKubernetesResourcerBase[T MetaAccessor](
	logger *zap.SugaredLogger,
	resourceType schema.GroupVersionResource,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) pkgtypes.Resourcer[resource.ClientSet] {
	// Create a new instance of the service
	service := KubernetesResourcerBase[T]{
		RWMutex:      sync.RWMutex{},
		log:          logger.With("service", resourceType.Resource+"Service"),
		resourceType: resourceType,
		informer:     nil,
	}

	return &service
}

// GroupVersionResource returns the GroupVersionResource for the resource this service manages.
func (s *KubernetesResourcerBase[T]) GroupVersionResource() schema.GroupVersionResource {
	return s.resourceType
}

// ============================ ACTION METHODS ============================ //.

// Get returns a resource by name and namespace.
func (s *KubernetesResourcerBase[T]) Get(
	ctx *types.PluginContext,
	client *resource.ClientSet,
	input pkgtypes.GetInput,
) (*pkgtypes.GetResult, error) {
	lister := client.DynamicClient.Resource(s.GroupVersionResource()).Namespace(input.Namespace)
	resource, err := lister.Get(ctx.Context, input.ID, v1.GetOptions{})
	if err != nil {
		return nil, err
	}

	return &pkgtypes.GetResult{Success: true, Result: resource.Object}, nil
}

// List returns a map of resources for the provided cluster contexts.
func (s *KubernetesResourcerBase[T]) List(
	ctx *types.PluginContext,
	client *resource.ClientSet,
	input pkgtypes.ListInput,
) (*pkgtypes.ListResult, error) {
	lister := client.DynamicClient.Resource(s.GroupVersionResource())
	resources, err := lister.List(ctx.Context, v1.ListOptions{})
	if err != nil {
		return nil, err
	}

	result := make(map[string]interface{})
	for _, r := range resources.Items {
		result[r.GetName()] = r.Object
	}

	return &pkgtypes.ListResult{Success: true, Result: result}, nil
}

// Find returns a resource by name and namespace.
// TODO - implement, for now this just does list
func (s *KubernetesResourcerBase[T]) Find(
	ctx *types.PluginContext,
	client *resource.ClientSet,
	input pkgtypes.FindInput,
) (*pkgtypes.FindResult, error) {
	lister := client.DynamicClient.Resource(s.GroupVersionResource())
	resources, err := lister.List(ctx.Context, v1.ListOptions{})
	if err != nil {
		return nil, err
	}

	result := make(map[string]interface{})
	for _, r := range resources.Items {
		result[r.GetName()] = r.Object
	}

	return &pkgtypes.FindResult{Success: true, Result: result}, nil
}

// Create creates a new resource in the given resource namespace.
func (s *KubernetesResourcerBase[T]) Create(
	ctx *types.PluginContext,
	client *resource.ClientSet,
	input pkgtypes.CreateInput,
) (*pkgtypes.CreateResult, error) {
	result := new(pkgtypes.CreateResult)
	lister := client.DynamicClient.Resource(s.GroupVersionResource()).Namespace(input.Namespace)
	object := &unstructured.Unstructured{
		Object: input.Input,
	}
	created, err := lister.Create(ctx.Context, object, v1.CreateOptions{})
	if err != nil {
		return nil, err
	}
	result.Result = created.Object
	return result, nil
}

func (s *KubernetesResourcerBase[T]) Update(
	ctx *types.PluginContext,
	client *resource.ClientSet,
	input pkgtypes.UpdateInput,
) (*pkgtypes.UpdateResult, error) {
	result := new(pkgtypes.UpdateResult)

	// first get the resource
	lister := client.DynamicClient.Resource(s.GroupVersionResource()).Namespace(input.Namespace)
	resource, err := lister.Get(ctx.Context, input.ID, v1.GetOptions{})
	if err != nil {
		return nil, err
	}

	// update and resubmit
	resource.Object = input.Input
	updated, err := lister.Update(ctx.Context, resource, v1.UpdateOptions{})
	if err != nil {
		return result, nil
	}
	result.Result = updated.Object
	return result, nil
}

func (s *KubernetesResourcerBase[T]) Delete(
	ctx *types.PluginContext,
	client *resource.ClientSet,
	input pkgtypes.DeleteInput,
) (*pkgtypes.DeleteResult, error) {
	result := new(pkgtypes.DeleteResult)
	lister := client.DynamicClient.Resource(s.GroupVersionResource()).Namespace(input.Namespace)

	// first, get the resource for the delete so we can return back to the client
	resource, err := lister.Get(ctx.Context, input.ID, v1.GetOptions{})
	if err != nil {
		return nil, err
	}
	result.Result = resource.Object

	// delete the resource
	if err = lister.Delete(ctx.Context, input.ID, v1.DeleteOptions{}); err != nil {
		return nil, err
	}

	return result, nil
}
