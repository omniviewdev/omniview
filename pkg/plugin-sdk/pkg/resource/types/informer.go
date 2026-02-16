package types

import (
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

type InformerAction int

const (
	// InformerTypeAdd is used to inform the IDE that a resource has been created.
	InformerActionAdd InformerAction = iota
	// InformerTypeUpdate is used to inform the IDE that a resource has been updated.
	InformerActionUpdate
	// InformerTypeDelete is used to inform the IDE that a resource has been deleted.
	InformerActionDelete
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

type InformerPayload interface {
	InformerAddPayload | InformerUpdatePayload | InformerDeletePayload
}

// InformerHandle is a non-generic interface that encapsulates an informer instance.
// Implementations manage resource registration and running the informer loop internally.
type InformerHandle interface {
	// RegisterResource registers a resource with the informer, setting up event handlers
	// that push events to the provided channels.
	RegisterResource(
		ctx *pkgtypes.PluginContext,
		resource ResourceMeta,
		addChan chan InformerAddPayload,
		updateChan chan InformerUpdatePayload,
		deleteChan chan InformerDeletePayload,
	) error

	// Run starts the informer and blocks until stopCh is closed.
	Run(
		stopCh chan struct{},
		addChan chan InformerAddPayload,
		updateChan chan InformerUpdatePayload,
		deleteChan chan InformerDeletePayload,
	) error
}

// CreateInformerHandleFunc creates an InformerHandle for a given connection client.
type CreateInformerHandleFunc[ClientT any] func(
	ctx *pkgtypes.PluginContext,
	client *ClientT,
) (InformerHandle, error)
