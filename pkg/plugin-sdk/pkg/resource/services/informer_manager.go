package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// InformerManager manages informer handles for all connections. It tracks
// per-resource state, enforces sync policies, and fans in events to the
// controller's channels.
type InformerManager[ClientT any] struct {
	createHandler types.CreateInformerHandleFunc[ClientT]
	syncPolicies  map[string]types.InformerSyncPolicy

	mu        sync.RWMutex
	informers map[string]*informerEntry

	addChan    chan types.InformerAddPayload
	updateChan chan types.InformerUpdatePayload
	deleteChan chan types.InformerDeletePayload
	stateChan  chan types.InformerStateEvent

	startConnectionChan chan string
	stopConnectionChan  chan string
}

type informerEntry struct {
	handle   types.InformerHandle
	ctx      context.Context
	cancel   context.CancelFunc
	stopCh   chan struct{}
	states   map[string]types.InformerResourceState
	counts   map[string]int
	policies map[string]types.InformerSyncPolicy
}

func NewInformerManager[ClientT any](
	createFunc types.CreateInformerHandleFunc[ClientT],
	syncPolicies map[string]types.InformerSyncPolicy,
	addChan chan types.InformerAddPayload,
	updateChan chan types.InformerUpdatePayload,
	deleteChan chan types.InformerDeletePayload,
	stateChan chan types.InformerStateEvent,
) *InformerManager[ClientT] {
	if syncPolicies == nil {
		syncPolicies = make(map[string]types.InformerSyncPolicy)
	}
	return &InformerManager[ClientT]{
		createHandler:       createFunc,
		syncPolicies:        syncPolicies,
		informers:           make(map[string]*informerEntry),
		addChan:             addChan,
		updateChan:          updateChan,
		deleteChan:          deleteChan,
		stateChan:           stateChan,
		startConnectionChan: make(chan string),
		stopConnectionChan:  make(chan string),
	}
}

// Run starts the informer manager event loop. It fans in add/update/delete/state
// events from all connections to the controller's channels.
func (i *InformerManager[ClientT]) Run(
	stopCh <-chan struct{},
	controllerAddChan chan types.InformerAddPayload,
	controllerUpdateChan chan types.InformerUpdatePayload,
	controllerDeleteChan chan types.InformerDeletePayload,
	controllerStateChan chan types.InformerStateEvent,
) error {
	for {
		select {
		case <-stopCh:
			return nil
		case id := <-i.startConnectionChan:
			log.Println("InformerManager: start event received", id)
			i.mu.RLock()
			entry, ok := i.informers[id]
			i.mu.RUnlock()
			if !ok {
				log.Printf("InformerManager: no entry for connection %s", id)
				break
			}
			go func(id string) {
				if err := entry.handle.Start(
					entry.ctx,
					entry.stopCh,
					i.stateChan,
				); err != nil {
					log.Printf("InformerManager: error running informer for connection %s: %v", id, err)
				}
			}(id)
		case id := <-i.stopConnectionChan:
			log.Println("InformerManager: stop event received", id)
			i.mu.Lock()
			entry, ok := i.informers[id]
			if !ok {
				i.mu.Unlock()
				break
			}
			// Collect cancelled events before cleanup. We must NOT send to
			// i.stateChan while holding the lock (same goroutine reads it).
			events := make([]types.InformerStateEvent, 0, len(entry.states))
			for key := range entry.states {
				events = append(events, types.InformerStateEvent{
					Connection:  id,
					ResourceKey: key,
					State:       types.InformerStateCancelled,
				})
			}
			// Stop the handle (which closes stopCh) and cancel the context.
			entry.handle.Stop()
			entry.cancel()
			delete(i.informers, id)
			i.mu.Unlock()
			// Emit cancelled events directly to the controller, bypassing
			// i.stateChan to avoid blocking in the same select loop.
			for _, event := range events {
				controllerStateChan <- event
			}
		case event := <-i.addChan:
			controllerAddChan <- event
		case event := <-i.updateChan:
			controllerUpdateChan <- event
		case event := <-i.deleteChan:
			controllerDeleteChan <- event
		case event := <-i.stateChan:
			// update local state tracking
			i.mu.Lock()
			if entry, ok := i.informers[event.Connection]; ok {
				entry.states[event.ResourceKey] = event.State
				entry.counts[event.ResourceKey] = event.ResourceCount
			}
			i.mu.Unlock()
			controllerStateChan <- event
		}
	}
}

// CreateConnectionInformer creates a new informer handle for a connection.
func (i *InformerManager[ClientT]) CreateConnectionInformer(
	ctx *pkgtypes.PluginContext,
	connection *pkgtypes.Connection,
	client *ClientT,
) error {
	i.mu.Lock()
	defer i.mu.Unlock()

	if _, ok := i.informers[connection.ID]; ok {
		return fmt.Errorf("informer already exists for connection %s", connection.ID)
	}

	handle, err := i.createHandler(ctx, client)
	if err != nil {
		return fmt.Errorf("error creating informer for connection %s: %w", connection.ID, err)
	}

	entryCtx, cancel := context.WithCancel(context.Background())

	i.informers[connection.ID] = &informerEntry{
		handle:   handle,
		ctx:      entryCtx,
		cancel:   cancel,
		stopCh:   make(chan struct{}),
		states:   make(map[string]types.InformerResourceState),
		counts:   make(map[string]int),
		policies: make(map[string]types.InformerSyncPolicy),
	}
	return nil
}

// RegisterResource registers a resource with the informer for a given connection.
func (i *InformerManager[ClientT]) RegisterResource(
	ctx *pkgtypes.PluginContext,
	connection *pkgtypes.Connection,
	resource types.ResourceMeta,
	syncPolicy types.InformerSyncPolicy,
) error {
	i.mu.Lock()
	entry, ok := i.informers[connection.ID]
	if !ok {
		i.mu.Unlock()
		return fmt.Errorf("informer not found for connection %s", connection.ID)
	}

	key := resource.String()
	entry.states[key] = types.InformerStatePending
	entry.policies[key] = syncPolicy
	i.mu.Unlock()

	err := entry.handle.RegisterResource(
		ctx,
		resource,
		syncPolicy,
		i.addChan,
		i.updateChan,
		i.deleteChan,
	)
	if errors.Is(err, types.ErrResourceSkipped) {
		// Resource was intentionally skipped by the plugin (e.g. ephemeral
		// request-based resources, CRDs not in static map). Mark as Cancelled
		// so the UI knows it won't sync rather than leaving it stuck in Pending.
		i.mu.Lock()
		entry.states[key] = types.InformerStateCancelled
		delete(entry.policies, key)
		i.mu.Unlock()

		i.stateChan <- types.InformerStateEvent{
			Connection:  connection.ID,
			ResourceKey: key,
			State:       types.InformerStateCancelled,
		}
		return nil // not a real error
	}

	if err != nil {
		// Any other registration error: mark as Error so the resource doesn't
		// stay stuck in Pending forever.
		i.mu.Lock()
		entry.states[key] = types.InformerStateError
		delete(entry.policies, key)
		i.mu.Unlock()

		i.stateChan <- types.InformerStateEvent{
			Connection:  connection.ID,
			ResourceKey: key,
			State:       types.InformerStateError,
			Error: &types.ResourceOperationError{
				Code:    "REGISTER_FAILED",
				Title:   "Informer registration failed",
				Message: err.Error(),
			},
		}
		return nil // error is communicated via state event
	}
	return nil
}

// StartConnection signals the informer to start for a given connection.
func (i *InformerManager[ClientT]) StartConnection(
	_ *pkgtypes.PluginContext,
	connectionID string,
) error {
	i.mu.RLock()
	_, ok := i.informers[connectionID]
	i.mu.RUnlock()
	if !ok {
		return fmt.Errorf("informer does not exist for connection %s", connectionID)
	}

	i.startConnectionChan <- connectionID
	return nil
}

// StopConnection stops the informer for a given connection.
func (i *InformerManager[ClientT]) StopConnection(
	_ *pkgtypes.PluginContext,
	connectionID string,
) error {
	i.mu.RLock()
	_, ok := i.informers[connectionID]
	i.mu.RUnlock()
	if !ok {
		return fmt.Errorf("informer not found for connection %s", connectionID)
	}

	i.stopConnectionChan <- connectionID
	return nil
}

// HasInformer checks if there's an informer for the given connection.
func (i *InformerManager[ClientT]) HasInformer(
	_ *pkgtypes.PluginContext,
	connectionID string,
) bool {
	i.mu.RLock()
	defer i.mu.RUnlock()
	_, ok := i.informers[connectionID]
	return ok
}

// EnsureResource starts the informer for a specific resource if it has
// SyncOnFirstQuery policy and is still in Pending state.
func (i *InformerManager[ClientT]) EnsureResource(
	connectionID string,
	resourceKey string,
) error {
	i.mu.RLock()
	entry, ok := i.informers[connectionID]
	if !ok {
		i.mu.RUnlock()
		return nil // no informer, nothing to do
	}

	state := entry.states[resourceKey]
	policy := entry.policies[resourceKey]
	i.mu.RUnlock()

	if policy != types.SyncOnFirstQuery || state != types.InformerStatePending {
		return nil
	}

	meta := types.ResourceMetaFromString(resourceKey)
	return entry.handle.StartResource(
		entry.ctx,
		meta,
		i.stateChan,
	)
}

// GetConnectionState returns a snapshot of all resource informer states for a connection.
func (i *InformerManager[ClientT]) GetConnectionState(
	connectionID string,
) (*types.InformerConnectionSummary, error) {
	i.mu.RLock()
	defer i.mu.RUnlock()

	entry, ok := i.informers[connectionID]
	if !ok {
		return nil, fmt.Errorf("informer not found for connection %s", connectionID)
	}

	summary := &types.InformerConnectionSummary{
		Connection:     connectionID,
		Resources:      make(map[string]types.InformerResourceState, len(entry.states)),
		ResourceCounts: make(map[string]int, len(entry.counts)),
		TotalResources: len(entry.states),
	}

	for key, state := range entry.states {
		summary.Resources[key] = state
		summary.ResourceCounts[key] = entry.counts[key]
		switch state {
		case types.InformerStateSynced:
			summary.SyncedCount++
		case types.InformerStateError:
			summary.ErrorCount++
		}
	}

	return summary, nil
}
