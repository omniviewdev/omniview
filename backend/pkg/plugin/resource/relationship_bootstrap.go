package resource

import (
	"context"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Bootstrap retains existing declaration discovery without assuming a first
// connection or requiring a namespace/GVK-shaped catalog. Each route keeps its
// own declarations and generation retirement fences all graph mutations.
func (c *controller) bootstrapRelationships(parent context.Context, pluginID string, route resourcev2.AccessRoute) {
	ctx, cancel := context.WithTimeout(parent, relationshipBootstrapTimeout)
	defer cancel()
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return
	}
	defer cleanup()
	features, err := c.providerFeatures(ctx, pluginID, provider)
	if err != nil || !features.Has(resourcev2.FeatureRelationships) {
		return
	}
	relations, ok := provider.(resourcev2.RelationshipProvider)
	if !ok {
		return
	}
	catalog, err := provider.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
	if err != nil {
		c.logger.Warnw(ctx, "relationship catalog unavailable", "pluginID", pluginID, "error", err)
		return
	}
	if err := resourcev2.ValidateCatalog(catalog); err != nil {
		c.logger.Warnw(ctx, "invalid relationship catalog", "pluginID", pluginID, "error", err)
		return
	}
	for _, descriptor := range catalog.Types {
		if err := ctx.Err(); err != nil {
			return
		}
		if _, err := c.admit(ctx, "resource.GetRelationships", invocation.Target{Provider: pluginID, Connection: route.Connection, ResourceType: descriptor.Type}); err != nil {
			continue
		}
		declarations, err := relations.GetRelationships(ctx, route, descriptor.Type)
		if err != nil {
			c.logger.Warnw(ctx, "relationship declarations unavailable", "pluginID", pluginID, "type", descriptor.Type, "error", err)
			continue
		}
		c.pluginsMu.RLock()
		if c.plugins[pluginID] != generation || generation.provider == nil || ctx.Err() != nil {
			c.pluginsMu.RUnlock()
			return
		}
		c.graph.SetDeclarations(pluginID, route, descriptor.Type, declarations)
		c.pluginsMu.RUnlock()
	}
}
