package resource

import (
	"context"
	"reflect"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// SetConnectionChangeHook is native composition only, not a frontend capability.
// Registration occurs before plugin loading. profilesMu also serializes mutation
// transactions so a route cannot be unblocked by an earlier overlapping change.
func (c *controller) SetConnectionChangeHook(begin func(pluginID, connectionID string) func()) {
	c.profilesMu.Lock()
	defer c.profilesMu.Unlock()
	c.connectionChangeHook = begin
}

// Caller holds profilesMu; callbacks must never run under pluginsMu.
func (c *controller) beginMetricConnectionChange(pluginID, connectionID string) func() {
	if c.connectionChangeHook == nil {
		return nil
	}
	return c.connectionChangeHook(pluginID, connectionID)
}

// beginConfigurationChanges blocks acquisition and publication before source
// mutation. Retired epochs/authorities are never restored, including rollback.
// Caller holds profilesMu through the returned release and the whole transaction.
func (c *controller) beginConfigurationChanges(ctx context.Context, pluginID string, generation *pluginState, routes, retire []string) (func(), error) {
	c.pluginsMu.Lock()
	if err := c.currentGenerationLocked(ctx, pluginID, generation); err != nil {
		c.pluginsMu.Unlock()
		return nil, err
	}
	for _, route := range routes {
		if route == "" {
			c.pluginsMu.Unlock()
			return nil, resourcev2.NewError("INVALID_REQUEST", "Connection configuration requires an explicit route.")
		}
	}
	if len(routes) > maxAuthorityBindings {
		c.pluginsMu.Unlock()
		return nil, resourcev2.NewError("RESOURCE_LIMIT", "Connection configuration change limit reached.")
	}
	// A serialized Load may replay its overlay inside the same transaction.
	// Only newly blocked routes belong to this release; inner replay cannot
	// release its caller's fence. profilesMu excludes independent transactions.
	fresh := make([]string, 0, len(routes))
	if len(routes) != 0 && generation.sourceChanging == nil {
		generation.sourceChanging = make(map[string]bool, len(routes))
	}
	for _, route := range routes {
		if !generation.sourceChanging[route] {
			generation.sourceChanging[route] = true
			fresh = append(fresh, route)
		}
	}
	if len(retire) != 0 {
		if err := c.invalidateProfileRoutesLocked(pluginID, retire); err != nil {
			for _, route := range fresh {
				delete(generation.sourceChanging, route)
			}
			c.pluginsMu.Unlock()
			return nil, err
		}
	}
	c.pluginsMu.Unlock()
	if len(fresh) == 0 {
		return nil, nil
	}
	var releases []func()
	if c.connectionChangeHook != nil {
		releases = make([]func(), 0, len(fresh))
		for _, route := range fresh {
			if release := c.beginMetricConnectionChange(pluginID, route); release != nil {
				releases = append(releases, release)
			}
		}
	}
	return func() {
		c.pluginsMu.Lock()
		for _, route := range fresh {
			delete(generation.sourceChanging, route)
		}
		c.pluginsMu.Unlock()
		for i := len(releases) - 1; i >= 0; i-- {
			releases[i]()
		}
	}, nil
}

// Plan the exact effective overlay before native mutation. Display-only edits
// block transient publication but retain authority; endpoint/auth or membership
// changes retire the existing source epoch.
func profileConnectionChanges(current, native []types.Connection, next desiredConnectionState) (routes, retire []string) {
	before := make(map[string]types.Connection, len(current))
	after := make(map[string]types.Connection, len(native)+len(next.Profiles))
	for _, connection := range current {
		before[connection.ID] = connection
	}
	for _, connection := range native {
		after[connection.ID] = connection
	}
	for _, profile := range next.Profiles {
		after[profile.Configuration.ID] = profile.Configuration.connection()
	}
	for _, id := range next.DisabledIDs {
		delete(after, id)
	}
	for id, previous := range before {
		connection, exists := after[id]
		// Host profiles never carry native private data. The SDK alone inherits
		// unavailable private credentials when these public client inputs match.
		publicPrevious, publicNext := profileConfig(previous).connection(), profileConfig(connection).connection()
		if !exists || !resourcev2.SameConnectionClientConfig(publicPrevious, publicNext) {
			routes = append(routes, id)
			retire = append(retire, id)
		} else if !reflect.DeepEqual(profileConfig(previous), profileConfig(connection)) {
			routes = append(routes, id)
		}
	}
	for id := range after {
		if _, exists := before[id]; !exists {
			routes = append(routes, id)
			retire = append(retire, id)
		}
	}
	return routes, retire
}

// Native discovery may mutate existing configurations. Fence every admitted
// route before loading, then retire only meaningful changes while still blocked.
func (c *controller) loadConfiguredConnections(ctx context.Context, pluginID string) (_result []types.Connection, retErr error) {
	c.profilesMu.Lock()
	var generation *pluginState
	var release, addedRelease func()
	defer func() {
		if retErr != nil && generation != nil {
			c.pluginsMu.RLock()
			if c.plugins[pluginID] == generation {
				c.connsMu.Lock()
				c.connections[pluginID] = nil
				c.connsMu.Unlock()
			}
			c.pluginsMu.RUnlock()
		}
		if addedRelease != nil {
			addedRelease()
		}
		if release != nil {
			release()
		}
		c.profilesMu.Unlock()
	}()
	raw, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, resourcev2.AccessRoute{})
	if err != nil {
		return nil, err
	}
	defer cleanup()
	features, err := c.providerFeatures(ctx, pluginID, raw)
	if err != nil {
		return nil, err
	}
	provider, ok := raw.(resourcev2.ConnectionLifecycle)
	if !ok || !features.Has(resourcev2.FeatureConnections) {
		return nil, resourcev2.NewError("UNSUPPORTED", "Connection lifecycle is not supported.")
	}
	c.connsMu.RLock()
	before := make([]types.Connection, len(c.connections[pluginID]))
	for i, connection := range c.connections[pluginID] {
		before[i] = resourcev2.CloneConnection(connection)
	}
	c.connsMu.RUnlock()
	known := make(map[string]bool, len(before))
	for _, connection := range before {
		known[connection.ID] = true
	}
	c.pluginsMu.RLock()
	for route := range generation.catalogBindings {
		known[route] = true
	}
	c.pluginsMu.RUnlock()
	routes := make([]string, 0, len(known))
	for route := range known {
		routes = append(routes, route)
	}
	release, err = c.beginConfigurationChanges(ctx, pluginID, generation, routes, nil)
	if err != nil {
		return nil, err
	}
	loaded, err := provider.LoadConnections(ctx)
	if err != nil {
		return nil, err
	}
	_, retire := profileConnectionChanges(before, loaded, emptyDesiredConnections())
	if len(retire) != 0 {
		if err := c.invalidateProfileRoutes(pluginID, retire); err != nil {
			return nil, err
		}
	}
	// Newly discovered routes had no admitted old source, but may have a cached
	// missing-connection utility result. Clear that result before publication.
	var added []string
	for _, connection := range loaded {
		if !known[connection.ID] {
			known[connection.ID] = true
			added = append(added, connection.ID)
		}
	}
	addedRelease, err = c.beginConfigurationChanges(ctx, pluginID, generation, added, nil)
	if err != nil {
		return nil, err
	}
	effective, err := c.replayConnectionProfilesLocked(ctx, pluginID, loaded)
	if err != nil {
		return nil, err
	}
	if err := c.publishProfileConnections(ctx, pluginID, generation, c.profileNative[pluginID], effective); err != nil {
		return nil, err
	}
	return effective, nil
}

// Caller holds profilesMu; generation and publication share the lifecycle fence.
func (c *controller) publishProfileConnections(ctx context.Context, pluginID string, generation *pluginState, native, effective []types.Connection) error {
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if generation == nil || c.plugins[pluginID] != generation || generation.ctx.Err() != nil {
		return resourcev2.NewError("RESET_REQUIRED", "Provider generation retired during connection publication.")
	}
	if c.profileNative == nil {
		c.profileNative = make(map[string][]types.Connection)
	}
	c.profileNative[pluginID] = native
	c.connsMu.Lock()
	c.connections[pluginID] = effective
	c.connsMu.Unlock()
	return nil
}

func (c *controller) refreshWatchedConnections(ctx context.Context, pluginID string, provider resourcev2.ConnectionBrowser, generation *pluginState) ([]types.Connection, error) {
	defer c.notifyInventory()
	c.profilesMu.Lock()
	defer c.profilesMu.Unlock()
	c.pluginsMu.RLock()
	current := generation != nil && c.plugins[pluginID] == generation && generation.ctx.Err() == nil
	c.pluginsMu.RUnlock()
	if !current {
		return nil, resourcev2.NewError("RESET_REQUIRED", "Connection listener generation retired.")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	connections, err := provider.ListConnections(ctx)
	if err != nil {
		_ = c.publishProfileConnections(ctx, pluginID, generation, c.profileNative[pluginID], nil)
		return nil, err
	}
	if err := c.publishProfileConnections(ctx, pluginID, generation, c.profileNative[pluginID], connections); err != nil {
		return nil, err
	}
	c.emitter.Emit(pluginID+"/connection/sync", connections)
	c.scheduleAutoConnect(pluginID, connections, types.ConnectionAutoConnectTriggerConnectionDiscovered)
	return connections, nil
}
