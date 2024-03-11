package resourcers

import (
	"context"
	"fmt"
	"sync"

	"github.com/omniview/kubernetes/resource"
	"github.com/omniviewdev/omniview/backend/services"
	pkgtypes "github.com/omniviewdev/plugin/pkg/resource/types"
	"go.uber.org/zap"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"
)

const (
	ADD_CHANNEL_BUFFER_SIZE    = 100
	UPDATE_CHANNEL_BUFFER_SIZE = 100
	DELETE_CHANNEL_BUFFER_SIZE = 100
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
) *KubernetesResourcerBase[T] {
	// Create a new instance of the service
	service := KubernetesResourcerBase[T]{
		log: logger.With(
			"service",
			fmt.Sprintf("%sService", resourceType.Resource),
		),
		resourceType: resourceType,
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
	ctx context.Context,
	client *resource.ClientSet,
	input pkgtypes.GetInput,
) (interface{}, error) {
	lister := client.DynamicClient.Resource(s.GroupVersionResource()).Namespace(input.PartitionID)
	resource, err := lister.Get(ctx, input.ID, v1.GetOptions{})
	if err != nil {
		return nil, err
	}
	return resource, nil
}

// List returns a map of resources for the provided cluster contexts.
func (s *KubernetesResourcerBase[T]) List(
	ctx context.Context,
	client *resource.ClientSet,
	input pkgtypes.ListInput,
) (interface{}, error) {
	lister := client.DynamicClient.Resource(s.GroupVersionResource())
	resources, err := lister.List(ctx, v1.ListOptions{})
	if err != nil {
		return nil, err
	}

	return resources, nil
}

// Find returns a resource by name and namespace.
// TODO - implement, for now this just does list
func (s *KubernetesResourcerBase[T]) Find(
	ctx context.Context,
	client *resource.ClientSet,
	input pkgtypes.FindInput,
) (interface{}, error) {
	lister := client.DynamicClient.Resource(s.GroupVersionResource())
	resources, err := lister.List(ctx, v1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return resources, nil
}

// Create creates a new resource in the given resource namespace.
func (s *KubernetesResourcerBase[T]) Create(
	ctx context.Context,
	client *resource.ClientSet,
	input pkgtypes.CreateInput,
) *pkgtypes.CreateResult {
	result := new(pkgtypes.CreateResult)
	lister := client.DynamicClient.Resource(s.GroupVersionResource()).Namespace(input.PartitionID)
	object := &unstructured.Unstructured{
		Object: input.Input,
	}
	created, err := lister.Create(ctx, object, v1.CreateOptions{})
	if err != nil {
		result.RecordError(err)
		return result
	}
	result.Result = created.Object
	return nil
}

func (s *KubernetesResourcerBase[T]) Update(
	ctx context.Context,
	client *resource.ClientSet,
	input pkgtypes.UpdateInput,
) *pkgtypes.UpdateResult {
	result := new(pkgtypes.UpdateResult)

	// first get the resource
	lister := client.DynamicClient.Resource(s.GroupVersionResource()).Namespace(input.PartitionID)
	resource, err := lister.Get(ctx, input.ID, v1.GetOptions{})
	if err != nil {
		result.RecordError(fmt.Errorf("error getting resource during update: %s", err))
		return result
	}

	// update and resubmit
	resource.Object = input.Input
	updated, err := lister.Update(ctx, resource, v1.UpdateOptions{})
	if err != nil {
		result.RecordError(fmt.Errorf("error updating resource: %s", err))
		return result
	}
	result.Result = updated.Object
	return result
}

func (s *KubernetesResourcerBase[T]) Delete(
	ctx context.Context,
	client *resource.ClientSet,
	input pkgtypes.DeleteInput,
) *pkgtypes.DeleteResult {
	result := new(pkgtypes.DeleteResult)
	lister := client.DynamicClient.Resource(s.GroupVersionResource()).Namespace(input.PartitionID)

	// first, get the resource for the delete so we can return back to the client
	resource, err := lister.Get(ctx, input.ID, v1.GetOptions{})
	if err != nil {
		result.RecordError(fmt.Errorf("error getting resource during delete: %s", err))
		return result
	}
	result.Result = resource.Object

	// delete the resource
	if err = lister.Delete(ctx, input.ID, v1.DeleteOptions{}); err != nil {
		result.RecordError(fmt.Errorf("error deleting resource: %s", err))
		return result
	}

	return result
}
