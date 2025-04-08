package services

import (
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/factories"
	rt "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ConnectionManager is an interface that resource managers must implement in order to manage
// the various authenticated targets that a resource plugin can talk to.
//
// For example, a user may have multiple AWS accounts and roles they would like to incorporate
// into the IDE. However, each account (and role) has it's own authorizations, and must used different
// credentials to access. As such, the user would like to separate these backends into different
// connections, so that they can easily switch between them. For this example, a connection
// would consist of the account and role, and the resource auth manager would be responsible for
// setting up, switching between, and managing these authd clients.
type ConnectionManager[ClientT any] interface {
	rt.ResourceConnectionProvider

	// InjectConnection injects the connection by id into the plugin context
	InjectConnection(ctx *types.PluginContext, id string) error

	// CheckConnection checks the status of a connection
	CheckConnection(
		ctx *types.PluginContext,
		conn *types.Connection,
		client *ClientT,
	) (types.ConnectionStatus, error)

	// GetConnectionClient returns the necessary client for the given auth
	// This method should be used by resourcers to get the client for the given
	// auth.
	GetConnectionClient(ctx *types.PluginContext, id string) (*ClientT, error)

	// RefreshConnectionClient performs any actions necessary to refresh a client for the given auth.
	// This may include refreshing credentials, or re-initializing the client if it has been
	// invalidated.
	RefreshConnectionClient(ctx *types.PluginContext, id string) error

	// GetCurrentConnectionClient returns the current client for the given auth
	GetCurrentConnectionClient(ctx *types.PluginContext) (*ClientT, error)

	// RefreshCurrentConnectionClient performs any actions necessary to refresh the current client for the given auth.
	RefreshCurrentConnectionClient(ctx *types.PluginContext) error

	// GetConnectionNamespaces returns the namespaces for the given connection, if any. If the connection does not support
	// namespaces, it will return an empty slice.
	GetConnectionNamespaces(ctx *types.PluginContext, id string) ([]string, error)
}

// NewConnectionManager creates a new service to manage the various auth contexts for a
// plugin with an authenticated backend.
func NewConnectionManager[ClientT any](
	factory factories.ResourceClientFactory[ClientT],
	loader func(*types.PluginContext) ([]types.Connection, error),
	checker func(*types.PluginContext, *types.Connection, *ClientT) (types.ConnectionStatus, error),
	namespaceLoader func(*types.PluginContext, *ClientT) ([]string, error),
) ConnectionManager[ClientT] {
	return &connectionManager[ClientT]{
		factory:         factory,
		loader:          loader,
		namespaceLoader: namespaceLoader,
		checker:         checker,
		connections:     make(map[string]types.Connection),
		clients:         make(map[string]*ClientT),
	}
}

type connectionManager[ClientT any] struct {
	factory         factories.ResourceClientFactory[ClientT]
	loader          func(*types.PluginContext) ([]types.Connection, error)
	namespaceLoader func(*types.PluginContext, *ClientT) ([]string, error)
	checker         func(*types.PluginContext, *types.Connection, *ClientT) (types.ConnectionStatus, error)
	connections     map[string]types.Connection
	clients         map[string]*ClientT
	sync.RWMutex
}

func (r *connectionManager[ClientT]) InjectConnection(
	ctx *types.PluginContext,
	id string,
) error {
	r.RLock()
	defer r.RUnlock()

	auth, ok := r.connections[id]
	if !ok {
		return fmt.Errorf("auth %s does not exist", id)
	}
	ctx.Connection = &auth
	return nil
}

func (r *connectionManager[ClientT]) CheckConnection(
	ctx *types.PluginContext,
	conn *types.Connection,
	client *ClientT,
) (types.ConnectionStatus, error) {
	if r.checker == nil {
		return types.ConnectionStatus{
			Status:     types.ConnectionStatusUnknown,
			Connection: conn,
			Error:      "No connection checker has been set",
			Details:    "No connection checker has been set",
		}, nil
	}
	return r.checker(ctx, conn, client)
}

func (r *connectionManager[ClientT]) LoadConnections(
	ctx *types.PluginContext,
) ([]types.Connection, error) {
	if r.loader == nil {
		// If hasn't been specified, just return nothing
		return nil, nil
	}

	connections, err := r.loader(ctx)
	if err != nil {
		return nil, err
	}

	// if we have existing connections, we need to merge the new ones in
	for _, conn := range connections {
		if conn.ID == "" {
			continue
		}
		existing, ok := r.connections[conn.ID]
		if !ok {
			r.connections[conn.ID] = conn
			continue
		}

		// we have an existing connection, merge in the data and labels
		for k, v := range conn.Data {
			if _, ok = existing.Data[k]; !ok {
				existing.Data[k] = v
			}
		}
		for k, v := range conn.Labels {
			if _, ok = existing.Labels[k]; !ok {
				existing.Labels[k] = v
			}
		}
	}

	// create the clients
	for _, conn := range connections {
		if _, ok := r.clients[conn.ID]; !ok {
			ctx.Connection = &conn
			client, clienterr := r.factory.CreateClient(ctx)
			if clienterr == nil {
				r.clients[conn.ID] = client
			}
		}
	}

	upserted := make([]types.Connection, 0, len(r.connections))
	for _, auth := range r.connections {
		upserted = append(upserted, auth)
	}

	slices.SortFunc(upserted, func(i, j types.Connection) int {
		switch {
		case i.ID == j.ID:
			return 0
		case i.ID > j.ID:
			return 1
		default:
			return -1
		}
	})

	return upserted, nil
}

func (r *connectionManager[ClientT]) ListConnections(
	_ *types.PluginContext,
) ([]types.Connection, error) {
	r.RLock()
	defer r.RUnlock()
	connections := make([]types.Connection, 0, len(r.connections))
	for _, auth := range r.connections {
		connections = append(connections, auth)
	}

	slices.SortFunc(connections, func(i, j types.Connection) int {
		switch {
		case i.ID == j.ID:
			return 0
		case i.ID > j.ID:
			return 1
		default:
			return -1
		}
	})

	return connections, nil
}

func (r *connectionManager[ClientT]) GetConnection(
	_ *types.PluginContext,
	id string,
) (types.Connection, error) {
	r.RLock()
	defer r.RUnlock()
	auth, ok := r.connections[id]
	if !ok {
		return types.Connection{}, fmt.Errorf("auth %s does not exist", id)
	}
	return auth, nil
}

func (r *connectionManager[ClientT]) UpdateConnection(
	_ *types.PluginContext,
	conn types.Connection,
) (types.Connection, error) {
	r.Lock()
	defer r.Unlock()
	current, ok := r.connections[conn.ID]
	if !ok {
		return types.Connection{}, fmt.Errorf("connection %s does not exist", conn.ID)
	}
	if conn.Name != "" {
		current.Name = conn.Name
	}
	if conn.Description != "" {
		current.Description = conn.Description
	}
	if conn.Avatar != "" {
		current.Avatar = conn.Avatar
	}
	if len(conn.Labels) > 0 {
		for k, v := range conn.Labels {
			current.Labels[k] = v
		}
	}
	if len(conn.Data) > 0 {
		for k, v := range conn.Data {
			current.Data[k] = v
		}
	}

	r.connections[conn.ID] = current
	return current, nil
}

func (r *connectionManager[ClientT]) DeleteConnection(
	ctx *types.PluginContext,
	id string,
) error {
	r.Lock()
	defer r.Unlock()
	client, ok := r.clients[id]
	if ok && client != nil {
		delete(r.clients, id)
		if err := r.factory.StopClient(ctx, client); err != nil {
			return err
		}
	}
	delete(r.connections, id)
	return nil
}

func (r *connectionManager[ClientT]) CreateConnection(
	ctx *types.PluginContext,
	auth types.Connection,
) error {
	r.Lock()
	defer r.Unlock()

	_, hasClient := r.clients[auth.ID]
	_, hasAuthorization := r.connections[auth.ID]

	if hasClient || hasAuthorization {
		return fmt.Errorf("auth %s already exists", auth.ID)
	}

	client, err := r.factory.CreateClient(ctx)
	if err != nil {
		return err
	}

	r.clients[auth.ID] = client
	r.connections[auth.ID] = auth

	return nil
}

func (r *connectionManager[ClientT]) GetConnectionClient(
	_ *types.PluginContext,
	id string,
) (*ClientT, error) {
	r.RLock()
	defer r.RUnlock()
	client, ok := r.clients[id]

	if !ok {
		return nil, fmt.Errorf("client for auth context %s does not exist", id)
	}

	return client, nil
}

func (r *connectionManager[ClientT]) RefreshConnectionClient(
	ctx *types.PluginContext,
	id string,
) error {
	r.RLock()
	defer r.RUnlock()

	client, clientOk := r.clients[id]
	_, connOk := r.connections[id]

	if !clientOk {
		return fmt.Errorf("client for connection %s does not exist", id)
	}
	if !connOk {
		return fmt.Errorf("connection %s does not exist", id)
	}

	if err := r.factory.RefreshClient(ctx, client); err != nil {
		return err
	}

	r.clients[id] = client
	return nil
}

func (r *connectionManager[ClientT]) GetCurrentConnectionClient(
	ctx *types.PluginContext,
) (*ClientT, error) {
	r.RLock()
	defer r.RUnlock()

	if ctx.Connection == nil {
		return nil, errors.New("connection is nil")
	}

	client, ok := r.clients[ctx.Connection.ID]

	if !ok {
		return nil, fmt.Errorf("client for auth context %s does not exist", ctx.Connection.ID)
	}

	return client, nil
}

func (r *connectionManager[ClientT]) RefreshCurrentConnectionClient(
	ctx *types.PluginContext,
) error {
	r.RLock()
	defer r.RUnlock()
	if ctx.Connection == nil {
		return errors.New("connection is nil")
	}
	client, clientOk := r.clients[ctx.Connection.ID]
	_, connOk := r.connections[ctx.Connection.ID]

	if !clientOk {
		return fmt.Errorf("client for connection %s does not exist", ctx.Connection.ID)
	}
	if !connOk {
		return fmt.Errorf("connection %s does not exist", ctx.Connection.ID)
	}

	if err := r.factory.RefreshClient(ctx, client); err != nil {
		return err
	}
	r.clients[ctx.Connection.ID] = client
	return nil
}

func (r *connectionManager[ClientT]) StartConnection(
	ctx *types.PluginContext,
	connectionID string,
) (types.ConnectionStatus, error) {
	r.Lock()
	defer r.Unlock()
	client, ok := r.clients[connectionID]
	if !ok {
		return types.ConnectionStatus{
			Status:     types.ConnectionStatusFailed,
			Connection: &types.Connection{},
			Error:      fmt.Sprintf("client for connection %s does not exist", connectionID),
			Details:    fmt.Sprintf("Client for connection %s does not exist", connectionID),
		}, nil
	}

	if err := r.factory.StartClient(ctx, client); err != nil {
		return types.ConnectionStatus{
			Status:     types.ConnectionStatusFailed,
			Connection: &types.Connection{},
			Error:      err.Error(),
			Details:    fmt.Sprintf("Failed to start client for connection %s", connectionID),
		}, nil
	}

	// get the connection and run the check to make sure we can in fact connect
	conn, ok := r.connections[connectionID]
	if !ok {
		return types.ConnectionStatus{
			Status:     types.ConnectionStatusFailed,
			Connection: &types.Connection{},
			Error:      fmt.Sprintf("client for connection %s does not exist", connectionID),
			Details:    fmt.Sprintf("Client for connection %s does not exist", connectionID),
		}, nil
	}

	status, err := r.CheckConnection(ctx, &conn, client)
	if err != nil {
		return status, err
	}
	if status.Status != types.ConnectionStatusConnected {
		return status, nil
	}

	// default to 24 hours
	conn.LastRefresh = time.Now()
	conn.ExpiryTime = time.Hour * 24

	r.connections[connectionID] = conn

	return status, nil
}

func (r *connectionManager[ClientT]) StopConnection(
	ctx *types.PluginContext,
	connectionID string,
) (types.Connection, error) {
	r.Lock()
	defer r.Unlock()
	client, ok := r.clients[connectionID]
	if !ok {
		return types.Connection{}, fmt.Errorf(
			"client for connection %s does not exist",
			connectionID,
		)
	}
	if err := r.factory.StopClient(ctx, client); err != nil {
		return types.Connection{}, err
	}
	conn, ok := r.connections[connectionID]
	if !ok {
		return types.Connection{}, fmt.Errorf("connection %s does not exist", connectionID)
	}
	conn.LastRefresh = time.Time{}
	conn.ExpiryTime = 0
	r.connections[connectionID] = conn

	return conn, nil
}

func (r *connectionManager[ClientT]) GetConnectionNamespaces(
	ctx *types.PluginContext,
	id string,
) ([]string, error) {
	if r.namespaceLoader == nil {
		return nil, nil
	}
	// Get the client
	client, err := r.GetConnectionClient(ctx, id)
	if err != nil {
		return nil, err
	}

	return r.namespaceLoader(ctx, client)
}
