package resource

import (
	"context"
	"fmt"
	"log"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	authenticationv1 "k8s.io/api/authentication/v1"
	authenticationv1beta1 "k8s.io/api/authentication/v1beta1"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/tools/cache"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

//nolint:gochecknoglobals // this is a map of resources to their GVK
var ignoreResources = []schema.GroupVersionResource{
	corev1.SchemeGroupVersion.WithResource("bindings"),
	authenticationv1beta1.SchemeGroupVersion.WithResource("selfsubjectreviews"),
	authenticationv1.SchemeGroupVersion.WithResource("selfsubjectreviews"),
	authenticationv1.SchemeGroupVersion.WithResource("tokenrequests"),
	authenticationv1.SchemeGroupVersion.WithResource("tokenreviews"),
	authorizationv1.SchemeGroupVersion.WithResource("localsubjectaccessreviews"),
	authorizationv1.SchemeGroupVersion.WithResource("selfsubjectaccessreviews"),
	authorizationv1.SchemeGroupVersion.WithResource("selfsubjectrulesreviews"),
	authorizationv1.SchemeGroupVersion.WithResource("subjectaccessreviews"),
}

// nonK8sGroups lists resource groups that are not backed by the Kubernetes API
// and therefore cannot have informers. These are always skipped.
var nonK8sGroups = []string{"helm"}

// kubeInformerHandle wraps a DynamicSharedInformerFactory to implement types.InformerHandle.
type kubeInformerHandle struct {
	factory   dynamicinformer.DynamicSharedInformerFactory
	discovery discovery.DiscoveryInterface

	mu         sync.Mutex
	stopCh     chan struct{}
	resources  map[string]schema.GroupVersionResource // resourceKey → GVR
	policies   map[string]types.InformerSyncPolicy    // resourceKey → policy
	connection string
}

// NewKubeInformerHandle creates an InformerHandle for the kubernetes plugin.
func NewKubeInformerHandle(
	ctx *pkgtypes.PluginContext,
	client *clients.ClientSet,
) (types.InformerHandle, error) {
	connID := ""
	if ctx.Connection != nil {
		connID = ctx.Connection.ID
	}
	return &kubeInformerHandle{
		factory:    client.DynamicInformerFactory,
		discovery:  client.DiscoveryClient,
		resources:  make(map[string]schema.GroupVersionResource),
		policies:   make(map[string]types.InformerSyncPolicy),
		connection: connID,
	}, nil
}

func (h *kubeInformerHandle) RegisterResource(
	ctx *pkgtypes.PluginContext,
	resource types.ResourceMeta,
	syncPolicy types.InformerSyncPolicy,
	addChan chan types.InformerAddPayload,
	updateChan chan types.InformerUpdatePayload,
	deleteChan chan types.InformerDeletePayload,
) error {
	key := resource.String()

	// Skip resources from non-Kubernetes groups (e.g. Helm).
	if slices.Contains(nonK8sGroups, resource.Group) {
		return types.ErrResourceSkipped
	}

	// Try static resource map first, then fall back to discovery for CRDs.
	gvr, exists := resourceMap[key]
	if !exists {
		resolved, err := h.resolveGVR(resource)
		if err != nil {
			log.Printf("skipping informer for %s: %v", key, err)
			return types.ErrResourceSkipped
		}
		gvr = resolved
	}

	if slices.Contains(ignoreResources, gvr) {
		log.Printf("skipping informer for %s", gvr)
		return types.ErrResourceSkipped
	}

	h.mu.Lock()
	h.resources[key] = gvr
	h.policies[key] = syncPolicy
	h.mu.Unlock()

	// create the informer and register event handlers
	i := h.factory.ForResource(gvr).Informer()

	handlers := cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj any) {
			r, ok := obj.(*unstructured.Unstructured)
			if !ok || r == nil {
				return
			}
			kind := r.GroupVersionKind()
			group := kind.Group
			if group == "" {
				group = "core"
			}
			eventKey := fmt.Sprintf("%s::%s::%s", group, kind.Version, kind.Kind)
			addChan <- types.InformerAddPayload{
				Key:        eventKey,
				Connection: ctx.Connection.ID,
				ID:         r.GetName(),
				Namespace:  r.GetNamespace(),
				Data:       r.Object,
			}
		},
		UpdateFunc: func(oldObj, obj any) {
			orig, ok := oldObj.(*unstructured.Unstructured)
			if !ok || orig == nil {
				return
			}
			updated, ok := obj.(*unstructured.Unstructured)
			if !ok || updated == nil {
				return
			}
			kind := updated.GroupVersionKind()
			group := kind.Group
			if group == "" {
				group = "core"
			}
			eventKey := fmt.Sprintf("%s::%s::%s", group, kind.Version, kind.Kind)
			updateChan <- types.InformerUpdatePayload{
				Key:        eventKey,
				Connection: ctx.Connection.ID,
				ID:         updated.GetName(),
				Namespace:  updated.GetNamespace(),
				OldData:    orig.Object,
				NewData:    updated.Object,
			}
		},
		DeleteFunc: func(obj any) {
			r, ok := obj.(*unstructured.Unstructured)
			if !ok || r == nil {
				return
			}
			kind := r.GroupVersionKind()
			group := kind.Group
			if group == "" {
				group = "core"
			}
			eventKey := fmt.Sprintf("%s::%s::%s", group, kind.Version, kind.Kind)
			deleteChan <- types.InformerDeletePayload{
				Key:        eventKey,
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

	return nil
}

func (h *kubeInformerHandle) Start(
	ctx context.Context,
	stopCh chan struct{},
	stateChan chan<- types.InformerStateEvent,
) error {
	h.mu.Lock()
	h.stopCh = stopCh
	h.mu.Unlock()

	// Emit SYNCING for all OnConnect resources
	h.mu.Lock()
	for key, policy := range h.policies {
		if policy == types.SyncOnConnect {
			stateChan <- types.InformerStateEvent{
				Connection:  h.connection,
				ResourceKey: key,
				State:       types.InformerStateSyncing,
				TotalCount:  -1,
			}
		}
	}

	// Build per-resource informer + key maps before starting
	type resourceInfo struct {
		key      string
		gvr      schema.GroupVersionResource
		informer cache.SharedIndexInformer
	}
	resources := make([]resourceInfo, 0, len(h.resources))
	for key, gvr := range h.resources {
		if h.policies[key] == types.SyncOnConnect {
			resources = append(resources, resourceInfo{
				key:      key,
				gvr:      gvr,
				informer: h.factory.ForResource(gvr).Informer(),
			})
		}
	}
	h.mu.Unlock()

	log.Print("Starting informers")
	h.factory.Start(stopCh)

	// Wait for each resource individually with a per-resource timeout.
	// This lets fast resources emit Synced immediately rather than
	// waiting for slow ones.
	var wg sync.WaitGroup
	for _, ri := range resources {
		wg.Add(1)
		go func(ri resourceInfo) {
			defer wg.Done()

			// Per-resource timeout: 30s is generous for most resources
			syncCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()

			if cache.WaitForCacheSync(syncCtx.Done(), ri.informer.HasSynced) {
				count := 0
				items, err := h.factory.ForResource(ri.gvr).Lister().List(labels.Everything())
				if err == nil {
					count = len(items)
				}
				stateChan <- types.InformerStateEvent{
					Connection:    h.connection,
					ResourceKey:   ri.key,
					State:         types.InformerStateSynced,
					ResourceCount: count,
					TotalCount:    count,
				}
			} else {
				stateChan <- types.InformerStateEvent{
					Connection:  h.connection,
					ResourceKey: ri.key,
					State:       types.InformerStateError,
					Error: &types.ResourceOperationError{
						Code:    "SYNC_TIMEOUT",
						Title:   "Informer sync timed out",
						Message: fmt.Sprintf("Cache sync for %s did not complete within 30s", ri.key),
					},
				}
			}
		}(ri)
	}

	// Wait for all individual syncs, then block until stopped
	wg.Wait()
	log.Print("Cache sync complete")

	select {
	case <-stopCh:
	case <-ctx.Done():
	}
	return nil
}

func (h *kubeInformerHandle) StartResource(
	ctx context.Context,
	resource types.ResourceMeta,
	stateChan chan<- types.InformerStateEvent,
) error {
	key := resource.String()

	h.mu.Lock()
	gvr, exists := h.resources[key]
	h.mu.Unlock()
	if !exists {
		return fmt.Errorf("resource %s not registered", key)
	}

	stateChan <- types.InformerStateEvent{
		Connection:  h.connection,
		ResourceKey: key,
		State:       types.InformerStateSyncing,
		TotalCount:  -1,
	}

	informer := h.factory.ForResource(gvr).Informer()
	go informer.Run(ctx.Done())

	if cache.WaitForCacheSync(ctx.Done(), informer.HasSynced) {
		count := 0
		items, err := h.factory.ForResource(gvr).Lister().List(labels.Everything())
		if err == nil {
			count = len(items)
		}
		stateChan <- types.InformerStateEvent{
			Connection:    h.connection,
			ResourceKey:   key,
			State:         types.InformerStateSynced,
			ResourceCount: count,
			TotalCount:    count,
		}
	} else {
		stateChan <- types.InformerStateEvent{
			Connection:  h.connection,
			ResourceKey: key,
			State:       types.InformerStateError,
			Error: &types.ResourceOperationError{
				Code:    "SYNC_TIMEOUT",
				Title:   "Informer sync timed out",
				Message: fmt.Sprintf("Cache sync for %s did not complete", key),
			},
		}
	}

	return nil
}

// resolveGVR dynamically resolves a GroupVersionResource for CRDs or other
// resources not in the static resourceMap by querying the discovery API.
func (h *kubeInformerHandle) resolveGVR(resource types.ResourceMeta) (schema.GroupVersionResource, error) {
	if h.discovery == nil {
		return schema.GroupVersionResource{}, fmt.Errorf("no discovery client")
	}

	// Reconstruct the API group string from our internal format.
	// Our format: group="monitoring.coreos.com", version="v1"
	// K8s API format: "monitoring.coreos.com/v1"
	apiGroup := resource.Group
	if apiGroup == "core" {
		apiGroup = ""
	}
	groupVersion := resource.Version
	if apiGroup != "" {
		groupVersion = apiGroup + "/" + resource.Version
	}

	groups, err := h.discovery.ServerPreferredResources()
	if err != nil {
		// ServerPreferredResources may return partial results with non-nil error
		// (e.g. for groups the user doesn't have access to). Continue if we
		// have any results.
		if len(groups) == 0 {
			return schema.GroupVersionResource{}, fmt.Errorf("discovery failed: %w", err)
		}
	}

	for _, group := range groups {
		if group.GroupVersion != groupVersion {
			continue
		}
		for _, r := range group.APIResources {
			if r.Kind == resource.Kind && !strings.Contains(r.Name, "/") {
				return schema.GroupVersionResource{
					Group:    apiGroup,
					Version:  resource.Version,
					Resource: r.Name,
				}, nil
			}
		}
	}

	return schema.GroupVersionResource{}, fmt.Errorf("resource %s not found via discovery", resource.String())
}

func (h *kubeInformerHandle) Stop() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.stopCh != nil {
		select {
		case <-h.stopCh:
			// already closed
		default:
			close(h.stopCh)
		}
	}
}
