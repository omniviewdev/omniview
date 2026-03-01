package resource

import (
	"encoding/gob"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/utils"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const storeName = "connections"

// mergeConnections deduplicates connections by ID, newer entries win.
func mergeConnections(existing, incoming []types.Connection) []types.Connection {
	merged := make(map[string]types.Connection, len(existing)+len(incoming))
	for _, c := range existing {
		merged[c.ID] = c
	}
	for _, c := range incoming {
		merged[c.ID] = c
	}
	result := make([]types.Connection, 0, len(merged))
	for _, c := range merged {
		result = append(result, c)
	}
	return result
}

// saveToLocalStore persists the controller's connection map to a GOB file.
func saveToLocalStore(pluginID string, connections map[string][]types.Connection) error {
	gob.Register(map[string]interface{}{})
	store, err := utils.GetStore(storeName, pluginID)
	if err != nil {
		return err
	}
	defer store.Close()

	return gob.NewEncoder(store).Encode(connections)
}

// loadFromLocalStore reads the connection map from a GOB file.
// Resets LastRefresh on loaded connections (we're not actually connected yet).
func loadFromLocalStore(pluginID string) (map[string][]types.Connection, error) {
	gob.Register(map[string]interface{}{})
	store, err := utils.GetStore(storeName, pluginID)
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
	if err := gob.NewDecoder(store).Decode(&state); err != nil {
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
func removeLocalStore(pluginID string) error {
	return utils.RemoveStore(storeName, pluginID)
}
