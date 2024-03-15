package plugin

import (
	"context"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Module is the required interface that all plugin modules must implement in order
// to register with the plugin manager.
type Module interface {
	// OnPluginInit is called after the plugin is loaded in to do any pre-startup initialization.
	OnPluginInit() error

	// OnPluginStart is called when the plugin is started.
	OnPluginStart() error

	// OnPluginStop is called when the plugin is stopped. Modules should perform any persisting of state here
	OnPluginStop() error

	// OnPluginDestroy is called when the plugin is destroyed. Modules should perform any cleanup here
	OnPluginDestroy() error
}

// ConnectedModule is the required interface that all plugin modules that have connections
// to backend resources must implement in order to register with the plugin manager.
type ConnectedModule interface {
	Module

	// OnConnectionInit is called when a new connection is created (but not started).
	OnConnectionCreate(context.Context, *types.Connection) error

	// OnConnectionStart is called when the connection is started.
	OnConnectionStart(context.Context, *types.Connection) error

	// OnConnectionStop is called when the connection is stopped.
	OnConnectionStop(context.Context, *types.Connection) error

	// OnConnectionDestroy is called when the connection is destroyed.
	OnConnectionDestroy(context.Context, *types.Connection) error
}
