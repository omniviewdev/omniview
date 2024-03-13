package services

import (
	"fmt"

	"github.com/omniviewdev/plugin/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin/pkg/types"
)

// InformerOptions defines the behavior for the integrating informers into a resource plugin..
type InformerOptions[ClientT, InformerT any] struct {
	Factory         InformerFactory[ClientT, InformerT]
	RegisterHandler RegisterResourceFunc[InformerT]
	RunHandler      RunInformerFunc[InformerT]
}

// InformerManager is an interface for managing informers for the various resource services.
// An informer watches for changes to resources and broadcasts those changes to the IDE event
// subsystem.
//
// The Informer system is heavily inspired and built around the concept pioneered by the
// Kubernetes API Server, and as such, the informer system is a generalized manager for
// informer implementation similar to that of the Kubernetes API Server and the corresponding
// client-go library.
//
// More information on the Kubernetes informer design can be found here:
// https://www.cncf.io/blog/2019/10/15/extend-kubernetes-via-a-shared-informer/
//
// An important note here is that due to the desired behavior of the resourcer clients being able
// to use the informer local cache for their operations, the informer manager will be provided the
// same client that the resourcer clients use for their operations. If multiple clients are used
// to set up informers, they should be injected as a dependency into the Client setup in the
// ResourceClientFactory.
type InformerManager[ClientT, InformerT any] struct {
	factory            InformerFactory[ClientT, InformerT]
	registerHandler    RegisterResourceFunc[InformerT]
	runHandler         RunInformerFunc[InformerT]
	informers          map[string]informer[InformerT]
	addChan            chan types.InformerAddPayload
	updateChan         chan types.InformerUpdatePayload
	deleteChan         chan types.InformerDeletePayload
	startNamespaceChan chan string
	stopNamespaceChan  chan string
}

// InformerFactory is a factory for creating informers for a given resource namespace.
type InformerFactory[ClientT, InformerT any] interface {
	// CreateInformer creates a new informer for a given resource namespace.
	CreateInformer(
		ctx *pkgtypes.PluginContext,
		auth *pkgtypes.AuthContext,
		client *ClientT,
	) (InformerT, error)
}

type informer[InformerT any] struct {
	// informer client
	informer InformerT
	// informer cancel function
	cancel chan struct{}
}

type RegisterResourceFunc[InformerT any] func(
	informer InformerT,
	resource types.ResourceMeta,
) error

// RunInformerFunc is a function that should run the informer, submitting events to the three
// channels, and blocking until the stop channel is closed.
type RunInformerFunc[InformerT any] func(
	informer InformerT,
	stopCh chan struct{},
	addChan chan types.InformerAddPayload,
	updateChan chan types.InformerUpdatePayload,
	deleteChan chan types.InformerDeletePayload,
) error

func NewInformerManager[ClientT, InformerT any](
	factory InformerFactory[ClientT, InformerT],
	registerHandler RegisterResourceFunc[InformerT],
	runHandler RunInformerFunc[InformerT],
) *InformerManager[ClientT, InformerT] {
	return &InformerManager[ClientT, InformerT]{
		factory:            factory,
		registerHandler:    registerHandler,
		runHandler:         runHandler,
		informers:          make(map[string]informer[InformerT]),
		addChan:            make(chan types.InformerAddPayload),
		updateChan:         make(chan types.InformerUpdatePayload),
		deleteChan:         make(chan types.InformerDeletePayload),
		startNamespaceChan: make(chan string),
		stopNamespaceChan:  make(chan string),
	}
}

// Run starts the informer manager, and blocks until the stop channel is closed.
// Acts as a fan-in aggregator for the various informer channels.
func (i *InformerManager[CT, IT]) Run(
	stopCh <-chan struct{},
	controllerAddChan chan types.InformerAddPayload,
	controllerUpdateChan chan types.InformerUpdatePayload,
	controllerDeleteChan chan types.InformerDeletePayload,
) error {
	for {
		select {
		case <-stopCh:
			return nil
		case id := <-i.startNamespaceChan:
			informer := i.informers[id]
			// TODO - handle this error case at some point
			go i.runHandler(
				informer.informer,
				informer.cancel,
				i.addChan,
				i.updateChan,
				i.deleteChan,
			)
		case id := <-i.stopNamespaceChan:
			// stop the informer
			informer, ok := i.informers[id]
			if !ok {
				// ignore, probobly already stopped
				break
			}
			close(informer.cancel)
		case add := <-i.addChan:
			controllerAddChan <- add
		case update := <-i.updateChan:
			controllerUpdateChan <- update
		case del := <-i.deleteChan:
			controllerDeleteChan <- del
		}
	}
}

func (i *InformerManager[CT, IT]) CreateAuthContextInformer(
	ctx *pkgtypes.PluginContext,
	auth *pkgtypes.AuthContext,
	client *CT,
) error {
	// make sure we don't already have an informer for this namespace
	if _, ok := i.informers[auth.ID]; ok {
		return fmt.Errorf("informer already exists for namespace %s", auth.ID)
	}

	// get an informer from the factory
	cache, err := i.factory.CreateInformer(ctx, auth, client)
	if err != nil {
		return fmt.Errorf("error creating informer for namespace %s: %w", auth.ID, err)
	}

	// add to map
	i.informers[auth.ID] = informer[IT]{informer: cache, cancel: make(chan struct{})}
	return nil
}

// RegisterResource registers a resource with the informer manager for a given client. This is
// called when a new context has been started for the first time.
func (i *InformerManager[CT, IT]) RegisterResource(
	_ *pkgtypes.PluginContext,
	auth *pkgtypes.AuthContext,
	resource types.ResourceMeta,
) error {
	// get the informer
	informer, ok := i.informers[auth.ID]
	if !ok {
		return fmt.Errorf("informer not found for namespace %s", auth.ID)
	}

	// register the resource
	return i.registerHandler(informer.informer, resource)
}

// StartNamespace starts the informer for a given resource namespace, and sends events to the given
// event channels.
func (i *InformerManager[CT, IT]) StartAuthContext(
	_ *pkgtypes.PluginContext,
	authID string,
) error {
	// make sure the informer exists before signalling a start
	_, ok := i.informers[authID]
	if !ok {
		return fmt.Errorf("informer not found for auth context %s", authID)
	}

	i.startNamespaceChan <- authID
	return nil
}

// StopNamespace stops the informer for a given resource namespace.
func (i *InformerManager[CT, IT]) StopAuthContext(
	_ *pkgtypes.PluginContext,
	authID string,
) error {
	// make sure the informer exists before signalling a stop
	_, ok := i.informers[authID]
	if !ok {
		return fmt.Errorf("informer not found for namespace %s", authID)
	}
	i.stopNamespaceChan <- authID
	return nil
}
