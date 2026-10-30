package resource

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// catalogAdmission retains the route epoch captured before acquisition. Looking
// up the current epoch after fetching a catalog would bless stale source data.
type catalogAdmission struct {
	generation *pluginState
	epoch      sourceEpochSnapshot
}

func captureCatalogAdmission(ctx context.Context, generation *pluginState) catalogAdmission {
	epoch, ok := ctx.Value(sourceEpochKey{}).(sourceEpochSnapshot)
	if !ok {
		return catalogAdmission{}
	}
	return catalogAdmission{generation: generation, epoch: epoch}
}

func (c *controller) routeCatalog(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (catalogAdmission, resourcev2.Catalog, error) {
	if route.Connection == "" {
		return catalogAdmission{}, resourcev2.Catalog{}, resourcev2.NewError("INVALID_REQUEST", "An explicit access route is required.")
	}
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return catalogAdmission{}, resourcev2.Catalog{}, err
	}
	defer cleanup()
	catalog, err := provider.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
	if err != nil {
		return catalogAdmission{}, resourcev2.Catalog{}, err
	}
	if err = resourcev2.ValidateCatalog(catalog); err != nil {
		return catalogAdmission{}, resourcev2.Catalog{}, err
	}
	if err = c.currentGeneration(ctx, pluginID, generation); err != nil {
		return catalogAdmission{}, resourcev2.Catalog{}, err
	}
	if err = checkObservedCatalog(ctx, pluginID, route, catalog); err != nil {
		return catalogAdmission{}, resourcev2.Catalog{}, err
	}
	return captureCatalogAdmission(ctx, generation), catalog, nil
}

func (c *controller) resolveAuthority(ctx context.Context, pluginID string, route resourcev2.AccessRoute, catalog resourcev2.Catalog, admission catalogAdmission, resourceType string) (AuthorityResolution, error) {
	var descriptor *resourcev2.ResourceType
	for i := range catalog.Types {
		if catalog.Types[i].Type == resourceType {
			descriptor = &catalog.Types[i]
			break
		}
	}
	if descriptor == nil {
		return AuthorityResolution{}, resourcev2.NewError("NOT_FOUND", "Resource type is not in the route catalog.")
	}
	if err := ctx.Err(); err != nil {
		return AuthorityResolution{}, err
	}
	if err := c.observeCatalogBinding(ctx, pluginID, route, catalog, admission); err != nil {
		return AuthorityResolution{}, err
	}
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	generation := admission.generation
	if generation == nil || c.plugins[pluginID] != generation || generation.provider == nil || generation.ctx.Err() != nil {
		return AuthorityResolution{}, resourcev2.NewError("RESET_REQUIRED", "Provider generation retired.")
	}
	// Keep this check and ObserveCatalog under the same pluginsMu read fence
	// used by invalidateProfileRoutes' write-locked epoch/authority reset.
	if admission.epoch.Connection != route.Connection || generation.sourceEpoch[route.Connection] != admission.epoch.Epoch || generation.sourceChanging[route.Connection] {
		return AuthorityResolution{}, resourcev2.NewError("RESET_REQUIRED", "Connection configuration changed during catalog acquisition.")
	}
	c.finite.mu.Lock()
	defer c.finite.mu.Unlock()
	if c.finite.authorities == nil {
		c.finite.authorities = make(map[string]*AuthorityResolver)
	}
	resolver := c.finite.authorities[pluginID]
	if resolver == nil {
		root, err := c.pluginStoreFn(pluginID)
		if err != nil {
			return AuthorityResolution{}, err
		}
		resolver, err = NewAuthorityResolver(root)
		if err != nil {
			return AuthorityResolution{}, err
		}
		c.finite.authorities[pluginID] = resolver
	}
	resolutions, err := resolver.ObserveCatalog(pluginID, route.Connection, catalog)
	if err != nil {
		return AuthorityResolution{}, err
	}
	resolution, ok := resolutions[resourceType]
	if !ok {
		return AuthorityResolution{}, resourcev2.NewError("NOT_FOUND", "Resource type is not in the observed catalog.")
	}
	return resolution, nil
}

// catalogBindingState tracks native source generations, not resource identity.
// Retired epochs remain proof against delayed observations for this generation.
// All access is protected by pluginsMu.
type catalogBindingState struct {
	active  string
	retired map[string]struct{}
}

func (c *controller) observeCatalogBinding(ctx context.Context, pluginID string, route resourcev2.AccessRoute, catalog resourcev2.Catalog, admission catalogAdmission) error {
	binding, err := resourcev2.CatalogBindingEpoch(catalog.Revision)
	if err != nil {
		return err
	}
	c.pluginsMu.Lock()
	defer c.pluginsMu.Unlock()
	generation := admission.generation
	if err := c.currentGenerationLocked(ctx, pluginID, generation); err != nil {
		return err
	}
	if generation.ctx.Err() != nil {
		return resourcev2.NewError("RESET_REQUIRED", "Provider generation retired.")
	}
	if route.Connection == "" || admission.epoch.Connection != route.Connection || generation.sourceEpoch[route.Connection] != admission.epoch.Epoch {
		return resourcev2.NewError("RESET_REQUIRED", "Connection configuration changed during catalog acquisition.")
	}
	if generation.sourceChanging[route.Connection] {
		return resourcev2.NewError("UNAVAILABLE", "Connection configuration is changing.")
	}
	state := generation.catalogBindings[route.Connection]
	if state.active == binding {
		return nil
	}
	if _, retired := state.retired[binding]; retired {
		return resourcev2.NewError("RESET_REQUIRED", "Native source binding has retired.")
	}
	// Bound all retained epochs per plugin. Never evict retirement proof.
	retained := 0
	for _, existing := range generation.catalogBindings {
		if existing.active != "" {
			retained++
		}
		retained += len(existing.retired)
	}
	if retained >= maxAuthorityBindings {
		return resourcev2.NewError("RESOURCE_LIMIT", "Native source binding generation limit reached.")
	}
	retireRestart := false
	if state.active == "" {
		// Load persisted assignments before admitting the first observation.
		// No stored hint currently proves native continuity across restart.
		c.finite.mu.Lock()
		if c.finite.authorities == nil {
			c.finite.authorities = make(map[string]*AuthorityResolver)
		}
		resolver := c.finite.authorities[pluginID]
		if resolver == nil {
			root, loadErr := c.pluginStoreFn(pluginID)
			if loadErr != nil {
				c.finite.mu.Unlock()
				return loadErr
			}
			resolver, err = NewAuthorityResolver(root)
			if err != nil {
				c.finite.mu.Unlock()
				return err
			}
			c.finite.authorities[pluginID] = resolver
		}
		retireRestart = resolver.hasUnprovenRestartBindings(pluginID, route.Connection)
		c.finite.mu.Unlock()
	}
	if state.active != "" || retireRestart {
		if err := c.invalidateSourceRoutesLocked(pluginID, []string{route.Connection}, false); err != nil {
			return err
		}
		if state.active != "" {
			if state.retired == nil {
				state.retired = make(map[string]struct{})
			}
			state.retired[state.active] = struct{}{}
		}
	}
	previous := state.active
	state.active = binding
	if generation.catalogBindings == nil {
		generation.catalogBindings = make(map[string]catalogBindingState)
	}
	generation.catalogBindings[route.Connection] = state
	if previous != "" || retireRestart {
		return resourcev2.NewError("RESET_REQUIRED", "Native source binding changed; acquire a fresh catalog.")
	}
	return nil
}
