package resource

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

func connectionForRoute(route resourcev2.AccessRoute) *sdktypes.Connection {
	if route.Connection == "" {
		return nil
	}
	return &sdktypes.Connection{ID: route.Connection}
}

type sourceEpochKey struct{}
type sourceEpochSnapshot struct {
	Connection string
	Epoch      uint64
}

// operationGeneration joins native plugin ownership to the actual invocation.
// A target label is never consulted for authorization, lookup, or source access.
func (c *controller) operationGeneration(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (ResourceProvider, *pluginState, context.Context, func(), error) {
	return c.operationGenerationExpected(ctx, pluginID, route, nil)
}

// Expected admission is checked under the same lock that captures the new
// operation epoch. Stale work must never promote itself across a profile reset.
func (c *controller) operationGenerationExpected(ctx context.Context, pluginID string, route resourcev2.AccessRoute, expected *catalogAdmission) (ResourceProvider, *pluginState, context.Context, func(), error) {
	if observed, ok := ctx.Value(observationKey{}).(Observation); ok {
		if observed.plugin != pluginID || observed.route != route {
			return nil, nil, nil, nil, resourcev2.NewError("RESET_REQUIRED", "Advertised resource route changed.")
		}
		if expected != nil && *expected != observed.admission {
			return nil, nil, nil, nil, resourcev2.NewError("RESET_REQUIRED", "Conflicting retained source observations.")
		}
		expected = &observed.admission
	}
	c.pluginsMu.RLock()
	generation := c.plugins[pluginID]
	if generation == nil || generation.provider == nil || generation.ctx == nil {
		c.pluginsMu.RUnlock()
		return nil, nil, nil, nil, apperror.PluginNotFound(pluginID)
	}
	if expected != nil && (generation != expected.generation || expected.epoch.Connection != route.Connection || generation.sourceEpoch[route.Connection] != expected.epoch.Epoch) {
		c.pluginsMu.RUnlock()
		return nil, nil, nil, nil, resourcev2.NewError("RESET_REQUIRED", "Expected source generation retired before acquisition.")
	}
	if generation.sourceChanging[route.Connection] {
		c.pluginsMu.RUnlock()
		return nil, nil, nil, nil, resourcev2.NewError("UNAVAILABLE", "Connection configuration is changing.")
	}
	epoch := sourceEpochSnapshot{Connection: route.Connection, Epoch: generation.sourceEpoch[route.Connection]}
	provider := generation.provider
	operationCtx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(generation.ctx, cancel)
	c.pluginsMu.RUnlock()
	request, _ := invocation.FromContext(ctx)
	operationCtx = resourcev2.WithSession(operationCtx, resourcev2.Session{Connection: connectionForRoute(route), RequestID: request.ID(), RequesterID: string(request.Principal().Origin()), PluginID: pluginID})
	operationCtx = context.WithValue(operationCtx, sourceEpochKey{}, epoch)
	cleanup := func() { stop(); cancel() }
	if err := operationCtx.Err(); err != nil {
		cleanup()
		return nil, nil, nil, nil, err
	}
	return provider, generation, operationCtx, cleanup, nil
}

func (c *controller) currentGeneration(ctx context.Context, pluginID string, generation *pluginState) error {
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	return c.currentGenerationLocked(ctx, pluginID, generation)
}

// Caller holds pluginsMu at the final mutation fence; never recursively RLock.
func (c *controller) currentGenerationLocked(ctx context.Context, pluginID string, generation *pluginState) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if generation == nil || c.plugins[pluginID] != generation || generation.provider == nil {
		return resourcev2.NewError("RESET_REQUIRED", "Provider generation retired.")
	}
	if epoch, ok := ctx.Value(sourceEpochKey{}).(sourceEpochSnapshot); ok && generation.sourceEpoch[epoch.Connection] != epoch.Epoch {
		return resourcev2.NewError("RESET_REQUIRED", "Connection configuration changed.")
	}
	if epoch, ok := ctx.Value(sourceEpochKey{}).(sourceEpochSnapshot); ok && generation.sourceChanging[epoch.Connection] {
		return resourcev2.NewError("UNAVAILABLE", "Connection configuration is changing.")
	}
	return nil
}

func (c *controller) admitOperationCatalog(ctx context.Context, pluginID string, provider ResourceProvider, generation *pluginState, route resourcev2.AccessRoute, authority, canonicalProvider string, request any) (context.Context, resourcev2.ResourceType, error) {
	catalog, err := provider.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
	if err != nil {
		return ctx, resourcev2.ResourceType{}, err
	}
	if err = resourcev2.ValidateCatalog(catalog); err != nil {
		return ctx, resourcev2.ResourceType{}, err
	}
	if err := checkObservedCatalog(ctx, pluginID, route, catalog); err != nil {
		return ctx, resourcev2.ResourceType{}, err
	}
	if err = c.currentGeneration(ctx, pluginID, generation); err != nil {
		return ctx, resourcev2.ResourceType{}, err
	}
	descriptor, err := resourcev2.AdmitCatalogOperation(catalog, request)
	if err != nil {
		return ctx, resourcev2.ResourceType{}, err
	}
	resolved, err := c.resolveAuthority(ctx, pluginID, route, catalog, captureCatalogAdmission(ctx, generation), descriptor.Type)
	if err != nil {
		return ctx, resourcev2.ResourceType{}, err
	}
	if catalog.Provider != canonicalProvider {
		return ctx, resourcev2.ResourceType{}, resourcev2.NewError("INVALID_REQUEST", "Request provider is not bound to this route.")
	}
	if resolved.Authority != authority {
		return ctx, resourcev2.ResourceType{}, resourcev2.NewError("RESET_REQUIRED", "Request authority is not current for this route.")
	}
	return resourcev2.WithCatalogRevision(ctx, catalog.Revision), descriptor, nil
}

func (c *controller) Get(ctx context.Context, pluginID string, input HostGetRequest) (_result HostRecord, retErr error) {
	request := input.Request
	ctx, err := c.admit(ctx, "resource.Get", referenceTarget(pluginID, request.Route, request.Reference))
	if err != nil {
		return _result, err
	}
	defer finishResource(ctx, &retErr)
	if err := validateTargetLabel(input.TargetID); err != nil {
		return _result, err
	}
	if err := resourcev2.ValidateGetRequest(request); err != nil {
		return _result, err
	}
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Route)
	if err != nil {
		return _result, err
	}
	defer cleanup()
	getter, ok := provider.(resourcev2.Getter)
	if !ok {
		return _result, resourcev2.NewError("UNSUPPORTED", "Get is not supported.")
	}
	ctx, descriptor, err := c.admitOperationCatalog(ctx, pluginID, provider, generation, request.Route, request.Reference.Address.Authority, request.Reference.Address.Provider, request)
	if err != nil {
		return _result, err
	}
	target, err := exactReadTarget(request, descriptor)
	if err != nil {
		return _result, err
	}
	ctx, err = c.boundary.Reauthorize(ctx, referenceQueryTarget(pluginID, target, request.Reference))
	if err != nil {
		return _result, err
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return _result, err
	}
	record, err := getter.Get(ctx, request)
	if err != nil {
		c.checkConnectionError(pluginID, err)
		return _result, err
	}
	if err := resourcev2.ValidateOperationResult(request, record, descriptor); err != nil {
		return _result, err
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return _result, err
	}
	if err := c.observeRecord(ctx, pluginID, request.Route, record); err != nil {
		return _result, err
	}
	principal, _ := invocation.FromContext(ctx)
	out, err := envelopeRecord(generation.generationID, principal.Principal().Owner(), input.TargetID, target, record)
	if err != nil {
		return _result, err
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return _result, err
	}
	return out, nil
}

func exactReadTarget(request resourcev2.GetRequest, descriptor resourcev2.ResourceType) (resourcev2.ReadTarget, error) {
	scope, err := resourcev2.ScopeForAddress(request.Reference.Address, descriptor)
	if err != nil {
		return resourcev2.ReadTarget{}, err
	}
	return resourcev2.ReadTarget{Route: request.Route, Provider: request.Reference.Address.Provider, Authority: request.Reference.Address.Authority, Type: request.Reference.Address.Type, Scope: scope, Representation: request.Representation}, nil
}

func (c *controller) Enumerate(ctx context.Context, pluginID string, input HostEnumerateRequest) (_result HostSourcePage, retErr error) {
	request := input.Request
	ctx, err := c.admit(ctx, "resource.Enumerate", readTarget(pluginID, request.Target))
	if err != nil {
		return _result, err
	}
	defer finishResource(ctx, &retErr)
	if err := validateTargetLabel(input.TargetID); err != nil {
		return _result, err
	}
	if err := resourcev2.ValidateEnumerateRequest(request); err != nil {
		return _result, err
	}
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Target.Route)
	if err != nil {
		return _result, err
	}
	defer cleanup()
	enumerator, ok := provider.(resourcev2.Enumerator)
	if !ok {
		return _result, resourcev2.NewError("UNSUPPORTED", "Enumeration is not supported.")
	}
	ctx, descriptor, err := c.admitOperationCatalog(ctx, pluginID, provider, generation, request.Target.Route, request.Target.Authority, request.Target.Provider, request)
	if err != nil {
		return _result, err
	}
	page, err := enumerator.Enumerate(ctx, request)
	if err != nil {
		c.checkConnectionError(pluginID, err)
		return _result, err
	}
	if err := resourcev2.ValidateOperationResult(request, page, descriptor); err != nil {
		return _result, err
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return _result, err
	}
	out, err := hostPage(ctx, generation, input.TargetID, request.Target, page)
	if err != nil {
		return _result, err
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return _result, err
	}
	return out, nil
}

func (c *controller) NativeQuery(ctx context.Context, pluginID string, input HostNativeQueryRequest) (_result HostSourcePage, retErr error) {
	request := input.Request
	ctx, err := c.admit(ctx, "resource.NativeQuery", readTarget(pluginID, request.Target))
	if err != nil {
		return _result, err
	}
	defer finishResource(ctx, &retErr)
	if err := validateTargetLabel(input.TargetID); err != nil {
		return _result, err
	}
	if err := resourcev2.ValidateNativeQueryRequest(request); err != nil {
		return _result, err
	}
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Target.Route)
	if err != nil {
		return _result, err
	}
	defer cleanup()
	querier, ok := provider.(resourcev2.NativeQuerier)
	if !ok {
		return _result, resourcev2.NewError("UNSUPPORTED", "Native query is not supported.")
	}
	ctx, descriptor, err := c.admitOperationCatalog(ctx, pluginID, provider, generation, request.Target.Route, request.Target.Authority, request.Target.Provider, request)
	if err != nil {
		return _result, err
	}
	if err := resourcev2.ValidateNativeQueryInput(descriptor, request); err != nil {
		return _result, err
	}
	page, err := querier.NativeQuery(ctx, request)
	if err != nil {
		c.checkConnectionError(pluginID, err)
		return _result, err
	}
	if err := resourcev2.ValidateOperationResult(request, page, descriptor); err != nil {
		return _result, err
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return _result, err
	}
	out, err := hostPage(ctx, generation, input.TargetID, request.Target, page)
	if err != nil {
		return _result, err
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return _result, err
	}
	return out, nil
}

func hostPage(ctx context.Context, generation *pluginState, targetID string, target resourcev2.ReadTarget, page resourcev2.SourcePage) (HostSourcePage, error) {
	principal, _ := invocation.FromContext(ctx)
	out := HostSourcePage{Records: make([]HostRecord, 0, len(page.Records)), SourcePage: SourcePageMetadata{NextCursor: page.NextCursor, Count: page.Count, Coverage: page.Coverage, Consistency: page.Consistency, SourceRevision: page.SourceRevision}}
	for _, record := range page.Records {
		if err := ctx.Err(); err != nil {
			return HostSourcePage{}, err
		}
		row, err := envelopeRecord(generation.generationID, principal.Principal().Owner(), targetID, target, record)
		if err != nil {
			return HostSourcePage{}, err
		}
		out.Records = append(out.Records, row)
	}
	return out, nil
}

func (c *controller) Mutate(ctx context.Context, pluginID string, request resourcev2.MutationRequest) (_result resourcev2.Record, retErr error) {
	target := referenceTarget(pluginID, request.Route, request.Reference)
	target.Action = request.Operation
	ctx, err := c.admit(ctx, "resource.Mutate", target)
	if err != nil {
		return _result, err
	}
	defer finishResource(ctx, &retErr)
	if err := resourcev2.ValidateMutationRequest(request); err != nil {
		return _result, err
	}
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Route)
	if err != nil {
		return _result, err
	}
	defer cleanup()
	mutator, ok := provider.(resourcev2.Mutator)
	if !ok {
		return _result, resourcev2.NewError("UNSUPPORTED", "Mutation is not supported.")
	}
	ctx, descriptor, err := c.admitOperationCatalog(ctx, pluginID, provider, generation, request.Route, request.Reference.Address.Authority, request.Reference.Address.Provider, request)
	if err != nil {
		return _result, err
	}
	record, err := mutator.Mutate(ctx, request)
	if err != nil {
		return _result, err
	}
	if err := resourcev2.ValidateOperationResult(request, record, descriptor); err != nil {
		return _result, err
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return _result, err
	}
	return record, nil
}

func (c *controller) Action(ctx context.Context, pluginID string, request resourcev2.ActionRequest) (_result resourcev2.Value, retErr error) {
	target := actionTarget(pluginID, request)
	ctx, err := c.admit(ctx, "resource.Action", target)
	if err != nil {
		return _result, err
	}
	defer finishResource(ctx, &retErr)
	if err := resourcev2.ValidateActionRequest(request); err != nil {
		return _result, err
	}
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Route)
	if err != nil {
		return _result, err
	}
	defer cleanup()
	actioner, ok := provider.(resourcev2.Actioner)
	if !ok {
		return _result, resourcev2.NewError("UNSUPPORTED", "Action is not supported.")
	}
	authority, canonicalProvider := actionIdentity(request)
	ctx, descriptor, err := c.admitOperationCatalog(ctx, pluginID, provider, generation, request.Route, authority, canonicalProvider, request)
	if err != nil {
		return _result, err
	}
	actionDescriptor, err := resourcev2.ResolveActionDescriptor(ctx, provider, request, false)
	if err != nil {
		return _result, err
	}
	request.ExpectedDescriptor = actionDescriptor
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return _result, err
	}
	value, err := actioner.Action(ctx, request)
	if err != nil {
		return _result, err
	}
	if err := resourcev2.ValidateOperationResult(request, value, descriptor); err != nil {
		return _result, err
	}
	if actionDescriptor != nil {
		if err := resourcev2.ValidateActionOutput(*actionDescriptor, value); err != nil {
			return _result, err
		}
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return _result, err
	}
	return value, nil
}
