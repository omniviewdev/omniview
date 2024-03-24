package resource

import (
	"fmt"
	"log"
	"slices"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	coordinationv1 "k8s.io/api/coordination/v1"
	corev1 "k8s.io/api/core/v1"
	eventsv1 "k8s.io/api/events/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/tools/cache"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

//nolint:gochecknoglobals // this is a map of resources to their GVK
var ignoreResources = []schema.GroupVersionResource{
	// too much noise for now
	corev1.SchemeGroupVersion.WithResource("events"),
	eventsv1.SchemeGroupVersion.WithResource("events"),
	coordinationv1.SchemeGroupVersion.WithResource("leases"),
}

func NewInformerOptions() *types.InformerOptions[clients.ClientSet, dynamicinformer.DynamicSharedInformerFactory] {
	return &types.InformerOptions[clients.ClientSet, dynamicinformer.DynamicSharedInformerFactory]{
		CreateInformerFunc:   CreateInformer,
		RegisterResourceFunc: RegisterResourceInformer,
		RunInformerFunc:      StartInformer,
	}
}

func CreateInformer(
	_ *pkgtypes.PluginContext,
	client *clients.ClientSet,
) (dynamicinformer.DynamicSharedInformerFactory, error) {
	return client.DynamicInformerFactory, nil
}

func RegisterResourceInformer(
	ctx *pkgtypes.PluginContext,
	resource types.ResourceMeta,
	informer dynamicinformer.DynamicSharedInformerFactory,
	addChan chan types.InformerAddPayload,
	updateChan chan types.InformerUpdatePayload,
	deleteChan chan types.InformerDeletePayload,
) error {
	// get the gvk from our resource map
	gvk, exists := resourceMap[resource.String()]
	if !exists {
		return fmt.Errorf("resource %s not found", resource)
	}

	if slices.Contains(ignoreResources, gvk) {
		log.Printf("skipping informer for %s", gvk)
		return nil
	}

	// create the informer
	i := informer.ForResource(gvk).Informer()

	handlers := cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			r, ok := obj.(*unstructured.Unstructured)
			if !ok {
				log.Print("object is not an unstructured object")
				return
			}
			if r == nil {
				log.Print("object is nil")
				return
			}

			kind := r.GroupVersionKind()

			key := fmt.Sprintf("%s::%s::%s", kind.Group, kind.Version, kind.Kind)

			// send it into the channel
			addChan <- types.InformerAddPayload{
				Key:        key,
				Connection: ctx.Connection.ID,
				ID:         r.GetName(),
				Namespace:  r.GetNamespace(),
				Data:       r.Object,
			}
		},
		UpdateFunc: func(oldObj, obj interface{}) {
			orig, ok := oldObj.(*unstructured.Unstructured)
			if !ok {
				log.Print("old object is not an unstructured object")
				return
			}
			if orig == nil {
				log.Print("object is nil")
				return
			}
			updated, ok := obj.(*unstructured.Unstructured)
			if !ok {
				log.Print("new object is not an unstructured object")
				return
			}
			if updated == nil {
				log.Print("object is nil")
				return
			}

			kind := updated.GroupVersionKind()
			key := fmt.Sprintf("%s::%s::%s", kind.Group, kind.Version, kind.Kind)

			// send it into the channel
			updateChan <- types.InformerUpdatePayload{
				Key:        key,
				Connection: ctx.Connection.ID,
				ID:         updated.GetName(),
				Namespace:  updated.GetNamespace(),
				OldData:    orig.Object,
				NewData:    updated.Object,
			}
		},
		DeleteFunc: func(obj interface{}) {
			r, ok := obj.(*unstructured.Unstructured)
			if !ok {
				log.Print("object is not an unstructured object")
				return
			}
			if r == nil {
				log.Print("object is nil")
				return
			}

			kind := r.GroupVersionKind()
			key := fmt.Sprintf("%s::%s::%s", kind.Group, kind.Version, kind.Kind)

			// send it into the channel
			deleteChan <- types.InformerDeletePayload{
				Key:        key,
				Connection: ctx.Connection.ID,
				ID:         r.GetName(),
				Namespace:  r.GetNamespace(),
				Data:       r.Object,
			}
		},
	}

	if _, err := i.AddEventHandler(handlers); err != nil {
		return err
	}

	// Let the parent start all the informers
	return nil
}

// StartInformer starts the informer for the registered resources.
func StartInformer(
	informer dynamicinformer.DynamicSharedInformerFactory,
	stopCh chan struct{},
	_ chan types.InformerAddPayload,
	_ chan types.InformerUpdatePayload,
	_ chan types.InformerDeletePayload,
) error {
	log.Print("Starting informer")
	go informer.Start(stopCh)
	resources := informer.WaitForCacheSync(stopCh)
	log.Print("Informers started", resources)
	return nil
}

// StopInformer stops the informer for the registered resources.
func StopInformer(
	factory dynamicinformer.DynamicSharedInformerFactory,
	stopCh chan struct{},
) error {
	close(stopCh)

	// Wait for all informers to stop
	factory.Shutdown()
	log.Print("Informers stopped")
	return nil
}
