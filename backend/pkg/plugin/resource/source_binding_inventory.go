package resource

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// reconcileBindingInventory retains old interests until every new eager target
// has been acquired, then removes only interests absent from the new catalog.
func (sc *sourceCoordinator) reconcileBindingInventory(ctx context.Context, pluginID string, route resourcev2.AccessRoute, generation *pluginState, epoch uint64, catalog resourcev2.Catalog, admission catalogAdmission, old []*sourceSession) {
	var targets []resourcev2.ReadTarget
	for _, descriptor := range catalog.Types {
		if !descriptor.AcquireOnConnect || descriptor.DefaultRepresentation == "" {
			continue
		}
		for _, capability := range descriptor.Capabilities {
			if capability.Operation != resourcev2.OperationSourceUpdates {
				continue
			}
			authority, err := sc.ctrl.resolveAuthority(ctx, pluginID, route, catalog, admission, descriptor.Type)
			if err != nil {
				return
			}
			targets = append(targets, resourcev2.ReadTarget{Route: route, Provider: catalog.Provider, Authority: authority.Authority, Type: descriptor.Type, Scope: capability.Scope, Representation: descriptor.DefaultRepresentation})
		}
	}
	if err := sc.ctrl.startConnectionUpdates(ctx, pluginID, route); err != nil {
		return
	}

	var closing []*sourceSession
	sc.mu.Lock()
	for _, s := range old {
		s.mu.Lock()
		sc.ctrl.pluginsMu.RLock()
		current := sc.ctrl.plugins[pluginID] == generation && generation.provider != nil && generation.ctx.Err() == nil && generation.sourceEpoch[route.Connection] == epoch && !generation.sourceChanging[route.Connection]
		sc.ctrl.pluginsMu.RUnlock()
		if !current || sc.sessions[s.key] != s || s.closed {
			s.mu.Unlock()
			continue
		}
		keep := false
		for _, target := range targets {
			if sourceKey(pluginID, s.owner, target, resourcev2.SourceModeSnapshotAndUpdates) == s.key {
				keep = true
				break
			}
		}
		if !keep {
			s.inventory = false
			if len(s.views) == 0 && s.reservations == 0 {
				delete(sc.sessions, s.key)
				closing = append(closing, s)
			}
		}
		s.mu.Unlock()
	}
	sc.mu.Unlock()
	sc.closeSessions(closing)
}
