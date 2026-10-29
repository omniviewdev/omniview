package resource

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Preserve native SyncOnConnect behavior using actual qualified update scopes.
// The source manager still decides which native registrations start eagerly;
// this does not turn finite enumeration into a subscription.
func (c *controller) startConnectionUpdates(ctx context.Context, pluginID string, route resourcev2.AccessRoute) error {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return err
	}
	features, err := c.providerFeatures(ctx, pluginID, provider)
	if err != nil {
		return err
	}
	if !features.Has(resourcev2.FeatureBestEffortUpdates) {
		return nil
	}
	generation, catalog, err := c.routeCatalog(ctx, pluginID, route)
	if err != nil {
		return err
	}
	targets := make([]resourcev2.ReadTarget, 0)
	for _, descriptor := range catalog.Types {
		// No provider default means explicit UI selection is required. Never
		// choose the first representation to start background acquisition.
		if descriptor.DefaultRepresentation == "" {
			continue
		}
		for _, capability := range descriptor.Capabilities {
			if capability.Operation != resourcev2.OperationUpdate {
				continue
			}
			authority, err := c.resolveAuthority(ctx, pluginID, route, catalog, generation, descriptor.Type)
			if err != nil {
				return err
			}
			targets = append(targets, resourcev2.ReadTarget{Route: route, Provider: catalog.Provider, Authority: authority.Authority, Type: descriptor.Type, Scope: capability.Scope, Representation: descriptor.DefaultRepresentation})
		}
	}
	if len(targets) == 0 {
		return nil
	}
	return c.StartConnectionWatch(ctx, pluginID, targets)
}
