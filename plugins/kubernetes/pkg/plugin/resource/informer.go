package resource

import (
	"fmt"
	"log"
	"slices"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	authenticationv1 "k8s.io/api/authentication/v1"
	authenticationv1beta1 "k8s.io/api/authentication/v1beta1"
	authorizationv1 "k8s.io/api/authorization/v1"
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
	corev1.SchemeGroupVersion.WithResource("bindings"),
	eventsv1.SchemeGroupVersion.WithResource("events"),
	authenticationv1beta1.SchemeGroupVersion.WithResource("selfsubjectreviews"),
	authenticationv1.SchemeGroupVersion.WithResource("selfsubjectreviews"),
	authenticationv1.SchemeGroupVersion.WithResource("tokenrequests"),
	authenticationv1.SchemeGroupVersion.WithResource("tokenreviews"),
	authorizationv1.SchemeGroupVersion.WithResource("localsubjectaccessreviews"),
	authorizationv1.SchemeGroupVersion.WithResource("selfsubjectaccessreviews"),
	authorizationv1.SchemeGroupVersion.WithResource("selfsubjectrulesreviews"),
	authorizationv1.SchemeGroupVersion.WithResource("subjectaccessreviews"),
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
		AddFunc: func(obj any) {
			r, ok := obj.(*unstructured.Unstructured)
			if !ok || r == nil {
				log.Print("object is not an unstructured object")
				return
			}

			kind := r.GroupVersionKind()
			group := kind.Group
			if group == "" {
				group = "core"
			}
			key := fmt.Sprintf("%s::%s::%s", group, kind.Version, kind.Kind)

			log.Println("Got create for: ", key, r.GetName())
			// send it into the channel
			addChan <- types.InformerAddPayload{
				Key:        key,
				Connection: ctx.Connection.ID,
				ID:         r.GetName(),
				Namespace:  r.GetNamespace(),
				Data:       r.Object,
			}
		},
		UpdateFunc: func(oldObj, obj any) {
			orig, ok := oldObj.(*unstructured.Unstructured)
			if !ok || orig == nil {
				log.Print("object is not an unstructured object")
				return
			}

			updated, ok := obj.(*unstructured.Unstructured)
			if !ok || updated == nil {
				log.Print("object is not an unstructured object")
				return
			}

			kind := updated.GroupVersionKind()
			group := kind.Group
			if group == "" {
				group = "core"
			}
			key := fmt.Sprintf("%s::%s::%s", group, kind.Version, kind.Kind)

			log.Println("Got update for: ", key, updated.GetName())

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
		DeleteFunc: func(obj any) {
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
			group := kind.Group
			if group == "" {
				group = "core"
			}
			key := fmt.Sprintf("%s::%s::%s", group, kind.Version, kind.Kind)
			log.Println("Got delete for: ", key, r.GetName())

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
	informer.Start(stopCh)
	log.Print("Starting informers. Waiting for cache sync...")

	synced := make(chan struct{})
	cacheStop := make(chan struct{})
	go func() {
		resources := informer.WaitForCacheSync(cacheStop)
		log.Print("Cache sync done. Informers used:", resources)
		close(synced)
	}()

	select {
	case <-synced:
		// all good
	case <-time.After(2 * time.Minute):
		log.Print("cache sync timed out after 2m")
		close(cacheStop)
	}

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
