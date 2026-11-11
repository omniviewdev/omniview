package resource

import (
	"context"
	"crypto/sha256"
	"encoding/json"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Only actual provider advertisements create native connection-lifetime work.
// This is not a fallback for a denied client request and is never used by graph.
func (c *controller) startConnectionUpdatesAfterReady(pluginID string, route resourcev2.AccessRoute) {
	_, generation, work, cleanup, err := c.operationGeneration(invocation.HostContext(context.Background()), pluginID, route)
	if err != nil {
		return
	}
	go func() {
		defer cleanup()
		if err := c.startConnectionUpdates(work, pluginID, route); err != nil && c.currentGeneration(work, pluginID, generation) == nil {
			c.logger.Warnw(work, "Explicit connection source acquisition failed", "pluginID", pluginID, "connectionID", route.Connection, "errorClass", telemetryutil.ErrorClass(err))
		}
	}()
}

func (c *controller) startConnectionUpdates(ctx context.Context, pluginID string, route resourcev2.AccessRoute) error {
	ctx, err := c.admit(ctx, "resource.Catalog", invocation.Target{Provider: pluginID, Connection: route.Connection})
	if err != nil {
		return err
	}
	request, _ := invocation.FromContext(ctx)
	if request.Principal().Origin() != invocation.Host {
		return resourcev2.NewError("FORBIDDEN", "Connection source policy requires native lifecycle ownership.")
	}
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return err
	}
	features, err := c.providerFeatures(ctx, pluginID, provider)
	if err != nil || !features.Has(resourcev2.FeatureSourceSessions) {
		return err
	}
	admission, catalog, err := c.routeCatalog(ctx, pluginID, route)
	if err != nil {
		return err
	}
	if err := c.currentGeneration(ctx, pluginID, admission.generation); err != nil {
		return err
	}
	encoded, err := json.Marshal(catalog)
	if err != nil {
		return err
	}
	ctx = WithObservation(ctx, Observation{admission: admission, plugin: pluginID, route: route, digest: sha256.Sum256(encoded)})
	wanted := make(map[string]struct{})
	var first error
	for _, descriptor := range catalog.Types {
		if !descriptor.AcquireOnConnect || descriptor.DefaultRepresentation == "" {
			continue
		}
		for _, capability := range descriptor.Capabilities {
			if capability.Operation != resourcev2.OperationSourceUpdates {
				continue
			}
			authority, err := c.resolveAuthority(ctx, pluginID, route, catalog, admission, descriptor.Type)
			if err != nil {
				return err
			}
			target := resourcev2.ReadTarget{Route: route, Provider: catalog.Provider, Authority: authority.Authority, Type: descriptor.Type, Scope: capability.Scope, Representation: descriptor.DefaultRepresentation}
			admitted, err := c.admit(ctx, "resource.OpenSourceView", readTarget(pluginID, target))
			if err != nil {
				c.sources.connectionInterestFailure(pluginID, route, descriptor.Type, err)
				if first == nil {
					first = err
				}
				continue
			}
			owner, _ := invocation.FromContext(admitted)
			key := recoveringSourceKey(pluginID, owner.Principal().Owner(), target)
			if _, exists := wanted[key]; !exists && len(wanted) >= maxSourceViews {
				return resourcev2.NewError("RESOURCE_LIMIT", "Connection source policy interest limit reached.")
			}
			wanted[key] = struct{}{}
			interest, err := c.sources.acquire(admitted, pluginID, target, "required")
			if err != nil {
				c.sources.connectionInterestFailure(pluginID, route, descriptor.Type, err)
				if first == nil {
					first = err
				}
				continue
			}
			c.sources.mu.Lock()
			existing := c.sources.connectionInterests[key]
			retained := !interest.closed && (existing == nil || existing.session != interest.session)
			if retained {
				c.sources.connectionInterests[key] = interest
			}
			c.sources.mu.Unlock()
			if retained {
				c.sources.releaseInterest(existing)
			} else {
				c.sources.releaseInterest(interest)
			}
		}
	}
	if catalog.Coverage.Kind == "complete" {
		c.sources.mu.Lock()
		c.pluginsMu.RLock()
		current := c.currentGenerationLocked(ctx, pluginID, admission.generation) == nil && admission.epoch.Epoch == admission.generation.sourceEpoch[route.Connection]
		var retired []*sourceInterest
		if current {
			for key, interest := range c.sources.connectionInterests {
				if s := interest.session; s != nil && s.pluginID == pluginID && s.target.Route == route {
					if _, keep := wanted[key]; !keep {
						delete(c.sources.connectionInterests, key)
						retired = append(retired, interest)
					}
				}
			}
		}
		c.pluginsMu.RUnlock()
		c.sources.mu.Unlock()
		c.sources.releaseInterests(retired)
	}
	return first
}

// Observe only support already acquired by source admission/recovery. There is
// no IO or acquisition here. A receiving session must not join its own teardown.
func (sc *sourceCoordinator) observeConnectionPolicies(ctx context.Context, pluginID string, route resourcev2.AccessRoute, catalog resourcev2.Catalog, admission catalogAdmission) error {
	if catalog.Coverage.Kind != "complete" {
		return nil
	}
	sc.mu.Lock()
	if len(sc.connectionInterests) == 0 {
		sc.mu.Unlock()
		return nil
	}
	binding, err := resourcev2.CatalogBindingEpoch(catalog.Revision)
	if err != nil {
		sc.mu.Unlock()
		return err
	}
	sc.ctrl.pluginsMu.RLock()
	current := sc.ctrl.currentGenerationLocked(ctx, pluginID, admission.generation) == nil && admission.generation != nil && admission.generation.sourceEpoch[route.Connection] == admission.epoch.Epoch && admission.generation.catalogBindings[route.Connection].active == binding
	var retired []*sourceInterest
	if current {
		for key, interest := range sc.connectionInterests {
			s := interest.session
			if s == nil || s.pluginID != pluginID || s.target.Route != route {
				continue
			}
			keep := false
			for _, descriptor := range catalog.Types {
				if descriptor.Type == s.target.Type && descriptor.AcquireOnConnect {
					_, err := resourcev2.AdmitCatalogOperation(catalog, s.target)
					keep = err == nil
					break
				}
			}
			if !keep {
				delete(sc.connectionInterests, key)
				retired = append(retired, interest)
			}
		}
	}
	sc.ctrl.pluginsMu.RUnlock()
	sc.mu.Unlock()
	for _, session := range sc.detachInterests(retired) {
		session.closeWithoutJoin()
	}
	return ctx.Err()
}

func (sc *sourceCoordinator) connectionInterestFailure(pluginID string, route resourcev2.AccessRoute, kind string, err error) {
	status := HostSourceStatus{State: "failed", Error: &resourcev2.ResourceOperationError{Code: resourcev2.ErrorCode(err), Message: "Explicit connection source acquisition failed."}}
	sc.stateMu.Lock()
	if sc.policyFailures == nil {
		sc.policyFailures = make(map[sourceStateKey]HostSourceStatus)
	}
	key := sourceStateKey{pluginID: pluginID, route: route, kind: kind}
	if _, exists := sc.policyFailures[key]; !exists && len(sc.policyFailures) >= maxSourceViews {
		sc.stateMu.Unlock()
		return
	}
	sc.policyFailures[key] = status
	sc.stateMu.Unlock()
	if emitter := sc.ctrl.emitter; emitter != nil {
		event := HostSourceStateEvent{PluginID: pluginID, Route: route, Type: kind, Status: status}
		emitter.Emit(pluginID+"/"+route.Connection+"/source/STATE", event)
		emitter.Emit(EventSourceState, event)
	}
}
