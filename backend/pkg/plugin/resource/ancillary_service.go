package resource

import (
	"context"

	"go.opentelemetry.io/otel/attribute"

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
// Within an admission batch (see WithAdmissionBatch) the catalog, its validation
// and authority resolution are acquired once per resource type; every reference
// still passes the generation fence and its own address/authority checks.
func (c *controller) admitAncillaryCatalog(ctx context.Context, pluginID string, provider ResourceProvider, generation *pluginState, route resourcev2.AccessRoute, typ string, reference *resourcev2.ResourceReference) (context.Context, resourcev2.Catalog, error) {
	batch, key := admissionBatchFrom(ctx), admissionBatchKey{}
	if batch != nil && typ != "" {
		key = admissionBatchKey{plugin: pluginID, route: route, generation: generation, epoch: captureCatalogAdmission(ctx, generation).epoch, typ: typ}
		if entry, ok := batch.lookup(key); ok {
			c.pluginsMu.RLock()
			err := c.currentGenerationLocked(ctx, pluginID, generation)
			if err == nil && reference != nil {
				// A foreign provider is an invalid request, not a retired authority:
				// judge it before authority currency, as the admission that acquired
				// this catalog did.
				err = checkAncillaryProvider(entry.catalog.Provider, reference)
			}
			if err == nil && reference != nil && !c.referenceCurrentLocked(pluginID, route, *reference) {
				err = resourcev2.NewError("RESET_REQUIRED", "Observation authority retired.")
			}
			c.pluginsMu.RUnlock()
			if err != nil {
				return ctx, entry.catalog, err
			}
			if err := checkAncillaryReference(entry.catalog, entry.authority, typ, reference); err != nil {
				return ctx, entry.catalog, err
			}
			return resourcev2.WithCatalogRevision(ctx, entry.catalog.Revision), entry.catalog, nil
		}
	}
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
		if err := checkAncillaryReference(catalog, authority, typ, reference); err != nil {
			return ctx, catalog, err
		}
		if batch != nil {
			batch.store(key, admissionBatchEntry{catalog: catalog, authority: authority})
		}
	}
	return resourcev2.WithCatalogRevision(ctx, catalog.Revision), catalog, nil
}

func checkAncillaryProvider(catalogProvider string, reference *resourcev2.ResourceReference) error {
	if reference.Address.Provider != catalogProvider {
		return resourcev2.NewError("INVALID_REQUEST", "Reference provider does not match this route catalog.")
	}
	return nil
}

func checkAncillaryReference(catalog resourcev2.Catalog, authority AuthorityResolution, typ string, reference *resourcev2.ResourceReference) error {
	if reference == nil {
		return nil
	}
	if err := checkAncillaryProvider(catalog.Provider, reference); err != nil {
		return err
	}
	if reference.Address.Authority != authority.Authority {
		return resourcev2.NewError("RESET_REQUIRED", "Reference authority is no longer current for this route.")
	}
	for _, descriptor := range catalog.Types {
		if descriptor.Type == typ {
			return resourcev2.ValidateAddress(reference.Address, descriptor.IdentityDimensions)
		}
	}
	return resourcev2.NewError("NOT_FOUND", "Resource type is not in the route catalog.")
}

func (c *controller) GetResourceGroups(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (out []resourcev2.ResourceGroup, retErr error) {
	ctx, end := h3StartOperation(ctx, "resource.GetResourceGroups",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", route.Connection),
	)
	defer end(&retErr)
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
	ctx, end := h3StartOperation(ctx, "resource.GetResourceDefinition",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", route.Connection),
		attribute.String("resource_type", resourceType),
	)
	defer end(&retErr)
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

func (c *controller) GetRelationships(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) (out []resourcev2.RelationshipDescriptor, retErr error) {
	ctx, end := h3StartOperation(ctx, "resource.GetRelationships",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", route.Connection),
		attribute.String("resource_type", resourceType),
	)
	defer end(&retErr)
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
	ctx, end := h3StartOperation(ctx, "resource.ResolveRelationships",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", request.Route.Connection),
		attribute.String("resource_type", request.Reference.Address.Type),
	)
	defer end(&retErr)
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
	ctx, end := h3StartOperation(ctx, "resource.GetHealth",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", request.Route.Connection),
		attribute.String("resource_type", request.Reference.Address.Type),
	)
	defer end(&retErr)
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
	ctx, end := h3StartOperation(ctx, "resource.GetResourceEvents",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", request.Route.Connection),
		attribute.String("resource_type", request.Reference.Address.Type),
	)
	defer end(&retErr)
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
	ctx, end := h3StartOperation(ctx, "resource.GetActions",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", route.Connection),
		attribute.String("resource_type", resourceType),
	)
	defer end(&retErr)
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
	if observed, reused, discoveryErr := c.discoveryCatalog(sessionCtx, pluginID, route); reused {
		if discoveryErr != nil {
			return out, discoveryErr
		}
		if _, exists := observed.discovery.authorities[resourceType]; !exists {
			return out, resourcev2.NewError("NOT_FOUND", "Resource type is not in the observed catalog.")
		}
		sessionCtx = resourcev2.WithCatalogRevision(sessionCtx, observed.discovery.catalog.Revision)
	} else {
		sessionCtx, _, err = c.admitAncillaryCatalog(sessionCtx, pluginID, provider, generation, route, resourceType, nil)
		if err != nil {
			return out, err
		}
	}
	out, err = ancillary.GetActions(sessionCtx, route, resourceType)
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, err)
}

func (c *controller) ResolveSchema(ctx context.Context, pluginID string, request resourcev2.SchemaRequest) (out resourcev2.SchemaBinding, retErr error) {
	ctx, end := h3StartOperation(ctx, "resource.ResolveSchema",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", request.Route.Connection),
		attribute.String("resource_type", request.Type),
	)
	defer end(&retErr)
	ctx, err := c.admit(ctx, "resource.ResolveSchema", schemaInvocationTarget(pluginID, request))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	sessionCtx, entry, err := c.admitSchemaTarget(sessionCtx, pluginID, provider, generation, request)
	if err != nil {
		return out, err
	}
	resolution, resolveErr := entry.Resolve(sessionCtx, schemaBindingSource(provider), schemaDocumentSource(provider, request.Route))
	if resolveErr != nil && resolution.Binding.State != "unavailable" {
		return out, resolveErr
	}
	if err = c.finishSchemaTarget(sessionCtx, "resource.ResolveSchema", pluginID, provider, generation, request, entry, resolution.Observation); err != nil {
		return out, err
	}
	return resolution.Binding, nil
}

func (c *controller) GetSchemaDocument(ctx context.Context, pluginID string, request resourcev2.SchemaDocumentRequest) (out resourcev2.SchemaDocument, retErr error) {
	ctx, end := h3StartOperation(ctx, "resource.GetSchemaDocument",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", request.Request.Route.Connection),
		attribute.String("resource_type", request.Request.Type),
	)
	defer end(&retErr)
	ctx, err := c.admit(ctx, "resource.GetSchemaDocument", schemaInvocationTarget(pluginID, request.Request))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	if err := resourcev2.ValidateSchemaDocumentRequest(request); err != nil {
		return out, err
	}
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Request.Route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	if _, ok := provider.(resourcev2.SchemaResolver); !ok {
		return out, ancillaryUnsupported()
	}
	sessionCtx, entry, err := c.admitSchemaTarget(sessionCtx, pluginID, provider, generation, request.Request)
	if err != nil {
		return out, err
	}
	resolution, err := entry.Resolve(sessionCtx, schemaBindingSource(provider), schemaDocumentSource(provider, request.Request.Route))
	if err != nil {
		return out, err
	}
	if resolution.Binding.DocumentRef == nil || *resolution.Binding.DocumentRef != request.Reference || resolution.Schema == nil {
		return out, resourcev2.NewError("NOT_FOUND", "Schema document is not associated with this target.")
	}
	out = resourcev2.SchemaDocument{Reference: request.Reference, Dialect: resolution.Binding.Dialect, Document: resolution.Schema.Document.RawJSON()}
	if err = c.finishSchemaTarget(sessionCtx, "resource.GetSchemaDocument", pluginID, provider, generation, request.Request, entry, resolution.Observation); err != nil {
		return resourcev2.SchemaDocument{}, err
	}
	return out, nil
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
