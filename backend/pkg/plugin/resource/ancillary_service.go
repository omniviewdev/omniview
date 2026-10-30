package resource

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func ancillaryTarget(pluginID string, route resourcev2.AccessRoute, resourceType string, reference resourcev2.ResourceReference, action string) invocation.Target {
	target := referenceTarget(pluginID, route, reference)
	target.ResourceType = resourceType
	target.Action = action
	return target
}

func ancillaryUnsupported() error {
	return resourcev2.NewError("UNSUPPORTED", "The provider does not support this ancillary operation.")
}

// admitAncillaryCatalog binds metadata admission without requiring Get support.
func (c *controller) admitAncillaryCatalog(ctx context.Context, pluginID string, provider ResourceProvider, generation *pluginState, route resourcev2.AccessRoute, typ string, reference *resourcev2.ResourceReference) (context.Context, resourcev2.Catalog, error) {
	catalog, err := provider.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
	if err == nil {
		err = resourcev2.ValidateCatalog(catalog)
	}
	if err == nil {
		err = checkObservedCatalog(ctx, pluginID, route, catalog)
	}
	if err == nil {
		err = c.currentGeneration(ctx, pluginID, generation)
	}
	if err != nil {
		return ctx, catalog, err
	}
	if typ != "" {
		authority, err := c.resolveAuthority(ctx, pluginID, route, catalog, captureCatalogAdmission(ctx, generation), typ)
		if err != nil {
			return ctx, catalog, err
		}
		if reference != nil {
			if reference.Address.Provider != catalog.Provider {
				return ctx, catalog, resourcev2.NewError("INVALID_REQUEST", "Reference provider does not match this route catalog.")
			}
			if reference.Address.Authority != authority.Authority {
				return ctx, catalog, resourcev2.NewError("RESET_REQUIRED", "Reference authority is no longer current for this route.")
			}
			found := false
			for _, descriptor := range catalog.Types {
				if descriptor.Type == typ {
					found = true
					if err := resourcev2.ValidateAddress(reference.Address, descriptor.IdentityDimensions); err != nil {
						return ctx, catalog, err
					}
					break
				}
			}
			if !found {
				return ctx, catalog, resourcev2.NewError("NOT_FOUND", "Resource type is not in the route catalog.")
			}
		}
	}
	return resourcev2.WithCatalogRevision(ctx, catalog.Revision), catalog, nil
}

func (c *controller) GetResourceGroups(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (out []resourcev2.ResourceGroup, retErr error) {
	ctx, err := c.admit(ctx, "resource.GetResourceGroups", ancillaryTarget(pluginID, route, "", resourcev2.ResourceReference{}, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	ancillary, ok := provider.(resourcev2.PresentationProvider)
	if !ok {
		return out, ancillaryUnsupported()
	}
	sessionCtx, _, err = c.admitAncillaryCatalog(sessionCtx, pluginID, provider, generation, route, "", nil)
	if err != nil {
		return out, err
	}
	out, err = ancillary.GetResourceGroups(sessionCtx, route)
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, err)
}

func (c *controller) GetResourceDefinition(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) (out resourcev2.ResourceDefinition, retErr error) {
	ctx, err := c.admit(ctx, "resource.GetResourceDefinition", ancillaryTarget(pluginID, route, resourceType, resourcev2.ResourceReference{}, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	ancillary, ok := provider.(resourcev2.PresentationProvider)
	if !ok {
		return out, ancillaryUnsupported()
	}
	sessionCtx, _, err = c.admitAncillaryCatalog(sessionCtx, pluginID, provider, generation, route, resourceType, nil)
	if err != nil {
		return out, err
	}
	out, err = ancillary.GetResourceDefinition(sessionCtx, route, resourceType)
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, err)
}

func (c *controller) GetEditorSchemas(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (out []resourcev2.EditorSchema, retErr error) {
	ctx, err := c.admit(ctx, "resource.GetEditorSchemas", ancillaryTarget(pluginID, route, "", resourcev2.ResourceReference{}, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	ancillary, ok := provider.(resourcev2.EditorSchemaProvider)
	if !ok {
		return out, ancillaryUnsupported()
	}
	sessionCtx, _, err = c.admitAncillaryCatalog(sessionCtx, pluginID, provider, generation, route, "", nil)
	if err != nil {
		return out, err
	}
	out, err = ancillary.GetEditorSchemas(sessionCtx, route)
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, err)
}

func (c *controller) GetRelationships(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) (out []resourcev2.RelationshipDescriptor, retErr error) {
	ctx, err := c.admit(ctx, "resource.GetRelationships", ancillaryTarget(pluginID, route, resourceType, resourcev2.ResourceReference{}, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	ancillary, ok := provider.(resourcev2.RelationshipProvider)
	if !ok {
		return out, ancillaryUnsupported()
	}
	sessionCtx, _, err = c.admitAncillaryCatalog(sessionCtx, pluginID, provider, generation, route, resourceType, nil)
	if err != nil {
		return out, err
	}
	out, err = ancillary.GetRelationships(sessionCtx, route, resourceType)
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, err)
}

func (c *controller) ResolveRelationships(ctx context.Context, pluginID string, request resourcev2.GetRequest) (out []resourcev2.ResolvedRelationship, retErr error) {
	ctx, err := c.admit(ctx, "resource.ResolveRelationships", ancillaryTarget(pluginID, request.Route, request.Reference.Address.Type, request.Reference, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	if err := resourcev2.ValidateGetRequest(request); err != nil {
		return out, err
	}
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	ancillary, ok := provider.(resourcev2.RelationshipProvider)
	if !ok {
		return out, ancillaryUnsupported()
	}
	sessionCtx, catalog, err := c.admitAncillaryCatalog(sessionCtx, pluginID, provider, generation, request.Route, request.Reference.Address.Type, &request.Reference)
	if err != nil {
		return out, err
	}
	resolution, err := c.relationshipRequest(sessionCtx, pluginID, catalog, generation, ancillary, request)
	if err != nil {
		return nil, err
	}
	if err := resourcev2.ValidateRelationshipResolutionRequest(resolution); err != nil {
		return nil, err
	}
	for _, target := range resolution.Targets {
		if target.Route != request.Route || target.Provider != catalog.Provider {
			return nil, resourcev2.NewError("UNSUPPORTED", "Cross-route relationship targets require their own catalog admission.")
		}
	}
	// All current bindings share this complete catalog. Attach its qualified
	// observation once, never copy a source token onto an unobserved route.
	sessionCtx = resourcev2.WithCatalogRevisionForRoute(sessionCtx, catalog.Provider, request.Route, catalog.Revision)
	out, err = ancillary.ResolveRelationships(sessionCtx, resolution)
	if err != nil {
		return nil, err
	}
	if err := resourcev2.ValidateRelationshipResolutionResult(resolution, out); err != nil {
		return nil, err
	}
	for _, relationship := range out {
		for _, target := range relationship.Targets {
			targetCtx, err := c.admit(sessionCtx, "resource.ResolveRelationships", referenceTarget(pluginID, target.Route, target.Reference))
			if err != nil {
				return nil, err
			}
			if err := c.validateReference(targetCtx, pluginID, target.Route, target.Reference); err != nil {
				return nil, err
			}
		}
	}
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, nil)
}

func (c *controller) GetHealth(ctx context.Context, pluginID string, request resourcev2.GetRequest, value resourcev2.Value) (out *resourcev2.ResourceHealth, retErr error) {
	ctx, err := c.admit(ctx, "resource.GetHealth", ancillaryTarget(pluginID, request.Route, request.Reference.Address.Type, request.Reference, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	if err := resourcev2.ValidateGetRequest(request); err != nil {
		return out, err
	}
	if err := resourcev2.ValidateValue(value); err != nil {
		return out, err
	}
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	ancillary, ok := provider.(resourcev2.HealthProvider)
	if !ok {
		return out, ancillaryUnsupported()
	}
	sessionCtx, _, err = c.admitAncillaryCatalog(sessionCtx, pluginID, provider, generation, request.Route, request.Reference.Address.Type, &request.Reference)
	if err != nil {
		return out, err
	}
	out, err = ancillary.GetHealth(sessionCtx, request, value)
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, err)
}

func (c *controller) GetResourceEvents(ctx context.Context, pluginID string, request resourcev2.GetRequest, limit uint32) (out []resourcev2.ResourceEvent, retErr error) {
	ctx, err := c.admit(ctx, "resource.GetResourceEvents", ancillaryTarget(pluginID, request.Route, request.Reference.Address.Type, request.Reference, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	if err := resourcev2.ValidateGetRequest(request); err != nil {
		return out, err
	}
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	ancillary, ok := provider.(resourcev2.HealthProvider)
	if !ok {
		return out, ancillaryUnsupported()
	}
	sessionCtx, _, err = c.admitAncillaryCatalog(sessionCtx, pluginID, provider, generation, request.Route, request.Reference.Address.Type, &request.Reference)
	if err != nil {
		return out, err
	}
	out, err = ancillary.GetResourceEvents(sessionCtx, request, limit)
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, err)
}

func (c *controller) GetActions(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) (out []resourcev2.ActionDescriptor, retErr error) {
	ctx, err := c.admit(ctx, "resource.GetActions", ancillaryTarget(pluginID, route, resourceType, resourcev2.ResourceReference{}, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	ancillary, ok := provider.(resourcev2.ActionCatalog)
	if !ok {
		return out, ancillaryUnsupported()
	}
	sessionCtx, _, err = c.admitAncillaryCatalog(sessionCtx, pluginID, provider, generation, route, resourceType, nil)
	if err != nil {
		return out, err
	}
	out, err = ancillary.GetActions(sessionCtx, route, resourceType)
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, err)
}

func (c *controller) GetSchemaDocument(ctx context.Context, pluginID string, route resourcev2.AccessRoute, reference resourcev2.SchemaDocumentReference) (out resourcev2.SchemaDocument, retErr error) {
	ctx, err := c.admit(ctx, "resource.GetSchemaDocument", ancillaryTarget(pluginID, route, "", resourcev2.ResourceReference{}, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	ancillary, ok := provider.(resourcev2.SchemaDocumentProvider)
	if !ok {
		return out, ancillaryUnsupported()
	}
	sessionCtx, _, err = c.admitAncillaryCatalog(sessionCtx, pluginID, provider, generation, route, "", nil)
	if err != nil {
		return out, err
	}
	out, err = ancillary.GetSchemaDocument(sessionCtx, route, reference)
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, err)
}

func ancillaryResult[T any](c *controller, ctx context.Context, pluginID string, generation *pluginState, value T, err error) (T, error) {
	if err == nil {
		err = c.currentGeneration(ctx, pluginID, generation)
	}
	if err != nil {
		var zero T
		return zero, err
	}
	return value, nil
}

func (c *controller) relationshipRequest(ctx context.Context, pluginID string, catalog resourcev2.Catalog, generation *pluginState, ancillary resourcev2.RelationshipProvider, source resourcev2.GetRequest) (resourcev2.RelationshipResolutionRequest, error) {
	request := resourcev2.RelationshipResolutionRequest{Source: source, Targets: []resourcev2.ReadTarget{}}
	if catalog.Coverage.Kind != "complete" {
		return request, resourcev2.NewError("UNSUPPORTED", "Relationship target binding requires a complete route catalog.")
	}
	descriptors, err := ancillary.GetRelationships(ctx, source.Route, source.Reference.Address.Type)
	if err != nil {
		return request, err
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return request, err
	}
	request.Targets, err = c.relationshipTargets(ctx, pluginID, source.Route, catalog, captureCatalogAdmission(ctx, generation), descriptors, "resource.ResolveRelationships")
	return request, err
}
