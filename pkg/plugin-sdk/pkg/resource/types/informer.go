package types

import (
	"context"

	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

type InformerAddPayload struct {
	Data       map[string]interface{} `json:"data"`
	PluginID   string                 `json:"pluginId"`
	Key        string                 `json:"key"`
	Connection string                 `json:"connection"`
	ID         string                 `json:"id"`
	Namespace  string                 `json:"namespace"`
}

type InformerUpdatePayload struct {
	OldData    map[string]interface{} `json:"oldData"`
	NewData    map[string]interface{} `json:"newData"`
	PluginID   string                 `json:"pluginId"`
	Key        string                 `json:"key"`
	Connection string                 `json:"connection"`
	ID         string                 `json:"id"`
	Namespace  string                 `json:"namespace"`
}

type InformerDeletePayload struct {
	Data       map[string]interface{} `json:"data"`
	PluginID   string                 `json:"pluginId"`
	Key        string                 `json:"key"`
	Connection string                 `json:"connection"`
	ID         string                 `json:"id"`
	Namespace  string                 `json:"namespace"`
}

// InformerHandle is a non-generic interface that encapsulates an informer instance.
// Implementations manage resource registration and running the informer loop internally.
type InformerHandle interface {
	// RegisterResource registers a resource with the informer, setting up event handlers
	// that push events to the provided channels. syncPolicy tells the handle whether
	// this resource should start immediately on Start() or be deferred.
	RegisterResource(
		ctx *pkgtypes.PluginContext,
		resource ResourceMeta,
		syncPolicy InformerSyncPolicy,
		addChan chan InformerAddPayload,
		updateChan chan InformerUpdatePayload,
		deleteChan chan InformerDeletePayload,
	) error

	// Start starts all OnConnect informers. Reports state changes via stateChan.
	// Blocks until stopCh is closed or context is cancelled.
	Start(
		ctx context.Context,
		stopCh chan struct{},
		stateChan chan<- InformerStateEvent,
	) error

	// StartResource starts the informer for a specific resource (used for OnFirstQuery policy).
	StartResource(
		ctx context.Context,
		resource ResourceMeta,
		stateChan chan<- InformerStateEvent,
	) error

	// Stop gracefully stops all informers.
	Stop()
}

// CreateInformerHandleFunc creates an InformerHandle for a given connection client.
type CreateInformerHandleFunc[ClientT any] func(
	ctx *pkgtypes.PluginContext,
	client *ClientT,
) (InformerHandle, error)
