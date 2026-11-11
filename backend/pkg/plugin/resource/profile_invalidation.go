package resource

import (
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
// Profile changes also remove configured connection metadata until the effective
// snapshot is published. Optional enrichment changes never enter this path.
// Caller holds pluginsMu across retirement and its configuration fence.
func (c *controller) invalidateSourceRoutesLocked(pluginID string, connections []string, removeConnections bool) error {
	return c.invalidateSourceRoutesWithRecoveryLocked(pluginID, connections, removeConnections, !removeConnections)
}

func (c *controller) invalidateStoppedSourceRoutesLocked(pluginID, connection string) error {
	return c.invalidateSourceRoutesWithRecoveryLocked(pluginID, []string{connection}, false, false)
}

func (c *controller) invalidateSourceRoutesWithRecoveryLocked(pluginID string, connections []string, removeConnections, recoverBinding bool) error {
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
	if removeConnections && generation.connectionLifecycleEpoch == nil {
		generation.connectionLifecycleEpoch = make(map[string]uint64)
	}
	for connection := range seen {
		generation.sourceEpoch[connection]++
		c.schemas.DropConnection(pluginID, connection)
		if removeConnections {
			generation.connectionLifecycleEpoch[connection]++
		}
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
		if recoverBinding {
			go c.sources.recoverBinding(pluginID, connection, generation, generation.sourceEpoch[connection])
		} else {
			go c.sources.invalidate(pluginID, connection)
		}
		if !removeConnections {
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
