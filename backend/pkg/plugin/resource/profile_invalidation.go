package resource

import (
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/indexer"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// A profile edit is a configuration reset, not resource identity continuity.
// SDK overlay application has already canceled and drained affected clients.
// These bounded epochs fence responses and queued observations acquired before
// the reset; they are not target handles, query leases, or a live-session API.
func (c *controller) invalidateProfileRoutes(pluginID string, connections []string) error {
	c.pluginsMu.Lock()
	defer c.pluginsMu.Unlock()
	return c.invalidateProfileRoutesLocked(pluginID, connections)
}

// Caller holds pluginsMu across route retirement and its configuration fence.
func (c *controller) invalidateProfileRoutesLocked(pluginID string, connections []string) error {
	return c.invalidateSourceRoutesLocked(pluginID, connections, true)
}

// Native binding changes retire source work, not configured connection metadata.
// Profile changes also remove inventory until their effective snapshot is published.
// Caller holds pluginsMu across retirement and its configuration fence.
func (c *controller) invalidateSourceRoutesLocked(pluginID string, connections []string, removeInventory bool) error {
	generation := c.plugins[pluginID]
	if generation == nil || generation.provider == nil {
		return resourcev2.NewError("UNAVAILABLE", "Provider generation retired during profile apply.")
	}
	newRoutes := 0
	seen := make(map[string]bool, len(connections))
	for _, connection := range connections {
		if connection == "" {
			return resourcev2.NewError("INVALID_REQUEST", "Empty profile route.")
		}
		if seen[connection] {
			continue
		}
		seen[connection] = true
		if _, exists := generation.sourceEpoch[connection]; !exists {
			newRoutes++
		}
	}
	if len(generation.sourceEpoch)+newRoutes > maxAuthorityBindings {
		return resourcev2.NewError("RESOURCE_LIMIT", "Source configuration generation limit reached.")
	}
	// Retire captured work even if a durable authority removal subsequently
	// fails. A partial retirement must never let an old in-flight page publish.
	if generation.sourceEpoch == nil {
		generation.sourceEpoch = make(map[string]uint64)
	}
	for connection := range seen {
		generation.sourceEpoch[connection]++
	}
	c.finite.mu.Lock()
	resolver := c.finite.authorities[pluginID]
	if resolver != nil {
		for connection := range seen {
			if err := resolver.InvalidateConnection(pluginID, connection); err != nil {
				c.finite.mu.Unlock()
				return err
			}
		}
	}
	c.finite.mu.Unlock()
	for connection := range seen {
		for _, entry := range c.registryStore.DeleteByConnection(pluginID, connection) {
			c.dispatcher.Enqueue(indexer.Event{Type: indexer.EventDelete, Entry: entry})
		}
		c.graph.RemoveEdgesForConnection(pluginID, connection)
		c.graph.ClearDeclarationsForConnection(pluginID, resourcev2.AccessRoute{Connection: connection})
		c.subs.RemoveRoute(pluginID, connection)
		if !removeInventory {
			continue
		}
		c.connsMu.Lock()
		cached := c.connections[pluginID]
		for i := range cached {
			if cached[i].ID == connection {
				cached = append(cached[:i], cached[i+1:]...)
				break
			}
		}
		c.connections[pluginID] = cached
		c.connsMu.Unlock()
	}
	return nil
}

// Caller holds pluginsMu.RLock across its final mutation/delivery fence.
// This read never issues authority, performs provider IO, or normalizes identity.
func (c *controller) referenceCurrentLocked(pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) bool {
	generation := c.plugins[pluginID]
	if generation == nil || generation.sourceChanging[route.Connection] {
		return false
	}
	c.finite.mu.Lock()
	defer c.finite.mu.Unlock()
	resolver := c.finite.authorities[pluginID]
	return resolver != nil && resolver.Matches(pluginID, route.Connection, reference.Address.Provider, reference.Address.Type, reference.Address.Authority)
}
