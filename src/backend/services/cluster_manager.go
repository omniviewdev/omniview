package services

import (
	"context"
	"fmt"
	"sync"

	"github.com/omniviewdev/omniview/backend/types"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/clientcmd"
)

// ResourceStateEvent is a simple struct that holds the name of a resource and its readiness state.
type ResourceStateEvent struct {
	// Error is an error that occurred while trying to mark the resource as ready
	Error error
	// ClusterContext is the name of the cluster context
	ClusterContext string
	// Resource is the name of the resource.
	Resource schema.GroupVersionResource
	// Action is the action to take on the resource
	State types.ResourceStateEventType
}

// ClusterManager manages multiple cluster contexts, allowing for dynamic switching
// and notification to interested parties about the active context change.
type ClusterManager struct {
	// log is the logger for the cluster manager.
	log *zap.SugaredLogger

	// ctx is the wails runtime context
	ctx context.Context

	// contexts holds all registered cluster contexts by their names. Each cluster context
	// contains clients that each resource service can register informers for to watch resources.
	clusterContexts map[string]*ClusterContext

	// clusterContextFactory is a factory for creating cluster contexts for the cluster manager to initialize.
	// This factory is primarily for the main cluster manager to use, which it can then dispatch over the
	// publisher so other resource servers can listen and take action against the new context.
	clusterContextFactory *ClusterContextFactory

	// contextChannel is used to broadcast changes to cluster contexts to listeners. When the application
	// adds, removes, starts or stops listening on a cluster context, it will broadcast the new context to all
	// listeners, so they can react to the change and update their state accordingly. Most resource servers
	// should use this to fetch new clients, so they can start watching resources in the new context.
	clusterContextPublisher *ClusterContextPublisher

	// resources holds a map of al registered resources and their ready state. This is used to
	// determine if all the dependent services are ready and initializes with informers/clients for
	// the active context.
	// The keys here should be the result of the gvr.String() method
	resources map[string]bool

	// resourceChannel is used to broadcast the readiness of resources. When a resource is ready, it will
	// signal to this channel, and when all resources are ready, it will signal to the UI that it can render.
	resourceChannel chan ResourceStateEvent
	// Lock for the cluster manager
	sync.RWMutex
}

// NewClusterManager initializes and returns a new instance of a ClusterManager, along with a channel
// for other services to recieve context updates.
func NewClusterManager(log *zap.SugaredLogger) (*ClusterManager, *ClusterContextPublisher, chan ResourceStateEvent) {
	cp := &ClusterContextPublisher{
		log:  log.With("service", "ClusterManager::ClusterContextPublisher"),
		subs: make(map[string]chan ClusterContextEvent),
	}

	resourceChannel := make(chan ResourceStateEvent, 100)

	return &ClusterManager{
		log:                     log.With("service", "ClusterManager"),
		clusterContexts:         make(map[string]*ClusterContext),
		clusterContextFactory:   NewClusterContextFactory(),
		clusterContextPublisher: cp,
		resources:               make(map[string]bool),
		resourceChannel:         resourceChannel,
	}, cp, resourceChannel
}

// Run starts the cluster manager and listens for context updates. This method should be called
// when the application starts, so the manager can start listening for context changes and broadcast
// the active context to all interested parties.
func (cm *ClusterManager) Run(ctx context.Context) {
	cm.ctx = ctx

	// start listening for context updates.
	go func() {
		for {
			select {
			case resourceState := <-cm.resourceChannel:
				// when we recieve resource state events, handle them accordingly
				// cm.log.Debugw("received resource state", "resource", resourceState)

				switch resourceState.State {
				case types.ResourceAdded:
					cm.AddResource(resourceState.Resource)
				case types.ResourceRemoved:
					cm.RemoveResource(resourceState.Resource)
				case types.ResourceReady:
					cm.SetResourceReady(resourceState.Resource)
				case types.ResourceNotReady:
					cm.ResetResourceReady(resourceState.Resource)
				case types.ClusterContextResourceReady:
					cm.SetClusterContextResourceReady(resourceState.ClusterContext, resourceState.Resource.String())
				case types.ClusterContextResourceNotReady:
					cm.SetClusterContextResourceNotReady(resourceState.ClusterContext, resourceState.Resource.String())
				case types.ClusterContextResourceError:
					cm.SetClusterContextResourceError(resourceState.ClusterContext, resourceState.Resource.String())
				}
			case <-cm.ctx.Done():
				// The context has been cancelled, so stop listening for updates.
				cm.log.Debug("stopping cluster manager")
				return
			}
		}
	}()
}

// SyncKubeconfig synchronizes the cluster manager's context list with the kubeconfig file at the specified path.
func (cm *ClusterManager) SyncKubeconfig(kubeconfigPath string) error {
	// Load the kubeconfig file to get the configuration.
	config, err := clientcmd.LoadFromFile(kubeconfigPath)
	if err != nil {
		err = fmt.Errorf("failed to load kubeconfig from path %s: %w", kubeconfigPath, err)
		cm.log.Error(err)
		return err
	}

	// Extract the list of context names from the kubeconfig.
	kubeconfigContexts := make(map[string]struct{})
	for contextName := range config.Contexts {
		kubeconfigContexts[contextName] = struct{}{}
	}

	// log out the kubeconfigContexts
	cm.log.Debugw("loaded kubeconfig contexts", "contexts", kubeconfigContexts)

	// Add or update contexts from the kubeconfig.
	for contextName := range kubeconfigContexts {
		if _, exists := cm.clusterContexts[contextName]; !exists {
			cm.log.Debugw("context not found, adding", "name", contextName)
			// This context is not already registered, so add it.
			err := cm.AddContext(kubeconfigPath, contextName)
			if err != nil {
				cm.log.Errorw("failed to add or update context", "name", contextName, "kubeconfig", kubeconfigPath, "error", err)
				// Decide how to handle partial failures. This example continues processing.
			}
		} else {
			cm.log.Debugw("context exists, skipping", "name", contextName)
		}
	}

	// // Remove contexts that are no longer in the kubeconfig.
	// for contextName := range cm.clusterContexts {
	// 	if _, exists := kubeconfigContexts[contextName]; !exists {
	// 		// this context is registered but not found in the updated kubeconfig, so remove it.
	// 		cm.RemoveContext(kubeconfigPath, contextName)
	// 		// no need to log here as RemoveContext could be silent for non-existent contexts.
	// 	}
	// }

	return nil
}

// AddContext registers a new cluster context with the manager
// This method is thread-safe.
func (cm *ClusterManager) AddContext(kubeconfig, name string) error {
	cm.Lock()
	defer cm.Unlock()

	log := cm.log.With("kubeconfig", kubeconfig, "name", name)
	log.Debugw("adding context to manager")

	// check if the context already exists and return an error if it does.
	key := fmt.Sprintf("%s:%s", kubeconfig, name)
	if _, exists := cm.clusterContexts[key]; exists {
		err := fmt.Errorf("error adding context to manager: context already exists")
		cm.log.Error(err)
		return err
	}

	// get the resources we're tracking so the context knows what's ready for it
	resources := make([]string, 0, len(cm.resources))
	for gvr := range cm.resources {
		resources = append(resources, gvr)
	}

	// generate a client from the factory
	clusterContext, err := cm.clusterContextFactory.Create(name, kubeconfig, resources)
	if err != nil {
		err = fmt.Errorf("error adding context to manager: %w", err)
		cm.log.Error(err)
		return err
	}

	cm.clusterContexts[key] = clusterContext

	// signal that a context has been added
	cm.clusterContextPublisher.Publish(AddClusterContext, clusterContext)

	cm.log.Debugw("added context to manager")
	return nil
}

// RemoveContext removes a cluster context from the manager by its name.
// If the removed context is currently active, this method also nullifies the active context.
// This method is thread-safe.
func (cm *ClusterManager) RemoveContext(kubeconfig, name string) {
	cm.Lock()
	defer cm.Unlock()

	log := cm.log.With("kubeconfig", kubeconfig, "name", name)
	log.Debugw("removing context to manager")

	// Check if the context exists and remove it.
	key := fmt.Sprintf("%s:%s", kubeconfig, name)
	clusterContext, exists := cm.clusterContexts[key]
	if exists {
		// we're about to lose the context, so signal to the publisher that it's going away
		cm.clusterContextPublisher.Publish(RemoveClusterContext, clusterContext)
		delete(cm.clusterContexts, name)
	}
}

// ListContexts returns a list of all registered cluster context names.
// This method is thread-safe.
func (cm *ClusterManager) ListContexts() map[string]*ClusterContext {
	cm.log.Debugf("listing contexts")

	cm.RLock()
	defer cm.RUnlock()

	return cm.clusterContexts
}

// GetContext returns the cluster context with the specified name.
// This method is thread-safe.
func (cm *ClusterManager) GetContext(kubeconfig, name string) *ClusterContext {
	cm.RLock()
	defer cm.RUnlock()

	key := fmt.Sprintf("%s:%s", kubeconfig, name)
	return cm.clusterContexts[key]
}

// StartListening signals for resources to start listening for changes to the specified cluster context.
// This method is thread-safe.
func (cm *ClusterManager) StartContext(name string) (map[string]bool, error) {
	cm.log.Debugf("signaling resources to start listening on cluster context", "name", name)
	cm.RLock()
	defer cm.RUnlock()

	if clusterContext, exists := cm.clusterContexts[name]; exists {
		// first upsert resource states for the resources
		clusterContext.UpsertResourceState(cm.resources)

		// signal to all subscribed services to start acting on the cluster context
		cm.clusterContextPublisher.Publish(StartClusterContext, clusterContext)
		return clusterContext.GetResourceStatesAsBoolMap(), nil
	}

	return nil, fmt.Errorf("error starting context: context not found")
}

// StopListening signals for resources to stop listening for changes to the specified cluster context.
// This method is thread-safe.
func (cm *ClusterManager) StopContext(name string) error {
	cm.log.Debugf("signaling resources to stop listening on cluster context", "name", name)
	cm.RLock()
	defer cm.RUnlock()

	if clusterContext, exists := cm.clusterContexts[name]; exists {
		// signal to all subscribed services to stop acting on the cluster context
		cm.clusterContextPublisher.Publish(StopClusterContext, clusterContext)
		return nil
	}
	return fmt.Errorf("error stopping context: context not found")
}

// ============================================== GETTERS/SETTERS ============================================== //

// GetPublisher returns the context publisher for the cluster manager.
// This method is thread-safe.
func (cm *ClusterManager) GetClusterContextPublisher() *ClusterContextPublisher {
	cm.RLock()
	defer cm.RUnlock()
	return cm.clusterContextPublisher
}

// AddResource registers a new resource with the manager so it can be tracked
// for readiness. This should be called by the Run function for each resource server
// so that it can be used to make the UI defer rendering until all resources are ready.
func (cm *ClusterManager) AddResource(gvr schema.GroupVersionResource) {
	cm.Lock()
	defer cm.Unlock()
	gvrID := gvr.String()

	cm.resources[gvrID] = false
	cm.log.Debugw("added resources to cluster manager", "resource", gvrID)
}

// RemoveResource removes a resource from the manager so it is no longer tracked
// for readiness.
func (cm *ClusterManager) RemoveResource(gvr schema.GroupVersionResource) {
	cm.Lock()
	defer cm.Unlock()
	gvrID := gvr.String()

	if _, exists := cm.resources[gvrID]; exists {
		// gaurd is technically not needed here, but want to log the delete
		// if it is actually removed
		delete(cm.resources, gvrID)
		cm.log.Debugw("removed resource from cluster manager", "resource", gvrID)
	}
}

// SetResourceReady sets the readiness state of the specified resource to true.
func (cm *ClusterManager) SetResourceReady(gvr schema.GroupVersionResource) {
	cm.Lock()
	defer cm.Unlock()
	gvrID := gvr.String()

	cm.resources[gvrID] = true
	runtime.EventsEmit(cm.ctx, "CLUSTER_MANAGER::RESOURCE::READY", gvrID)
	cm.log.Debugw("resource signalled ready", "resource", gvrID)

	// if all the resources are ready, signal to the ui that it can render
	for _, ready := range cm.resources {
		if !ready {
			return
		}
	}

	runtime.EventsEmit(cm.ctx, "CLUSTER_MANAGER::RESOURCE::ALL_READY", cm.resources)
	cm.log.Debugf("all resources signalled ready", "resources", cm.resources)
}

// ResetResourceReady sets the readiness state of the specified resource to false.
func (cm *ClusterManager) ResetResourceReady(gvr schema.GroupVersionResource) {
	cm.Lock()
	defer cm.Unlock()
	gvrID := gvr.String()

	cm.resources[gvrID] = false
	cm.log.Debugf("resource marked not ready", "resource", gvrID)
}

// ResetAllResourcesReady sets the readiness state of all resources to false.
// This method is thread-safe.
func (cm *ClusterManager) ResetAllResourcesReady() {
	cm.Lock()
	defer cm.Unlock()
	for name := range cm.resources {
		cm.resources[name] = false
	}
	cm.log.Debugf("all resources signalled not ready", "resources", cm.resources)
	runtime.EventsEmit(cm.ctx, "CLUSTER_MANAGER::RESOURCE::ALL_NOT_READY", cm.resources)
}

// SetClusterContextResourceReady sets the readiness state of the specified resource to true.
// This method is thread-safe.
func (cm *ClusterManager) SetClusterContextResourceReady(contextName string, gvr string) {
	cm.Lock()
	defer cm.Unlock()
	// get the context
	clusterContext := cm.clusterContexts[contextName]
	if clusterContext == nil {
		cm.log.Errorf("error setting resource ready: context not found")
		return
	}
	// mark the resource as ready
	clusterContext.MarkResourceReady(gvr)
	runtime.EventsEmit(cm.ctx, fmt.Sprintf("%s::RESOURCE::READY", contextName), gvr)

	// if all the resources are ready, signal to the ui that it can render
	if clusterContext.AllResourcesReady() {
		runtime.EventsEmit(cm.ctx, fmt.Sprintf("%s::RESOURCE::ALL_READY", contextName), cm.resources)
	}
}

// SetClusterContextResourceNotReady sets the readiness state of the specified resource to false.
func (cm *ClusterManager) SetClusterContextResourceNotReady(contextName string, gvr string) {
	cm.Lock()
	defer cm.Unlock()
	// get the context
	clusterContext := cm.clusterContexts[contextName]
	if clusterContext == nil {
		cm.log.Errorf("error setting resource not ready: context not found")
		return
	}
	// mark the resource as not ready
	clusterContext.MarkResourceNotReady(gvr)
	runtime.EventsEmit(cm.ctx, fmt.Sprintf("%s::RESOURCE::NOT_READY", contextName), gvr)
}

// SetClusterContextResourceError sets the readiness state of the specified resource to error.
func (cm *ClusterManager) SetClusterContextResourceError(contextName string, gvr string) {
	cm.Lock()
	defer cm.Unlock()
	// get the context
	clusterContext := cm.clusterContexts[contextName]
	if clusterContext == nil {
		cm.log.Errorf("error setting resource error: context not found")
		return
	}
	// mark the resource as errored
	clusterContext.MarkResourceError(gvr)
	runtime.EventsEmit(cm.ctx, fmt.Sprintf("%s::RESOURCE::ERROR", contextName), gvr)
}

// ========================================= STATISTICS ======================================== //
// Methods for being able to get statuses from the cluster manager

// GetClusterContexts returns a list of all registered cluster contexts and their resource states.
func (cm *ClusterManager) GetClusterContexts() map[string]*ClusterContext {
	cm.RLock()
	defer cm.RUnlock()

	return cm.clusterContexts
}

// GetResources returns a map of all the resources and their ready states.
func (cm *ClusterManager) GetResources() map[string]bool {
	cm.RLock()
	defer cm.RUnlock()

	return cm.resources
}

// GetClusterContextResourceStates returns the readiness state of all resources for the specified cluster context.
func (cm *ClusterManager) GetClusterContextResourceStates(contextName string) map[string]bool {
	cm.RLock()
	defer cm.RUnlock()
	// get the context
	clusterContext := cm.clusterContexts[contextName]
	if clusterContext == nil {
		cm.log.Errorf("error getting resource states: context not found")
		return nil
	}
	return clusterContext.GetResourceStatesAsBoolMap()
}
