package resource

import (
	"context"
	"sort"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ReadObservedResource is trusted host wiring, not a plugin-facing body grant.
// The detached root retains immutable source-owned children. Callers may extract
// scalars but must never mutate the tree. Invoke the guard before publishing or
// delivering derived results, including cache hits. It reauthorizes exact Get
// and rejects replaced observations, even when replacement values are equal.
// Prefer the admitted default/native representation, then the catalog-declared
// model representation used by owner views. Within one representation, source
// keys break ties deterministically. Missing model fields stay unavailable;
// arbitrary provider projections are never substituted.
// Missing or stale observations never fall back to an upstream Get.
func (c *controller) ReadObservedResource(ctx context.Context, pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) (_result *resourcev2.Value, _guard func(context.Context) error, retErr error) {
	return c.readObservedResource(ctx, "resource.Get", pluginID, route, reference, nil, false)
}

// GuardObservedReference validates identity against a retained, authorized source
// without reading a resource body or requiring resource.Get. The delivery guard
// retains source authority fences but allows same-incarnation body updates.
func (c *controller) GuardObservedReference(ctx context.Context, operation, pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) (func(context.Context) error, error) {
	_, guard, err := c.readObservedResource(ctx, operation, pluginID, route, reference, nil, true)
	return guard, err
}

func (c *controller) readObservedResource(ctx context.Context, operation, pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference, expected *sourceSession, identityOnly bool) (_result *resourcev2.Value, _guard func(context.Context) error, retErr error) {
	ctx, err := c.admit(ctx, operation, referenceTarget(pluginID, route, reference))
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
	type candidate struct {
		key     string
		session *sourceSession
	}
	candidates := make([]candidate, 0, len(c.sources.sessions))
	for key, session := range c.sources.sessions {
		candidates = append(candidates, candidate{key: key, session: session})
	}
	c.sources.mu.Unlock()
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].key < candidates[j].key })
	representations := []string{request.Representation}
	if descriptor.ModelRepresentation != "" && descriptor.ModelRepresentation != request.Representation {
		representations = append(representations, descriptor.ModelRepresentation)
	}
	if identityOnly {
		// A retained default snapshot and a live model view may disagree after
		// replacement. No representation or source-key ordering can establish
		// which incarnation is current; reject until their identity converges.
		for _, candidate := range candidates {
			session := candidate.session
			session.mu.Lock()
			if session.pluginID != pluginID || session.owner != owner || session.pluginGeneration != generation || session.target.Route != route || session.closed || session.ctx.Err() != nil || !session.hasSnapshot || (session.status.State != "following" && session.status.State != "finished") {
				session.mu.Unlock()
				continue
			}
			member, found := session.members[key]
			record := member.observation.Record
			if !found || (record.Representation.ID != request.Representation && record.Representation.ID != descriptor.ModelRepresentation) {
				session.mu.Unlock()
				continue
			}
			c.pluginsMu.RLock()
			err := c.currentGenerationLocked(session.ctx, pluginID, generation)
			c.pluginsMu.RUnlock()
			matches := sameIncarnation(record.Reference.Incarnation, reference.Incarnation)
			session.mu.Unlock()
			if err != nil {
				return nil, nil, err
			}
			if !matches {
				return nil, nil, resourcev2.NewError("RESET_REQUIRED", "Retained source observations do not agree on the requested incarnation.")
			}
		}
	}
	for _, representation := range representations {
		for _, candidate := range candidates {
			session := candidate.session
			session.mu.Lock()
			if session.pluginID != pluginID || session.owner != owner || session.pluginGeneration != generation || session.target.Route != route || session.closed || session.ctx.Err() != nil || !session.hasSnapshot || (session.status.State != "following" && session.status.State != "finished") {
				session.mu.Unlock()
				continue
			}
			member, found := session.members[key]
			record := member.observation.Record
			if !found || record.Representation.ID != representation {
				session.mu.Unlock()
				continue
			}
			if !sameIncarnation(record.Reference.Incarnation, reference.Incarnation) {
				session.mu.Unlock()
				if identityOnly {
					return nil, nil, resourcev2.NewError("RESET_REQUIRED", "Requested incarnation is not the current source identity.")
				}
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
			var body resourcev2.Value
			if !identityOnly {
				body = record.Body
			}
			sourceGeneration := session.generation
			observationRevision := member.revision
			c.pluginsMu.RUnlock()
			session.mu.Unlock()
			if expected != nil {
				if expected != session {
					return nil, nil, resourcev2.NewError("UNAVAILABLE", "Preferred source observation changed before projection delivery.")
				}
				return &body, nil, nil
			}
			// Retain only identity and fences, never the observed body.
			reference.Address.Scope = append([]resourcev2.ScopeEntry(nil), reference.Address.Scope...)
			if reference.Incarnation != nil {
				token := *reference.Incarnation
				reference.Incarnation = &token
			}
			guard := func(delivery context.Context) (retErr error) {
				delivery, err := c.admit(delivery, operation, referenceTarget(pluginID, route, reference))
				if err != nil {
					return err
				}
				defer finishResource(delivery, &retErr)
				request, _ := invocation.FromContext(delivery)
				if request.Principal().Owner() != owner {
					return resourcev2.NewError("FORBIDDEN", "Observation belongs to another principal.")
				}
				// Reuse the exact admission path without constructing another guard.
				if _, _, err := c.readObservedResource(delivery, operation, pluginID, route, reference, session, identityOnly); err != nil {
					return err
				}
				session.mu.Lock()
				defer session.mu.Unlock()
				current, exists := session.members[key]
				if session.closed || session.ctx.Err() != nil || session.owner != owner || session.pluginGeneration != generation || session.target.Route != route || session.generation != sourceGeneration || !session.hasSnapshot || (session.status.State != "following" && session.status.State != "finished") || !exists || (!identityOnly && current.revision != observationRevision) || !sameIncarnation(current.observation.Record.Reference.Incarnation, reference.Incarnation) {
					return resourcev2.NewError("UNAVAILABLE", "Source observation retired before projection delivery.")
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
			if identityOnly {
				return nil, guard, nil
			}
			return &body, guard, nil
		}
	}
	return nil, nil, resourcev2.NewError("UNAVAILABLE", "No current authorized source observation is available.")
}
