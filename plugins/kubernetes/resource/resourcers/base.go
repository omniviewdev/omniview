package resourcers

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/omniview/kubernetes/resource"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"

	"github.com/omniviewdev/omniview/backend/clients"
	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/types"
)

const (
	ADD_CHANNEL_BUFFER_SIZE    = 100
	UPDATE_CHANNEL_BUFFER_SIZE = 100
	DELETE_CHANNEL_BUFFER_SIZE = 100
)

// All kubernetes objects extending this implement the following base interface
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
		resourceType:            resourceType,
	}

	return &service
}

// GroupVersionResource returns the GroupVersionResource for the resource this service manages.
func (s *KubernetesResourcerBase[T]) GroupVersionResource() schema.GroupVersionResource {
	return s.resourceType
}

// ============================ ACTION METHODS ============================ //.
// Get returns a resource by name and namespace.
func (s *KubernetesResourcerBase[T]) Get(ctx context.Context, client *resource.ClientSet, input types.GetInput) (interface{}, error) {
	s.RLock()
	defer s.RUnlock()

  // Get the lister
  lister := client.DynamicInformerFactory

	resource, err := client.DynamicInformerFactory..Lister.ByNamespace(opts.Namespace).Get(opts.Name)
	if err != nil {
		return nil, err
	}
	return resource, nil
}

// List returns a map of resources for the provided cluster contexts.
func (s *KubernetesResourcerBase[T]) List(opts ListOptions) (interface{}, error) {
	s.log.Debugw("listing resources", "resource", s.resourceType, "opts", opts)

	objects, err := client.Lister.List(labels.Everything())

	return results, nil
}

// Get returns a resource by name and namespace.
func (s *KubernetesResourcerBase[T]) Get() (interface{}, error) {
	s.RLock()
	defer s.RUnlock()

	// get the cluster context for the context provided
	client, ok := s.clients[opts.ClusterContext]
	if !ok {
		return nil, fmt.Errorf("context not found")
	}

	// get the client for the context provided
	if client.Lister == nil {
		return nil, fmt.Errorf("lister not initialized")
	}

	resource, err := client.Lister.ByNamespace(opts.Namespace).Get(opts.Name)
	if err != nil {
		return nil, err
	}
	return resource, nil
}

func (s *KubernetesResourcerBase[T]) Edit(name string, namespace string, obj interface{}) error {
	// Default implementation, can be overridden by embedded services
	return fmt.Errorf("edit not implemented")
}

func (s *KubernetesResourcerBase[T]) Delete(name string, namespace string) error {
	// Default implementation, can be overridden by embedded services
	return fmt.Errorf("delete not implemented")
}
