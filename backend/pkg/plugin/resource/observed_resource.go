package resource

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ReadObservedResource is trusted host wiring, not a plugin-facing body grant.
// The detached root retains immutable source-owned children. Callers may extract
// scalars but must never mutate the tree. Invoke the guard before publishing or
// delivering derived results, including cache hits. It reauthorizes exact Get
// and rejects replaced observations, even when replacement values are equal.
// Missing or stale observations never fall back to an upstream Get.
func (c *controller) ReadObservedResource(ctx context.Context, pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) (_result *resourcev2.Value, _guard func(context.Context) error, retErr error) {
	return c.readObservedResource(ctx, pluginID, route, reference, true)
}

func (c *controller) readObservedResource(ctx context.Context, pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference, guarded bool) (_result *resourcev2.Value, _guard func(context.Context) error, retErr error) {
	ctx, err := c.admit(ctx, "resource.Get", referenceTarget(pluginID, route, reference))
	if err != nil {
		return nil, nil, err
	}
	defer finishResource(ctx, &retErr)
	request := resourcev2.GetRequest{Route: route, Reference: reference, Representation: "native"}
	if err := resourcev2.ValidateGetRequest(request); err != nil {
		return nil, nil, err
	}
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return nil, nil, err
	}
	defer cleanup()
	ctx, catalog, err := c.admitAncillaryCatalog(ctx, pluginID, provider, generation, route, reference.Address.Type, &reference)
	if err != nil {
		return nil, nil, err
	}
	for _, descriptor := range catalog.Types {
		if descriptor.Type == reference.Address.Type && descriptor.DefaultRepresentation != "" {
			request.Representation = descriptor.DefaultRepresentation
			break
		}
	}
	descriptor, err := resourcev2.AdmitCatalogOperation(catalog, request)
	if err != nil {
		return nil, nil, err
	}
	target, err := exactReadTarget(request, descriptor)
	if err != nil {
		return nil, nil, err
	}
	ctx, err = c.boundary.Reauthorize(ctx, referenceQueryTarget(pluginID, target, reference))
	if err != nil {
		return nil, nil, err
	}
	principal, _ := invocation.FromContext(ctx)
	owner := principal.Principal().Owner()
	key, err := registry.CanonicalAddressKey(reference.Address)
	if err != nil {
		return nil, nil, err
	}
	// Never acquire session.mu under coordinator.mu: rebind/release use the
	// session-before-coordinator lock order.
	c.sources.mu.Lock()
	candidates := make([]*sourceSession, 0, len(c.sources.sessions))
	for _, session := range c.sources.sessions {
		candidates = append(candidates, session)
	}
	c.sources.mu.Unlock()
	for _, session := range candidates {
		session.mu.Lock()
		if session.pluginID != pluginID || session.owner != owner || session.pluginGeneration != generation || session.target.Route != route || session.closed || session.ctx.Err() != nil || !session.hasSnapshot || (session.status.State != "following" && session.status.State != "finished") {
			session.mu.Unlock()
			continue
		}
		member, found := session.members[key]
		record := member.observation.Record
		if !found || !sameIncarnation(record.Reference.Incarnation, reference.Incarnation) || (record.Representation.ID != "native" && record.Representation.ID != descriptor.DefaultRepresentation) {
			session.mu.Unlock()
			continue
		}
		c.pluginsMu.RLock()
		err := c.currentGenerationLocked(ctx, pluginID, generation)
		if err == nil {
			err = c.currentGenerationLocked(session.ctx, pluginID, generation)
		}
		if err == nil && !c.referenceCurrentLocked(pluginID, route, reference) {
			err = resourcev2.NewError("RESET_REQUIRED", "Observation authority retired.")
		}
		if err != nil {
			c.pluginsMu.RUnlock()
			session.mu.Unlock()
			return nil, nil, err
		}
		body := record.Body
		sourceGeneration := session.generation
		observationRevision := member.revision
		c.pluginsMu.RUnlock()
		session.mu.Unlock()
		if !guarded {
			return &body, nil, nil
		}
		// Retain only identity and fences, never the observed body.
		reference.Address.Scope = append([]resourcev2.ScopeEntry(nil), reference.Address.Scope...)
		if reference.Incarnation != nil {
			token := *reference.Incarnation
			reference.Incarnation = &token
		}
		guard := func(delivery context.Context) (retErr error) {
			delivery, err := c.admit(delivery, "resource.Get", referenceTarget(pluginID, route, reference))
			if err != nil {
				return err
			}
			defer finishResource(delivery, &retErr)
			request, _ := invocation.FromContext(delivery)
			if request.Principal().Owner() != owner {
				return resourcev2.NewError("FORBIDDEN", "Observation belongs to another principal.")
			}
			// Reuse the exact admission path without constructing another guard.
			if _, _, err := c.readObservedResource(delivery, pluginID, route, reference, false); err != nil {
				return err
			}
			session.mu.Lock()
			defer session.mu.Unlock()
			current, exists := session.members[key]
			if session.closed || session.ctx.Err() != nil || session.owner != owner || session.pluginGeneration != generation || session.target.Route != route || session.generation != sourceGeneration || !session.hasSnapshot || (session.status.State != "following" && session.status.State != "finished") || !exists || current.revision != observationRevision || !sameIncarnation(current.observation.Record.Reference.Incarnation, reference.Incarnation) {
				return resourcev2.NewError("NOT_OBSERVED", "Source observation retired before projection delivery.")
			}
			c.pluginsMu.RLock()
			defer c.pluginsMu.RUnlock()
			if err := c.currentGenerationLocked(session.ctx, pluginID, generation); err != nil {
				return err
			}
			if !c.referenceCurrentLocked(pluginID, route, reference) {
				return resourcev2.NewError("RESET_REQUIRED", "Observation authority retired.")
			}
			return nil
		}
		return &body, guard, nil
	}
	return nil, nil, resourcev2.NewError("NOT_OBSERVED", "No current authorized source observation is available.")
}
