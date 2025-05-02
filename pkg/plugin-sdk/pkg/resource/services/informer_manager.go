package services

import (
	"fmt"
	"log"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

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
	createHandler   types.CreateInformerFunc[ClientT, InformerT]
	registerHandler types.RegisterResourceInformerFunc[InformerT]
	runHandler      types.RunInformerFunc[InformerT]

	// map of connection ids to informers
	informers map[string]informer[InformerT]

	addChan             chan types.InformerAddPayload
	updateChan          chan types.InformerUpdatePayload
	deleteChan          chan types.InformerDeletePayload
	startConnectionChan chan string
	stopConnectionChan  chan string
}

type informer[InformerT any] struct {
	// informer client
	informer InformerT
	// informer cancel function
	cancel chan struct{}
}

func NewInformerManager[ClientT, InformerT any](
	opts *types.InformerOptions[ClientT, InformerT],
	addChan chan types.InformerAddPayload,
	updateChan chan types.InformerUpdatePayload,
	deleteChan chan types.InformerDeletePayload,
) *InformerManager[ClientT, InformerT] {
	return &InformerManager[ClientT, InformerT]{
		createHandler:       opts.CreateInformerFunc,
		registerHandler:     opts.RegisterResourceFunc,
		runHandler:          opts.RunInformerFunc,
		informers:           make(map[string]informer[InformerT]),
		addChan:             addChan,
		updateChan:          updateChan,
		deleteChan:          deleteChan,
		startConnectionChan: make(chan string),
		stopConnectionChan:  make(chan string),
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
		case id := <-i.startConnectionChan:
			log.Println("InformerManager: start event received", id)
			informer := i.informers[id]
			// TODO - handle this error case at some point
			go i.runHandler(
				informer.informer,
				informer.cancel,
				i.addChan,
				i.updateChan,
				i.deleteChan,
			)
		case id := <-i.stopConnectionChan:
			log.Println("InformerManager: stop event received", id)
			// stop the informer
			informer, ok := i.informers[id]
			if !ok {
				// ignore, probobly already stopped
				break
			}
			// close the connection and delete it
			close(informer.cancel)
			delete(i.informers, id)
		case event := <-i.addChan:
			log.Println("recieved add event", event)
			controllerAddChan <- event
		case event := <-i.updateChan:
			log.Println("recieved update event", event)
			controllerUpdateChan <- event
		case event := <-i.deleteChan:
			log.Println("recieved delete event", event)
			controllerDeleteChan <- event
		}
	}
}

func (i *InformerManager[CT, IT]) CreateConnectionInformer(
	ctx *pkgtypes.PluginContext,
	connection *pkgtypes.Connection,
	client *CT,
) error {
	// make sure we don't already have an informer for this connection
	if _, ok := i.informers[connection.ID]; ok {
		return fmt.Errorf("informer already exists for connection %s", connection.ID)
	}

	// get an informer from the factory
	cache, err := i.createHandler(ctx, client)
	if err != nil {
		return fmt.Errorf("error creating informer for connection %s: %w", connection.ID, err)
	}

	// add to map
	i.informers[connection.ID] = informer[IT]{informer: cache, cancel: make(chan struct{})}
	return nil
}

// RegisterResource registers a resource with the informer manager for a given client. This is
// called when a new context has been started for the first time.
func (i *InformerManager[CT, IT]) RegisterResource(
	ctx *pkgtypes.PluginContext,
	connection *pkgtypes.Connection,
	resource types.ResourceMeta,
) error {
	// get the informer
	informer, ok := i.informers[connection.ID]
	if !ok {
		return fmt.Errorf("informer not found for connection %s", connection.ID)
	}

	// register the resource
	return i.registerHandler(
		ctx,
		resource,
		informer.informer,
		i.addChan,
		i.updateChan,
		i.deleteChan,
	)
}

// StartConnection starts the informer for a given resource connection, and sends events to the given
// event channels.
func (i *InformerManager[CT, IT]) StartConnection(
	_ *pkgtypes.PluginContext,
	connectionID string,
) error {
	// make sure the informer exists before signalling a start
	_, ok := i.informers[connectionID]
	if !ok {
		return fmt.Errorf("informer does not exist for connection %s", connectionID)
	}

	i.startConnectionChan <- connectionID
	return nil
}

// StopConnection stops the informer for a given resource connection.
func (i *InformerManager[CT, IT]) StopConnection(
	_ *pkgtypes.PluginContext,
	connectionID string,
) error {
	// make sure the informer exists before signalling a stop
	_, ok := i.informers[connectionID]
	if !ok {
		return fmt.Errorf("informer not found for connection %s", connectionID)
	}
	i.stopConnectionChan <- connectionID
	return nil
}

// HasInformer checks to see if the informer manager has an informer for the given connection.
func (i *InformerManager[CT, IT]) HasInformer(
	_ *pkgtypes.PluginContext,
	connectionID string,
) bool {
	_, ok := i.informers[connectionID]
	return ok
}
