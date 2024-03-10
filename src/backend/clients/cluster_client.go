package clients

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/backend/types"
	"go.uber.org/zap"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

const (
	CACHE_SYNC_TIMEOUT = 10 * time.Second
)

// IClusterContextClient is the interface for a cluster context client. This is used to set up a
// resource listener and informer for a specific cluster context. With this, we can have multiple
// cluster contexts active and listening for changes to resources in each cluster we have open.
type IClusterContextClient interface {
	// Name returns the name of the cluster context.
	Name() string
	// GroupVersionResource returns the group version resource for the informer.
	GroupVersionResource() schema.GroupVersionResource
	// GetLister returns the lister for the resource type.
	GetLister() cache.GenericLister
	// Initialize initializes the informer and lister for the resource type, but does not start the
	Initialize(informerFactory informers.SharedInformerFactory, resourceType schema.GroupVersionResource) error
	// Starts initiates a cache sync for the informer, and then starts running the informer, if it
	Start() error
	// Stop stops the informer from running without tearing it down, so that it can be started again
	Stop()
	// Run starts the informer and runs it until the stopCh is closed. This is a blocking call and
	// should be run in a goroutine.
	Run()
	// IsRunning returns true if the informer is running, and false if it is not.
	IsRunning() bool
	// Status returns the status of the informer
	Status() ClusterContextClientStatus
}

type ClusterContextClientStatus int

const (
	ClusterContextClientStatusNotReady ClusterContextClientStatus = iota
	ClusterContextClientStatusReady
	ClusterContextClientStatusRunning
	ClusterContextClientStatusStopped
	ClusterContextClientStatusError
)

func (s ClusterContextClientStatus) String() string {
	return [...]string{
		"NotReady",
		"Ready",
		"Running",
		"Stopped",
		"Error",
	}[s]
}

// ClusterContextClient sets up a resource listener and informer for a specific cluster context. With
// this, we can have multiple cluster contexts active and listening for changes to resources in each
// cluster we have open.
// TODO - allow the ability to filter the informer by namespace
// TODO - allow the ability to choose between an informer for real time updates and solely a lister without an informer
type ClusterContextClient[T any] struct {
	// log is the logger for the cluster context watcher
	log *zap.SugaredLogger `json:"-"`
	// name is the name of the cluster context
	name string `json:"-"`
	// gvr is the group version resource for the informer
	gvr schema.GroupVersionResource `json:"-"`
	// informer is the shared informer for the resource
	Informer cache.SharedInformer `json:"-"`
	// lister is the lister for the resource
	Lister cache.GenericLister `json:"-"`
	// stopCh is used to stop and start the informer
	stopCh chan struct{} `json:"-"`
	// addChannel is the channel to emit add events to
	addChannel chan types.AddResourceEvent[T] `json:"-"`
	// updateChannel is the channel to emit update events to the cluster manager
	updateChannel chan types.UpdateResourceEvent[T] `json:"-"`
	// deleteChannel is the channel to emit delete events to the cluster manager
	deleteChannel chan types.DeleteResourceEvent[T] `json:"-"`
	// status is the status of the Informer
	status ClusterContextClientStatus `json:"-"`
	// make this resource lockable to allow for thread safety
	sync.RWMutex `json:"-"`
}

// NewClusterContextClient creates a new ClusterContextClient for a specific cluster context. This
// will set up the informer and lister for the resource type and start the informer. The informer
// will be used to listen for changes to the resource in the cluster context and emit events to the
// frontend runtime.
func NewClusterContextClient[T any](
	// the logger
	logger *zap.SugaredLogger,
	name string,
	sharedInformerFactory informers.SharedInformerFactory,
	resourceType schema.GroupVersionResource,
	addChannel chan types.AddResourceEvent[T],
	updateChannel chan types.UpdateResourceEvent[T],
	deleteChannel chan types.DeleteResourceEvent[T],
) (*ClusterContextClient[T], error) {
	// help us out with logs and errors
	log := logger.With("clusterContext", name, "resourceType", resourceType)
	withError := func(err error) (*ClusterContextClient[T], error) {
		return nil, fmt.Errorf("error creating cluster context client: %w", err)
	}

	if addChannel == nil || updateChannel == nil || deleteChannel == nil {
		return withError(fmt.Errorf("one or more channels are not setup"))
	}

	client := &ClusterContextClient[T]{
		log:           log,
		name:          name,
		gvr:           resourceType,
		stopCh:        make(chan struct{}),
		addChannel:    addChannel,
		updateChannel: updateChannel,
		deleteChannel: deleteChannel,
		status:        ClusterContextClientStatusNotReady,
	}

	// initialize with the informer and lister
	if err := client.Initialize(sharedInformerFactory, resourceType); err != nil {
		return withError(err)
	}

	return client, nil
}

// IsRunning returns true if the informer is running, and false if it is not.
func (c *ClusterContextClient[T]) IsRunning() bool {
	c.RLock()
	defer c.RUnlock()

	return c.status == ClusterContextClientStatusRunning
}

// Status returns the status of the informer.
func (c *ClusterContextClient[T]) Status() ClusterContextClientStatus {
	c.RLock()
	defer c.RUnlock()
	return c.status
}

// GetLister returns the lister for the resource type.
func (c *ClusterContextClient[T]) GetLister() cache.GenericLister {
	c.RLock()
	defer c.RUnlock()

	return c.Lister
}

// Name returns the name of the cluster context.
func (c *ClusterContextClient[T]) Name() string {
	c.RLock()
	defer c.RUnlock()

	return c.name
}

// GroupVersionResource returns the group version resource for the informer.
func (c *ClusterContextClient[T]) GroupVersionResource() schema.GroupVersionResource {
	c.RLock()
	defer c.RUnlock()
	return c.gvr
}

// Initialize initializes the informer and lister for the resource type, but does not start the
// informer. This is useful for when we want to resetup new informers, such as when auth changes
// require us providing a new factory.
//
// We should not, by purposeful design, change the resource type after the informer has been initialized,
// as each client should be solely scoped to a single resource type. This is to prevent the possibility
// of a client being used for multiple resource types, which would be a violation of the single
// responsibility principle.
func (c *ClusterContextClient[T]) Initialize(
	informerFactory informers.SharedInformerFactory,
	resourceType schema.GroupVersionResource,
) error {
	c.Lock()
	defer c.Unlock()

	switch c.status {
	case ClusterContextClientStatusRunning:
		return fmt.Errorf("cannot initialize informer: client is already running")
	case ClusterContextClientStatusError:
		return fmt.Errorf("cannot initialize informer: client is in an error state")
	case ClusterContextClientStatusReady:
		return fmt.Errorf("cannot initialize informer: client is already ready")
	case ClusterContextClientStatusStopped:
	// initializable state, do nothing
	case ClusterContextClientStatusNotReady:
		// initializable state, do nothing
	}

	c.log = c.log.With("resourceType", resourceType)

	newErr := func(err error) error {
		c.status = ClusterContextClientStatusError
		errPrefix := fmt.Sprintf("error initializing informer for resource '%s'", resourceType.String())
		return fmt.Errorf("%s: %w", errPrefix, err)
	}

	// check to make sure all the channels are setup
	// if they are not, we need to return an error
	if c.addChannel == nil || c.updateChannel == nil || c.deleteChannel == nil {
		return newErr(fmt.Errorf("one or more channels are not setup"))
	}

	// check to make sure the resource type isn't changing if it was already setup
	if !c.gvr.Empty() && c.gvr.String() != resourceType.String() {
		if c.gvr != resourceType {
			return newErr(fmt.Errorf("resource type cannot be changed after the client has been initialized"))
		}
	}

	// create a new informer and lister for the resource
	indexInformer, err := informerFactory.ForResource(resourceType)
	if err != nil {
		return newErr(err)
	}

	lister := indexInformer.Lister()
	informer := indexInformer.Informer()

	// register our event handlers for when the cache updates
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			c.log.Debug("add event received")

			// type assert
			typed, ok := obj.(T)
			if !ok {
				c.log.Errorw("error type asserting object")
			}

			// protect against empty cluster context names
			if c.name == "" {
				c.log.Error("cannot send add event from informer: cluster context name is empty")
				return
			}
			c.addChannel <- types.AddResourceEvent[T]{
				ClusterContext: c.name,
				Obj:            typed,
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			c.log.Debug("update event received")

			// type assert
			typedOld, ok := oldObj.(T)
			if !ok {
				c.log.Error("error type asserting object")
			}
			typedNew, ok := newObj.(T)
			if !ok {
				c.log.Error("error type asserting object")
			}

			// protect against empty cluster context names
			if c.name == "" {
				c.log.Error("cannot send update event from informer: cluster context name is empty")
				return
			}
			c.updateChannel <- types.UpdateResourceEvent[T]{
				ClusterContext: c.name,
				OldObj:         typedOld,
				NewObj:         typedNew,
			}
		},
		DeleteFunc: func(obj interface{}) {
			c.log.Debug("delete event received")

			// type assert
			typed, ok := obj.(T)
			if !ok {
				c.log.Errorw("error type asserting object")
			}

			if c.name == "" {
				c.log.Error("cannot send delete event from informer: cluster context name is empty")
				return
			}
			c.deleteChannel <- types.DeleteResourceEvent[T]{
				ClusterContext: c.name,
				Obj:            typed,
			}
		},
	})

	c.Informer = informer
	c.Lister = lister
	c.status = ClusterContextClientStatusReady
	return nil
}

// Starts initiates a cache sync for the informer, and then starts running the informer, if it
// was not already running, returning an error if the informer setup or the cache sync fails,
// either by error or by sync timeout.
func (c *ClusterContextClient[T]) Start() error {
	c.Lock()
	defer c.Unlock()

	// take different actions here depending on the current status of the client
	switch c.status {
	case ClusterContextClientStatusRunning:
		c.log.Debug("informer already running")
		return nil
	case ClusterContextClientStatusError:
		return fmt.Errorf("cannot start informer: client is in an error state")
	case ClusterContextClientStatusNotReady:
		return fmt.Errorf("cannot start informer: client is not ready")
	default:
		// do nothing
	}

	c.log.Debug("starting informer")

	// Start the informer in a separate goroutine, giving a signal to the stopCh when it's time to stop.
	if c.stopCh == nil {
		c.stopCh = make(chan struct{})
	}

	go c.Informer.Run(c.stopCh)

	// Create a context with a timeout for cache synchronization.
	syncCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Wait for the informer's cache to sync, with timeout handling.
	synced := make(chan struct{})
	go func() {
		if cache.WaitForCacheSync(syncCtx.Done(), c.Informer.HasSynced) {
			// cache is synced, close the channel to signal success to the select below
			close(synced)
		} else {
			c.log.Error("failed to sync.Informer cache within timeout")
		}
	}()

	select {
	case <-synced:
		// cache is synced, we are good to go
		c.log.Infow("informer cache successfully synced", "type", c.gvr.String())
	case <-syncCtx.Done():
		err := fmt.Errorf("timed out waiting for informer cache to sync")

		// close the stop channel to stop the informer, and then reset it
		close(c.stopCh)
		c.stopCh = make(chan struct{})
		c.log.Error(err)
		c.status = ClusterContextClientStatusError
		return err
	}

	c.status = ClusterContextClientStatusRunning
	return nil
}

// Stop stops the informer from running without tearing it down, so that it can be started again
// later.
func (c *ClusterContextClient[T]) Stop() {
	// take action based on the status of the informer
	switch c.status {
	case ClusterContextClientStatusRunning:
		c.log.Error("stopping informer")
	case ClusterContextClientStatusError:
		c.log.Error("cannot stop informer: client is in an error state")
		return
	case ClusterContextClientStatusNotReady:
		c.log.Error("cannot stop informer: client is not running")
		return
	case ClusterContextClientStatusReady:
		c.log.Error("cannot stop informer: client is not running")
		return
	case ClusterContextClientStatusStopped:
		c.log.Debug("informer already stopped")
		return
	}

	// close the stop channel to stop the informer, and then reset it
	close(c.stopCh)
	c.stopCh = make(chan struct{})
}

// Run starts the informer and runs it until the stopCh is closed. This is a blocking call and
// should be run in a goroutine.
func (c *ClusterContextClient[T]) Run() {
	c.Start()
	<-c.stopCh
}
