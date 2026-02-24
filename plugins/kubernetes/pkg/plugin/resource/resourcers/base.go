package resourcers

import (
	"log"
	"sync"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"go.uber.org/zap"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"

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
}

// NewKubernetesResourcerBase creates a new instance of KubernetesResourcerBase for interacting
// with informers and resources in a Kubernetes cluster.
func NewKubernetesResourcerBase[T MetaAccessor](
	logger *zap.SugaredLogger,
	resourceType schema.GroupVersionResource,
) pkgtypes.Resourcer[clients.ClientSet] {
	// Create a new instance of the service
	service := KubernetesResourcerBase[T]{
		RWMutex:      sync.RWMutex{},
		log:          logger.With("service", resourceType.Resource+"Service"),
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
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	input pkgtypes.GetInput,
) (*pkgtypes.GetResult, error) {
	var resource runtime.Object
	var err error

	informer := client.DynamicInformerFactory.ForResource(s.GroupVersionResource()).Informer()
	if !informer.HasSynced() {
		lister := client.DynamicClient.Resource(s.GroupVersionResource())
		if input.Namespace != "" {
			resource, err = lister.Namespace(input.Namespace).
				Get(ctx.Context, input.ID, v1.GetOptions{})
		} else {
			resource, err = lister.Get(ctx.Context, input.ID, v1.GetOptions{})
		}
	} else {
		lister := client.DynamicInformerFactory.ForResource(s.GroupVersionResource()).Lister()
		if input.Namespace != "" {
			nslister := lister.ByNamespace(input.Namespace)
			resource, err = nslister.Get(input.ID)
		} else {
			resource, err = lister.Get(input.ID)
		}
	}

	if err != nil {
		log.Println("Error getting resource: ", err)
		return nil, err
	}
	// convert the runtime.Object to unstructured.Unstructured
	obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(resource)
	if err != nil {
		log.Println("Error getting resource: ", err)
		return nil, err
	}

	return &pkgtypes.GetResult{Success: true, Result: obj}, nil
}

// List returns a map of resources for the provided cluster contexts.
func (s *KubernetesResourcerBase[T]) List(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	_ pkgtypes.ListInput,
) (*pkgtypes.ListResult, error) {
	informer := client.DynamicInformerFactory.ForResource(s.GroupVersionResource()).Informer()
	if !informer.HasSynced() {
		resources, err := client.DynamicClient.Resource(s.GroupVersionResource()).
			List(ctx.Context, v1.ListOptions{})
		if err != nil {
			return nil, err
		}

		result := make([]map[string]interface{}, 0, len(resources.Items))
		for _, r := range resources.Items {
			p := r
			obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&p)
			if err != nil {
				return nil, err
			}
			result = append(result, obj)
		}
		return &pkgtypes.ListResult{Success: true, Result: result}, nil
	}

	lister := client.DynamicInformerFactory.ForResource(s.GroupVersionResource()).Lister()
	resources, err := lister.List(labels.Everything())
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, 0, len(resources))
	for _, r := range resources {
		obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(r)
		if err != nil {
			return nil, err
		}
		result = append(result, obj)
	}

	return &pkgtypes.ListResult{Success: true, Result: result}, nil
}

// Find returns a resource by name and namespace.
// TODO - implement, for now this just does list
func (s *KubernetesResourcerBase[T]) Find(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	_ pkgtypes.FindInput,
) (*pkgtypes.FindResult, error) {
	informer := client.DynamicInformerFactory.ForResource(s.GroupVersionResource()).Informer()
	if !informer.HasSynced() {
		resources, err := client.DynamicClient.Resource(s.GroupVersionResource()).
			List(ctx.Context, v1.ListOptions{})
		if err != nil {
			return nil, err
		}

		result := make([]map[string]interface{}, 0, len(resources.Items))
		for _, r := range resources.Items {
			p := r
			obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&p)
			if err != nil {
				return nil, err
			}
			result = append(result, obj)
		}
		return &pkgtypes.FindResult{Success: true, Result: result}, nil
	}

	lister := client.DynamicInformerFactory.ForResource(s.GroupVersionResource()).Lister()
	resources, err := lister.List(labels.Everything())
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, 0, len(resources))
	for _, r := range resources {
		obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(r)
		if err != nil {
			return nil, err
		}
		result = append(result, obj)
	}

	return &pkgtypes.FindResult{Success: true, Result: result}, nil
}

// Create creates a new resource in the given resource namespace.
func (s *KubernetesResourcerBase[T]) Create(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
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
	result.Success = true
	result.Result = created.Object
	return result, nil
}

func (s *KubernetesResourcerBase[T]) Update(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
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
		return nil, err
	}
	result.Success = true
	result.Result = updated.Object
	return result, nil
}

func (s *KubernetesResourcerBase[T]) Delete(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
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

	result.Success = true
	return result, nil
}
