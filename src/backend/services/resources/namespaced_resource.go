package resources

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/joshuapare/kubede/backend/clients"
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/types"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const (
	ADD_CHANNEL_BUFFER_SIZE    = 100
	UPDATE_CHANNEL_BUFFER_SIZE = 100
	DELETE_CHANNEL_BUFFER_SIZE = 100
)

// NamespacedResourceService provides a base implementation of the ResourceService interface.
// It manages the lifecycle of informers for a specific Kubernetes resource and handles context switching,
// ensuring that resource data is consistently up-to-date and accessible.
type NamespacedResourceService[T MetaAccessor] struct {
	sync.RWMutex
	// Logger
	log *zap.SugaredLogger

	// Wails runtime context
	ctx context.Context

	// resourceType is the group version resource for the resource this service manages.
	resourceType schema.GroupVersionResource

	// map of clients for each cluster context. The key in each one of these is the aggregate of the kubeconfig
	// and the context name.
	clients map[string]*clients.ClusterContextClient[T]

	// stopCh is a channel used to stop the informer when the service is stopped or the context is switched
	// This channel is used when changes need to be made to the instance of the namespaced resource service.
	stopCh chan struct{}

	// stateChan is a channel for dispatching state changes for context clients to the cluster manager
	stateChan chan<- services.ResourceStateEvent

	// clusterContextPublisher is the pubsub for cluster context events. this is embedded so that the
	// service can subscribe to the cluster context publisher at it's own accord
	clusterContextPublisher *services.ClusterContextPublisher

	// clusterContextChannel is a reciever channel for receiving updates to the cluster context
	clusterContextChannel <-chan services.ClusterContextEvent

	// dispatcherMux is a mutex for the event dispatcher, ensuring that we don't clear out events while we're
	// in the middle of dispatching them.
	dispatcherMux sync.Mutex

	// addChannel is a buffered for emitting add events to the frontend runtime
	addChannel chan types.AddResourceEvent[T]

	// updateChannel is a buffered for emitting update events to the frontend runtime
	updateChannel chan types.UpdateResourceEvent[T]

	// deleteChannel is a buffered for emitting delete events to the frontend runtime
	deleteChannel chan types.DeleteResourceEvent[T]
}

// NewNamespacedResourceService creates a new instance of NamespacedResourceService for interacting
// with informers and resources in a Kubernetes cluster.
func NewNamespacedResourceService[T MetaAccessor](
	logger *zap.SugaredLogger,
	resourceType schema.GroupVersionResource,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *NamespacedResourceService[T] {
	// Create a new instance of the service
	service := NamespacedResourceService[T]{
		log:                     logger.With("service", fmt.Sprintf("%sService", resourceType.Resource)),
		resourceType:            resourceType,
		clients:                 make(map[string]*clients.ClusterContextClient[T]),
		stopCh:                  make(chan struct{}),
		stateChan:               stateChan,
		clusterContextPublisher: publisher,
		addChannel:              make(chan types.AddResourceEvent[T], ADD_CHANNEL_BUFFER_SIZE),
		updateChannel:           make(chan types.UpdateResourceEvent[T], UPDATE_CHANNEL_BUFFER_SIZE),
		deleteChannel:           make(chan types.DeleteResourceEvent[T], DELETE_CHANNEL_BUFFER_SIZE),
	}

	return &service
}

// SetContext sets the current cluster context for the Pod service. Necessary for emitting to the
// Wails frontend runtime.
func (s *NamespacedResourceService[T]) SetContext(ctx context.Context) {
	s.ctx = ctx
}

// GroupVersionResource returns the GroupVersionResource for the resource this service manages.
func (s *NamespacedResourceService[T]) GroupVersionResource() schema.GroupVersionResource {
	return s.resourceType
}

// AddClusterContext adds a new context client to the resource service. If the context already exists, it is updated.
// This method is thread-safe.
func (s *NamespacedResourceService[T]) AddClusterContext(context *services.ClusterContext) {
	s.Lock()
	defer s.Unlock()
	name := fmt.Sprintf("%s:%s", context.Kubeconfig, context.Name)
	s.log.Debugw("adding context to resource service", "name", name)

	// Create a new client for the context
	client, err := clients.NewClusterContextClient[T](
		s.log,
		name,
		context.SharedInformerFactory,
		s.resourceType,
		s.addChannel,
		s.updateChannel,
		s.deleteChannel,
	)
	if err != nil {
		s.log.Errorw("error creating new context client", "error", err)
		return
	}

	// if the client already exists, we should stop it and remove it before we update it
	if client, ok := s.clients[name]; ok {
		client.Stop()
		delete(s.clients, name)
	}

	// Add the client to the map of clients and initialize it to prepare it for use
	// in the service. At this point, the client is not started.
	s.clients[name] = client
}

// StartContext starts one of the context clients for the resource service.
// This method is thread-safe.
func (s *NamespacedResourceService[T]) StartClusterContext(contextName string) {
	s.Lock()
	defer s.Unlock()
	if client, ok := s.clients[contextName]; ok {
		if err := client.Start(); err != nil {
			s.log.Errorw("error starting context client", "error", err)
			s.stateChan <- services.ResourceStateEvent{
				ClusterContext: contextName,
				Resource:       s.resourceType,
				State:          types.ClusterContextResourceError,
				Error:          err,
			}
			return
		}
	} else {
		s.log.Errorw("client not found for context when starting", "context", contextName)
		return
	}

	s.stateChan <- services.ResourceStateEvent{
		ClusterContext: contextName,
		Resource:       s.resourceType,
		State:          types.ClusterContextResourceReady,
	}
}

// StopClusterContext stops one of the context clients for the resource service.
// This method is thread-safe.
func (s *NamespacedResourceService[T]) StopClusterContext(contextName string) {
	s.Lock()
	defer s.Unlock()

	if client, ok := s.clients[contextName]; ok {
		client.Stop()
		s.stateChan <- services.ResourceStateEvent{
			ClusterContext: contextName,
			Resource:       s.resourceType,
			State:          types.ClusterContextResourceNotReady,
		}
	}
}

// Stop gracefully stops the service and all associated clients and signals
// to the cluster manager that is no longer in a ready state.
func (s *NamespacedResourceService[T]) Stop() {
	s.Lock()
	defer s.Unlock()
	s.log.Debugw("stopping resource service", "type", s.resourceType)

	for name, client := range s.clients {
		if client != nil {
			client.Stop()
			s.stateChan <- services.ResourceStateEvent{
				ClusterContext: name,
				Resource:       s.resourceType,
				State:          types.ClusterContextResourceNotReady,
			}
		}
	}

	// Signal that the resource is not ready to the cluster manager
	s.stateChan <- services.ResourceStateEvent{
		Resource: s.resourceType,
		State:    types.ResourceNotReady,
	}

	s.Lock()
	defer s.Unlock()

	close(s.stopCh)

	// Reinitialize the stopCh in case the service is started again later.
	s.stopCh = make(chan struct{})
	s.log.Debugw("stopped resource service", "type", s.resourceType)
}

// Run is a long-running function that listens for context updates and switches the service's context when necessary.
// It also handles shutdown signals to stop the service gracefully.
func (s *NamespacedResourceService[T]) Run(ctx context.Context) {
	s.log.Info("starting resource service listener")

	// Set the context for the service
	s.SetContext(ctx)

	// Signal that the resource should be added to the cluster manager
	s.stateChan <- services.ResourceStateEvent{
		Resource: s.resourceType,
		State:    types.ResourceAdded,
	}

	// Ensure that we do not leak go routines by closing any existing stop channel.
	if s.stopCh == nil {
		s.stopCh = make(chan struct{})
	}

	// subscribe to context updates and add them to the resource list
	s.clusterContextChannel = s.clusterContextPublisher.Subscribe(s.resourceType.Resource)

	go func() {
		// Start a ticker for periodic flushing
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()

		// signal that we're ready
		s.stateChan <- services.ResourceStateEvent{
			Resource: s.resourceType,
			State:    types.ResourceReady,
		}

		for {
			select {
			case contextEvent := <-s.clusterContextChannel:
				switch contextEvent.Action {
				case services.AddClusterContext:
					s.AddClusterContext(contextEvent.Context)
				case services.StartClusterContext:
					s.StartClusterContext(contextEvent.GetKey())
				case services.StopClusterContext:
					s.StopClusterContext(contextEvent.GetKey())
				}

			case <-ticker.C:
				// Dispatch events to the frontend runtime on a regular interval
				// instead of immediately to avoid flooding the frontend with events.
				// Would rather not let the language runtime handle this.
				s.DispatchEvents()
			case <-s.stopCh:
				s.log.Debugw("shutting down resource service listener", "type", s.resourceType)

				// Signal that the resource should be removed to the cluster manager
				s.stateChan <- services.ResourceStateEvent{
					Resource: s.resourceType,
					State:    types.ResourceRemoved,
				}

				return
			}
		}
	}()
}

// DispatchEvents dispatches events to the frontend runtime for the resource type. All
// events are batched and emitted at once to avoid constantly flooding the frontend
// with events.
//
// Events dispatched are:
// - Add events: <context>::<resource>::ADD
// - Update events: <context>::<resource>::UPDATE
// - Delete events: <context>::<resource>::DELETE
//
// This method is thread-safe.
func (s *NamespacedResourceService[T]) DispatchEvents() {
	s.dispatcherMux.Lock()
	defer s.dispatcherMux.Unlock()

	// Dispatch add events
	addLen := len(s.addChannel)
	if addLen > 0 {
		s.log.Debugw("dispatching add event")

		// separate our events by cluster context
		contextEvents := make(map[string][]T)

		keepProcessing := true
		for i := 0; i < addLen; i++ {
			if !keepProcessing {
				break
			}
			select {
			case elem := <-s.addChannel:
				// if the context map entry doesn't exist, create it
				if _, ok := contextEvents[elem.ClusterContext]; !ok {
					contextEvents[elem.ClusterContext] = make([]T, 0)
				}
				contextEvents[elem.ClusterContext] = append(contextEvents[elem.ClusterContext], elem.Obj)
			default:
				keepProcessing = false
			}
		}

		// flush the events to the frontend runtime
		for context, events := range contextEvents {
			runtime.EventsEmit(s.ctx, fmt.Sprintf("%s::%s::ADD", context, s.resourceType.Resource), events)
		}
	}

	updateLen := len(s.updateChannel)
	if updateLen > 0 {
		s.log.Debugw("dispatching update event")

		// separate our events by cluster context
		contextEvents := make(map[string][]types.UpdateObject[T])

		keepProcessing := true
		for i := 0; i < updateLen; i++ {
			if !keepProcessing {
				break
			}
			select {
			case elem := <-s.updateChannel:
				// if the context map entry doesn't exist, create it
				if _, ok := contextEvents[elem.ClusterContext]; !ok {
					contextEvents[elem.ClusterContext] = make([]types.UpdateObject[T], 0)
				}
				contextEvents[elem.ClusterContext] = append(contextEvents[elem.ClusterContext], types.UpdateObject[T]{
					OldObj: elem.OldObj,
					NewObj: elem.NewObj,
				})

			default:
				keepProcessing = false
			}
		}

		// flush the events to the frontend runtime
		for context, events := range contextEvents {
			runtime.EventsEmit(s.ctx, fmt.Sprintf("%s::%s::UPDATE", context, s.resourceType.Resource), events)
		}
	}

	deleteLen := len(s.updateChannel)
	if deleteLen > 0 {
		s.log.Debugw("dispatching delete event")

		// separate our events by cluster context
		contextEvents := make(map[string][]T)

		keepProcessing := true
		for i := 0; i < addLen; i++ {
			if !keepProcessing {
				break
			}
			select {
			case elem := <-s.addChannel:
				// if the context map entry doesn't exist, create it
				if _, ok := contextEvents[elem.ClusterContext]; !ok {
					contextEvents[elem.ClusterContext] = make([]T, 0)
				}
				contextEvents[elem.ClusterContext] = append(contextEvents[elem.ClusterContext], elem.Obj)
			default:
				keepProcessing = false
			}
		}

		// flush the events to the frontend runtime
		for context, events := range contextEvents {
			runtime.EventsEmit(s.ctx, fmt.Sprintf("%s::%s::DELETE", context, s.resourceType.Resource), events)
		}
	}
}

// ClearEvents clears the event channels and removes any pending events.
// This method is thread-safe.
func (s *NamespacedResourceService[T]) ClearEvents() {
	s.dispatcherMux.Lock()
	defer s.dispatcherMux.Unlock()

	// empty the event channels
L:
	for {
		select {
		case <-s.addChannel:
		case <-s.updateChannel:
		case <-s.deleteChannel:
		default:
			break L
		}
	}
}

// GetClients returns a map of clients for the provided contexts.
func (s *NamespacedResourceService[T]) getClients(contexts []string) map[string]*clients.ClusterContextClient[T] {
	s.RLock()
	defer s.RUnlock()
	clients := make(map[string]*clients.ClusterContextClient[T])
	for _, context := range contexts {
		if client, ok := s.clients[context]; ok {
			clients[context] = client
		}
	}
	return clients
}

// GetClient returns a client for the provided context.
func (s *NamespacedResourceService[T]) getClient(context string) (*clients.ClusterContextClient[T], bool) {
	s.RLock()
	defer s.RUnlock()
	client, ok := s.clients[context]
	return client, ok
}

// ============================ ACTION METHODS ============================ //
func (s *NamespacedResourceService[T]) List(opts ListOptions) (interface{}, error) {
	s.log.Debugw("listing resources", "resource", s.resourceType, "opts", opts)

	ctxClients := s.getClients(opts.ClusterContexts)
	if len(ctxClients) == 0 {
		return nil, fmt.Errorf("no clients found for the cluster contexts")
	}

	var wg sync.WaitGroup
	results := make(map[string][]T)
	var mutex sync.Mutex // Protects access to results map

	resultChan := make(chan struct {
		name   string
		config []T
	}, len(ctxClients)) // Buffered channel to hold results from goroutines

	for name, client := range ctxClients {
		wg.Add(1)
		go func(name string, client *clients.ClusterContextClient[T]) {
			defer wg.Done()

			if client.Lister == nil {
				resultChan <- struct {
					name   string
					config []T
				}{name, nil}
				return
			}

			objects, err := client.Lister.List(labels.Everything())
			if err != nil {
				resultChan <- struct {
					name   string
					config []T
				}{name, nil}
				return
			}

			result := make([]T, 0, len(objects))
			for _, obj := range objects {
				obj, ok := obj.(T)
				if !ok {
					resultChan <- struct {
						name   string
						config []T
					}{name, nil}
					return
				}

				if ShouldInclude(obj, opts) {
					result = append(result, obj)
				}
			}
			resultChan <- struct {
				name   string
				config []T
			}{name, result}
		}(name, client)
	}

	go func() {
		wg.Wait()
		close(resultChan)
	}()

	for r := range resultChan {
		if r.config != nil { // Check if the goroutine encountered an error
			mutex.Lock()
			results[r.name] = r.config
			mutex.Unlock()
		}
	}

	return results, nil
}

// Get returns a resource by name and namespace
func (s *NamespacedResourceService[T]) Get(opts GetOptions) (interface{}, error) {
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

func (s *NamespacedResourceService[T]) Edit(name string, namespace string, obj interface{}) error {
	// Default implementation, can be overridden by embedded services
	return fmt.Errorf("edit not implemented")
}

func (s *NamespacedResourceService[T]) Delete(name string, namespace string) error {
	// Default implementation, can be overridden by embedded services
	return fmt.Errorf("delete not implemented")
}
