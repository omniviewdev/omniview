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
type InformerManager[ClientT any] struct {
	createHandler types.CreateInformerHandleFunc[ClientT]

	// map of connection ids to informers
	informers map[string]informerEntry

	addChan             chan types.InformerAddPayload
	updateChan          chan types.InformerUpdatePayload
	deleteChan          chan types.InformerDeletePayload
	startConnectionChan chan string
	stopConnectionChan  chan string
}

type informerEntry struct {
	// handle is the informer handle
	handle types.InformerHandle
	// cancel channel to stop the informer
	cancel chan struct{}
}

func NewInformerManager[ClientT any](
	createFunc types.CreateInformerHandleFunc[ClientT],
	addChan chan types.InformerAddPayload,
	updateChan chan types.InformerUpdatePayload,
	deleteChan chan types.InformerDeletePayload,
) *InformerManager[ClientT] {
	return &InformerManager[ClientT]{
		createHandler:       createFunc,
		informers:           make(map[string]informerEntry),
		addChan:             addChan,
		updateChan:          updateChan,
		deleteChan:          deleteChan,
		startConnectionChan: make(chan string),
		stopConnectionChan:  make(chan string),
	}
}

// Run starts the informer manager, and blocks until the stop channel is closed.
// Acts as a fan-in aggregator for the various informer channels.
func (i *InformerManager[ClientT]) Run(
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
			entry := i.informers[id]
			go func(id string) {
				if err := entry.handle.Run(
					entry.cancel,
					i.addChan,
					i.updateChan,
					i.deleteChan,
				); err != nil {
					log.Printf("InformerManager: error running informer for connection %s: %v", id, err)
				}
			}(id)
		case id := <-i.stopConnectionChan:
			log.Println("InformerManager: stop event received", id)
			// stop the informer
			entry, ok := i.informers[id]
			if !ok {
				// ignore, probably already stopped
				break
			}
			// close the connection and delete it
			close(entry.cancel)
			delete(i.informers, id)
		case event := <-i.addChan:
			controllerAddChan <- event
		case event := <-i.updateChan:
			controllerUpdateChan <- event
		case event := <-i.deleteChan:
			controllerDeleteChan <- event
		}
	}
}

func (i *InformerManager[ClientT]) CreateConnectionInformer(
	ctx *pkgtypes.PluginContext,
	connection *pkgtypes.Connection,
	client *ClientT,
) error {
	// make sure we don't already have an informer for this connection
	if _, ok := i.informers[connection.ID]; ok {
		return fmt.Errorf("informer already exists for connection %s", connection.ID)
	}

	// get an informer handle from the factory
	handle, err := i.createHandler(ctx, client)
	if err != nil {
		return fmt.Errorf("error creating informer for connection %s: %w", connection.ID, err)
	}

	// add to map
	i.informers[connection.ID] = informerEntry{handle: handle, cancel: make(chan struct{})}
	return nil
}

// RegisterResource registers a resource with the informer manager for a given client. This is
// called when a new context has been started for the first time.
func (i *InformerManager[ClientT]) RegisterResource(
	ctx *pkgtypes.PluginContext,
	connection *pkgtypes.Connection,
	resource types.ResourceMeta,
) error {
	// get the informer
	entry, ok := i.informers[connection.ID]
	if !ok {
		return fmt.Errorf("informer not found for connection %s", connection.ID)
	}

	// register the resource
	return entry.handle.RegisterResource(
		ctx,
		resource,
		i.addChan,
		i.updateChan,
		i.deleteChan,
	)
}

// StartConnection starts the informer for a given resource connection, and sends events to the given
// event channels.
func (i *InformerManager[ClientT]) StartConnection(
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
func (i *InformerManager[ClientT]) StopConnection(
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
func (i *InformerManager[ClientT]) HasInformer(
	_ *pkgtypes.PluginContext,
	connectionID string,
) bool {
	_, ok := i.informers[connectionID]
	return ok
}
