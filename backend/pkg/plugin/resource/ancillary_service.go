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
	if err := c.validateReference(sessionCtx, pluginID, request.Route, request.Reference); err != nil {
		return out, err
	}
	resolution, err := c.relationshipRequest(sessionCtx, pluginID, provider, generation, ancillary, request)
	if err != nil {
		return nil, err
	}
	if err := resourcev2.ValidateRelationshipResolutionRequest(resolution); err != nil {
		return nil, err
	}
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
	if err := c.validateReference(sessionCtx, pluginID, request.Route, request.Reference); err != nil {
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
	if err := c.validateReference(sessionCtx, pluginID, request.Route, request.Reference); err != nil {
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

func (c *controller) relationshipRequest(ctx context.Context, pluginID string, provider ResourceProvider, generation *pluginState, ancillary resourcev2.RelationshipProvider, source resourcev2.GetRequest) (resourcev2.RelationshipResolutionRequest, error) {
	request := resourcev2.RelationshipResolutionRequest{Source: source, Targets: []resourcev2.ReadTarget{}}
	descriptors, err := ancillary.GetRelationships(ctx, source.Route, source.Reference.Address.Type)
	if err != nil {
		return request, err
	}
	catalog, err := provider.Catalog(ctx, resourcev2.CatalogRequest{Route: source.Route})
	if err != nil {
		return request, err
	}
	if err := resourcev2.ValidateCatalog(catalog); err != nil {
		return request, err
	}
	if catalog.Coverage.Kind != "complete" {
		return request, resourcev2.NewError("UNSUPPORTED", "Relationship target binding requires a complete route catalog.")
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return request, err
	}
	authority, err := c.resolveAuthority(ctx, pluginID, source.Route, catalog, generation, source.Reference.Address.Type)
	if err != nil {
		return request, err
	}
	if catalog.Provider != source.Reference.Address.Provider || authority.Authority != source.Reference.Address.Authority {
		return request, resourcev2.NewError("INVALID_REQUEST", "Relationship source is not bound to the current route authority.")
	}
	seen := make(map[string]bool, min(len(descriptors), resourcev2.MaxRelationshipTargets))
	for _, relationship := range descriptors {
		if seen[relationship.TargetType] {
			continue
		}
		seen[relationship.TargetType] = true
		if len(request.Targets) >= resourcev2.MaxRelationshipTargets {
			return request, resourcev2.NewError("RESOURCE_LIMIT", "Too many relationship target bindings.")
		}
		var descriptor *resourcev2.ResourceType
		for i := range catalog.Types {
			if catalog.Types[i].Type == relationship.TargetType {
				descriptor = &catalog.Types[i]
				break
			}
		}
		if descriptor == nil || descriptor.DefaultRepresentation == "" {
			return request, resourcev2.NewError("UNSUPPORTED", "Relationship target requires a catalog type and an explicit default representation.")
		}
		target := resourcev2.ReadTarget{
			Route: source.Route, Provider: catalog.Provider, Type: descriptor.Type,
			Representation: descriptor.DefaultRepresentation,
			Scope:          make(resourcev2.QueryScope, 0, len(descriptor.QueryDimensions)),
		}
		for _, dimension := range descriptor.QueryDimensions {
			target.Scope = append(target.Scope, resourcev2.ScopeConstraint{Dimension: dimension.Name, Match: resourcev2.ScopeAny})
		}
		targetCtx, err := c.admit(ctx, "resource.ResolveRelationships", readTarget(pluginID, target))
		if err != nil {
			return request, err
		}
		targetAuthority, err := c.resolveAuthority(targetCtx, pluginID, target.Route, catalog, generation, target.Type)
		if err != nil {
			return request, err
		}
		target.Authority = targetAuthority.Authority
		request.Targets = append(request.Targets, target)
	}
	return request, nil
}
