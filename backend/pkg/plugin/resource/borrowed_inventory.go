package resource

import (
	"context"

	v2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// BorrowableConnection is an ID/name-only host observation; it contains no profile.
type BorrowableConnection struct {
	ID      string
	Name    string
	Started bool
}

// BorrowableConnections reads only host-maintained inventory and successful start
// observations. It performs no provider calls and creates no invocation authority.
func (c *controller) BorrowableConnections(pluginID string) []BorrowableConnection {
	c.connsMu.RLock()
	connections := make([]BorrowableConnection, 0, len(c.connections[pluginID]))
	for _, connection := range c.connections[pluginID] {
		connections = append(connections, BorrowableConnection{ID: connection.ID, Name: connection.Name})
	}
	c.connsMu.RUnlock()
	c.pluginsMu.RLock()
	state := c.plugins[pluginID]
	if state != nil && state.provider != nil && state.ctx != nil && state.ctx.Err() == nil {
		for i := range connections {
			id := connections[i].ID
			epoch, registered := state.borrowableStarts[id]
			connections[i].Started = registered && epoch == state.sourceEpoch[id]
		}
	}
	c.pluginsMu.RUnlock()
	return connections
}

// captureBorrowableStart pins the owner and explicit lifecycle epoch before I/O.
// Successful startup may adopt a new catalog binding without a lifecycle reset.
func (c *controller) captureBorrowableStart(pluginID, connection string) (*pluginState, uint64, error) {
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	state := c.plugins[pluginID]
	if state == nil || state.provider == nil || state.ctx == nil || state.ctx.Err() != nil || state.sourceChanging[connection] {
		return nil, 0, v2.NewError("OWNER_UNAVAILABLE", "The connection owner is unavailable.")
	}
	return state, state.connectionLifecycleEpoch[connection], nil
}

func (c *controller) checkBorrowableStart(ctx context.Context, pluginID, connection string, state *pluginState, epoch uint64) error {
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	return c.checkBorrowableStartLocked(ctx, pluginID, connection, state, epoch)
}

func (c *controller) checkBorrowableStartLocked(ctx context.Context, pluginID, connection string, state *pluginState, epoch uint64) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if state == nil || c.plugins[pluginID] != state || state.provider == nil || state.ctx == nil || state.ctx.Err() != nil || state.sourceChanging[connection] || state.connectionLifecycleEpoch[connection] != epoch {
		return v2.NewError("RESET_REQUIRED", "Connection generation changed during startup.")
	}
	return nil
}

func (c *controller) commitBorrowableStart(ctx context.Context, pluginID, connection string, state *pluginState, epoch uint64) error {
	c.pluginsMu.Lock()
	defer c.pluginsMu.Unlock()
	if err := c.checkBorrowableStartLocked(ctx, pluginID, connection, state, epoch); err != nil {
		return err
	}
	if state.borrowableStarts == nil {
		state.borrowableStarts = make(map[string]uint64)
	}
	state.borrowableStarts[connection] = state.sourceEpoch[connection]
	return nil
}
