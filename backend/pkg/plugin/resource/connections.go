package resource

import (
	"encoding/gob"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/utils"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const storeName = "connections"

// upsertEffectiveConnectionStatus accepts only configuration returned by an
// acknowledged source lifecycle operation, never persisted cache entries.
// Full inventory snapshots must replace the inventory instead.
func upsertEffectiveConnectionStatus(existing []types.Connection, current types.Connection) []types.Connection {
	for i := range existing {
		if existing[i].ID == current.ID {
			existing[i] = current
			return existing
		}
	}
	return append(existing, current)
}

// saveToLocalStore writes the legacy mixed cache for migration fixtures.
func saveToLocalStore(storeRoot *appstate.ScopedRoot, connections map[string][]types.Connection) error {
	gob.Register(map[string]interface{}{})
	store, err := utils.GetStore(storeName, storeRoot)
	if err != nil {
		return err
	}
	defer store.Close()

	return gob.NewEncoder(store).Encode(connections)
}

// loadFromLocalStore reads the connection map from a GOB file.
// Resets LastRefresh on loaded connections (we're not actually connected yet).
func loadFromLocalStore(storeRoot *appstate.ScopedRoot) (map[string][]types.Connection, error) {
	gob.Register(map[string]interface{}{})
	store, err := utils.GetStore(storeName, storeRoot)
	if err != nil {
		return nil, err
	}
	defer store.Close()

	info, err := store.Stat()
	if err != nil {
		return nil, err
	}

	if info.Size() == 0 {
		return make(map[string][]types.Connection), nil
	}

	var state map[string][]types.Connection
	if err = gob.NewDecoder(store).Decode(&state); err != nil {
		return nil, err
	}

	// Reset connection timestamps — we're not connected on startup.
	for id, conns := range state {
		for i := range conns {
			conns[i].LastRefresh = time.Time{}
		}
		state[id] = conns
	}

	return state, nil
}

// removeLocalStore deletes the GOB file for a plugin.
func removeLocalStore(storeRoot *appstate.ScopedRoot) error {
	return utils.RemoveStore(storeName, storeRoot)
}
