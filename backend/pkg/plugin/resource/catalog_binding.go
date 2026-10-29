package resource

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

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
