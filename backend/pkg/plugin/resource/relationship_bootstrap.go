package resource

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcegraph "github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Declarations and their target bindings come from one actual catalog/route
// observation. This is metadata admission, never a scan of resource inventory.
func (c *controller) bootstrapRelationships(parent context.Context, pluginID string, route resourcev2.AccessRoute) {
	ctx, cancel := context.WithTimeout(parent, relationshipBootstrapTimeout)
	defer cancel()
	c.bootstrapRelationshipsCurrent(ctx, pluginID, route, true, nil)
}

func (c *controller) bootstrapRelationshipsCurrent(ctx context.Context, pluginID string, route resourcev2.AccessRoute, reacquire bool, expected *catalogAdmission) {
	provider, generation, ctx, cleanup, err := c.operationGenerationExpected(ctx, pluginID, route, expected)
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
	c.publishRelationshipDeclarations(ctx, pluginID, route, "", generation, nil, resourcegraph.DeclarationBindings{}, resourcev2.NewError("UNAVAILABLE", "Relationship declarations are being refreshed."))
	catalog, err := provider.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
	if err == nil {
		err = resourcev2.ValidateCatalog(catalog)
	}
	if err == nil && catalog.Coverage.Kind != "complete" {
		err = resourcev2.NewError("UNSUPPORTED", "Relationship declaration binding requires a complete route catalog.")
	}
	if err != nil {
		c.publishRelationshipDeclarations(ctx, pluginID, route, "", generation, nil, resourcegraph.DeclarationBindings{}, err)
		return
	}
	ctx = resourcev2.WithCatalogRevision(ctx, catalog.Revision)
	admission := captureCatalogAdmission(ctx, generation)
	types := make(map[string]*resourcev2.ResourceType, len(catalog.Types))
	observedTypes := make([]string, len(catalog.Types))
	for i := range catalog.Types {
		types[catalog.Types[i].Type] = &catalog.Types[i]
		observedTypes[i] = catalog.Types[i].Type
	}
	// Admit native binding retirement before publishing declaration snapshots.
	// A first observation can retire persisted restart bindings and advance the
	// source epoch. Reacquire once under that new epoch, never reuse old work.
	if err := c.observeCatalogBinding(ctx, pluginID, route, catalog, admission); err != nil {
		if reacquire && resourcev2.ErrorCode(err) == "RESET_REQUIRED" {
			binding, bindingErr := resourcev2.CatalogBindingEpoch(catalog.Revision)
			c.pluginsMu.RLock()
			retiredByObservation := bindingErr == nil &&
				c.plugins[pluginID] == generation && generation.ctx.Err() == nil &&
				!generation.sourceChanging[route.Connection] &&
				generation.sourceEpoch[route.Connection] == admission.epoch.Epoch+1 &&
				generation.catalogBindings[route.Connection].active == binding
			c.pluginsMu.RUnlock()
			if retiredByObservation {
				expected := catalogAdmission{generation: generation, epoch: sourceEpochSnapshot{Connection: route.Connection, Epoch: admission.epoch.Epoch + 1}}
				c.bootstrapRelationshipsCurrent(ctx, pluginID, route, false, &expected)
			}
		}
		return
	}
	c.pluginsMu.RLock()
	if c.currentGenerationLocked(ctx, pluginID, generation) != nil {
		c.pluginsMu.RUnlock()
		return
	}
	c.graph.ObserveDeclarationCatalog(pluginID, route, catalog.Revision, admission.epoch.Epoch, observedTypes)
	c.pluginsMu.RUnlock()
	for _, descriptor := range catalog.Types {
		if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
			return
		}
		admitted, err := c.admit(ctx, "resource.GetRelationships", invocation.Target{Provider: pluginID, Connection: route.Connection, ResourceType: descriptor.Type})
		var declarations []resourcev2.RelationshipDescriptor
		if err == nil {
			_, err = c.resolveAuthority(admitted, pluginID, route, catalog, admission, descriptor.Type)
		}
		if err == nil {
			declarations, err = relations.GetRelationships(admitted, route, descriptor.Type)
		}
		bindings := resourcegraph.DeclarationBindings{SourceEpoch: admission.epoch.Epoch}
		if err == nil && len(declarations) > 0 {
			var source resourcev2.ReadTarget
			var dimensions []resourcev2.Dimension
			source, dimensions, err = c.relationshipTypeTarget(admitted, pluginID, route, catalog, admission, descriptor.Type, "resource.GetRelationships")
			bindings.Source = resourcegraph.TargetBinding{Target: source, IdentityDimensions: dimensions}
			if err == nil {
				var targets []resourcev2.ReadTarget
				targets, err = c.relationshipTargets(admitted, pluginID, route, catalog, admission, declarations, "resource.GetRelationships")
				if err == nil {
					bindings.Targets = make([]resourcegraph.TargetBinding, 0, len(targets))
					for _, target := range targets {
						bindings.Targets = append(bindings.Targets, resourcegraph.TargetBinding{Target: target, IdentityDimensions: types[target.Type].IdentityDimensions})
					}
				}
			}
		}
		c.publishRelationshipDeclarations(ctx, pluginID, route, descriptor.Type, generation, declarations, bindings, err)
	}
	c.publishRelationshipDeclarations(ctx, pluginID, route, "", generation, nil, resourcegraph.DeclarationBindings{}, nil)
}

// Epoch validation and mutation use the same fence as route invalidation. An old
// blocked metadata call cannot republish rules, selectors, or coverage afterward.
func (c *controller) publishRelationshipDeclarations(ctx context.Context, pluginID string, route resourcev2.AccessRoute, sourceType string, generation *pluginState, declarations []resourcev2.RelationshipDescriptor, bindings resourcegraph.DeclarationBindings, err error) {
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	if c.currentGenerationLocked(ctx, pluginID, generation) != nil {
		return
	}
	if err != nil || sourceType == "" {
		c.graph.RecordDeclarationError(pluginID, route, sourceType, err)
		return
	}
	if len(declarations) == 0 {
		c.graph.SetNoDeclarations(pluginID, route, sourceType)
		return
	}
	if err := c.graph.SetBoundDeclarations(pluginID, route, sourceType, declarations, bindings); err != nil {
		c.graph.RecordDeclarationError(pluginID, route, sourceType, err)
	}
}
