package services

import (
	"fmt"
	"sync"
	"time"

	"github.com/joshuapare/kubede/backend/clients"
	"github.com/joshuapare/kubede/backend/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
)

const (
	DEFAULT_RESYNC_PERIOD = 30 * time.Minute
)

// ClusterContext holds the Kubernetes clientset and dynamic client for a specific cluster.
// It represents the necessary details to interact with the Kubernetes API for a given context.
type ClusterContext struct {
	// ResourceStates is a map of resource GVR names to their current state
	ResourceStates map[string]types.ResourceStateEventType `json:"resourceStates"`
	// Clientset is the clientset for the cluster.
	Clientset *kubernetes.Clientset `json:"-"`
	// DynamicClient is the dynamic client for the cluster.
	DynamicClient dynamic.Interface `json:"-"`
	// SharedInformerFactory
	SharedInformerFactory informers.SharedInformerFactory `json:"-"`
	// Name is the name of the context in the kubeconfig that is being used to access the cluster.
	Name string `json:"name"`
	// Kubeconfig is the path to the kubeconfig file for where this context is defined.
	Kubeconfig string `json:"kubeconfig"`
	// Allow this resource to be locked
	sync.RWMutex
}

// GetResourceStates returns the current state of all resources in the ClusterContext
func (c *ClusterContext) GetResourceStates() map[string]types.ResourceStateEventType {
	c.RLock()
	defer c.RUnlock()
	return c.ResourceStates
}

// UpsertResourceState updates or inserts a resource state in the ClusterContext, and returns
// the new state of the resource as a bool map.
func (c *ClusterContext) UpsertResourceState(gvrs map[string]bool) {
	c.Lock()
	defer c.Unlock()

	// make sure all the gvrs are in the map, and set them to not ready if they aren't there.
	// if they are there, leave them alone.
	for gvr := range gvrs {
		if _, ok := c.ResourceStates[gvr]; !ok {
			c.ResourceStates[gvr] = types.ClusterContextResourceNotReady
		}
	}

	// remove any gvrs that are in the map, but not in the map of gvrs
	for gvr := range c.ResourceStates {
		if _, ok := gvrs[gvr]; !ok {
			delete(c.ResourceStates, gvr)
		}
	}
}

// GetResourceStatesAsBoolMap returns the current state of all resources in the ClusterContext as a map of GVR to bool
func (c *ClusterContext) GetResourceStatesAsBoolMap() map[string]bool {
	c.RLock()
	defer c.RUnlock()
	result := make(map[string]bool)
	for gvr, state := range c.ResourceStates {
		result[gvr] = state == types.ClusterContextResourceReady
	}
	return result
}

// MarkResourseReady marks a resource as ready in the ClusterContext
func (c *ClusterContext) MarkResourceReady(gvr string) {
	c.Lock()
	defer c.Unlock()

	c.ResourceStates[gvr] = types.ClusterContextResourceReady
}

// MarkResourseNotReady marks a resource as not ready in the ClusterContext
func (c *ClusterContext) MarkResourceNotReady(gvr string) {
	c.Lock()
	defer c.Unlock()

	c.ResourceStates[gvr] = types.ClusterContextResourceNotReady
}

// MarkResourseError marks a resource as errored in the ClusterContext
func (c *ClusterContext) MarkResourceError(gvr string) {
	c.Lock()
	defer c.Unlock()

	c.ResourceStates[gvr] = types.ClusterContextResourceError
}

// MarkAllResourcesNotReady marks all resources as not ready in the ClusterContext
func (c *ClusterContext) MarkAllResourcesNotReady() {
	c.Lock()
	defer c.Unlock()
	for gvr := range c.ResourceStates {
		c.ResourceStates[gvr] = types.ClusterContextResourceNotReady
	}
}

// IsResourceReady returns whether a resource is ready in the ClusterContext
func (c *ClusterContext) IsResourceReady(gvr string) bool {
	c.RLock()
	defer c.RUnlock()
	return c.ResourceStates[gvr] == types.ClusterContextResourceReady
}

// AllResourcesReady returns whether all resources are ready in the ClusterContext
func (c *ClusterContext) AllResourcesReady() bool {
	c.RLock()
	defer c.RUnlock()
	for _, state := range c.ResourceStates {
		if state != types.ClusterContextResourceReady {
			return false
		}
	}
	return true
}

// =====================================================================================================================
// Factory
// =====================================================================================================================

// ClusterContextFactory is a factory for creating ClusterContexts for the cluster manager to initialize.
type ClusterContextFactory struct {
	clientFactory       *clients.KubernetesClientFactory
	defaultResyncPeriod time.Duration
}

// NewClusterContextFactory creates a new ClusterContextFactory with default values. This factory is primarily for the
// main cluster manager to use.
func NewClusterContextFactory() *ClusterContextFactory {
	return &ClusterContextFactory{
		clientFactory:       clients.NewKubernetesClientFactory(),
		defaultResyncPeriod: DEFAULT_RESYNC_PERIOD,
	}
}

// Create creates a new ClusterContext with the given parameters.
func (f *ClusterContextFactory) Create(name string, kubeconfig string, resources []string) (*ClusterContext, error) {
	// create new clients given the kubeconfig and context name
	clientset, dynamicClient, err := f.clientFactory.CreateClients(kubeconfig, name)
	if err != nil {
		return nil, fmt.Errorf("error creating cluster context clients: %w", err)
	}

	stateMap := make(map[string]types.ResourceStateEventType)
	for _, resource := range resources {
		stateMap[resource] = types.ClusterContextResourceNotReady
	}

	return &ClusterContext{
		Name:                  name,
		Kubeconfig:            kubeconfig,
		Clientset:             clientset,
		DynamicClient:         dynamicClient,
		SharedInformerFactory: informers.NewSharedInformerFactory(clientset, f.defaultResyncPeriod),
		ResourceStates:        stateMap,
	}, nil
}
