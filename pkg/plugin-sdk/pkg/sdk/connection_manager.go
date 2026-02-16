package sdk

import (
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ConnectionManager is the interface the plugin must satisfy in order to provide connection information
// back to the IDE.
//
// TODO: figure out how we want to manage creating connections themselves.
type ConnectionManager interface {
	// ListConnections should list all of the connections available from the plugin
	ListConnections(ctx pkgtypes.PluginContext) ([]pkgtypes.Connection, error)

	// GetConnection should take a unique ID and return the connection data for that connection
	GetConnection(ctx pkgtypes.PluginContext, id string) (pkgtypes.Connection, error)

	// UpdateConnections should take a map of change data, with the keys being unique IDs of connetion and the values being new connection
	// data, and return the map of new, full data
	UpdateConnections(
		ctx pkgtypes.PluginContext,
		data map[string]pkgtypes.Connection,
	) (map[string]pkgtypes.Connection, error)

	// DeleteConnections should take an array of connection ID's to delete, and return a map of connection ID to states.
	DeleteConnections(ctx pkgtypes.PluginContext, ids []string) map[string]error

	// SubscribeConnections should stream changes to underlying connection data so that the IDE can respond in real time to changes
	// to connections. This function should initiate any watchers (such as a inotify watcher on credential files) to submit to the passed
	// in channel.
	SubscribeConnections(ctx pkgtypes.PluginContext, reciever chan []ConnectionEvent) error
}

// ConnectionEvent is a change of some kind to a connection. This could be the result of a new credential being added, an existing one updating, or
// possibly getting deleted.
//
// It is recommended that if it is impractical to distinguish events for individual connections (such as a new connection being created not being able to
// be detected), a 'SYNC' event with all of the connections available should be sent to provided a minimum amount of feedback.
type ConnectionEvent struct {
	// Type is the type of change that happened to the connection data
	// TODO: change to enum
	Type string // 'SYNC', 'CREATE', 'DELETE'

	// Data is the series of connection data associated with the update event
	Data []pkgtypes.Connection
}
