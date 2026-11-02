package resource

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// recoverBinding replaces retired route work without changing frontend view IDs.
// Catalog and authority acquisition run outside coordinator and session locks.
func (sc *sourceCoordinator) recoverBinding(pluginID, connection string, generation *pluginState, epoch uint64) {
	sc.ctrl.pluginsMu.RLock()
	current := sc.ctrl.plugins[pluginID] == generation && generation.provider != nil && generation.ctx.Err() == nil && generation.sourceEpoch[connection] == epoch && !generation.sourceChanging[connection]
	sc.ctrl.pluginsMu.RUnlock()
	if !current {
		return
	}
	sc.mu.Lock()
	var sessions []*sourceSession
	var oldInventory []*sourceSession
	var inventoryCtx context.Context
	for _, s := range sc.sessions {
		s.mu.Lock()
		captured, ok := s.ctx.Value(sourceEpochKey{}).(sourceEpochSnapshot)
		if s.pluginID == pluginID && s.target.Route.Connection == connection && s.pluginGeneration == generation && ok && captured.Epoch < epoch {
			sessions = append(sessions, s)
			if s.inventory {
				oldInventory = append(oldInventory, s)
				if inventoryCtx == nil {
					inventoryCtx = context.WithValue(context.WithoutCancel(s.ctx), sourceEpochKey{}, sourceEpochSnapshot{Connection: connection, Epoch: epoch})
				}
			}
		}
		s.mu.Unlock()
	}
	sc.mu.Unlock()

	for _, s := range sessions {
		sc.recoverBindingSession(s, generation, epoch)
	}
	if inventoryCtx != nil {
		route := resourcev2.AccessRoute{Connection: connection}
		catalog, observation, err := sc.ctrl.ObserveCatalog(inventoryCtx, pluginID, route)
		if err == nil && observation.admission.generation == generation && observation.admission.epoch.Epoch == epoch {
			ctx := WithObservation(inventoryCtx, observation)
			sc.reconcileBindingInventory(ctx, pluginID, route, generation, epoch, catalog, observation.admission, oldInventory)
		}
	}
}

func (sc *sourceCoordinator) recoverBindingSession(s *sourceSession, generation *pluginState, epoch uint64) {
	s.mu.Lock()
	target, oldCtx, mode := s.target, s.ctx, s.mode
	s.mu.Unlock()
	ctx := context.WithValue(context.WithoutCancel(oldCtx), sourceEpochKey{}, sourceEpochSnapshot{Connection: target.Route.Connection, Epoch: epoch})
	admission, catalog, err := sc.ctrl.routeCatalog(ctx, s.pluginID, target.Route)
	if err == nil {
		var authority AuthorityResolution
		authority, err = sc.ctrl.resolveAuthority(ctx, s.pluginID, target.Route, catalog, admission, target.Type)
		if err == nil {
			target.Provider = catalog.Provider
			target.Authority = authority.Authority
		}
	}
	updates := "none"
	if mode == resourcev2.SourceModeSnapshotAndUpdates {
		updates = "ifSupported"
	}
	var opener resourcev2.SourceStreamOpener
	var nextGeneration *pluginState
	var nextCtx context.Context
	var cancel context.CancelFunc
	var nextMode, owner string
	if err == nil {
		opener, nextGeneration, nextCtx, cancel, nextMode, owner, err = sc.prepare(ctx, s.pluginID, target, updates)
	}

	sc.mu.Lock()
	s.mu.Lock()
	sc.ctrl.pluginsMu.RLock()
	current := sc.ctrl.plugins[s.pluginID] == generation && generation.provider != nil && generation.ctx.Err() == nil && generation.sourceEpoch[target.Route.Connection] == epoch && !generation.sourceChanging[target.Route.Connection]
	if !current || sc.sessions[s.key] != s || s.closed {
		sc.ctrl.pluginsMu.RUnlock()
		s.mu.Unlock()
		sc.mu.Unlock()
		if cancel != nil {
			cancel()
		}
		return
	}
	sc.ctrl.pluginsMu.RUnlock()
	if err == nil {
		key := sourceKey(s.pluginID, owner, target, nextMode)
		if existing := sc.sessions[key]; existing != nil && existing != s {
			err = resourcev2.NewError("RESET_REQUIRED", "A source session already exists for the new binding.")
		} else {
			delete(sc.sessions, s.key)
			s.key = key
			sc.sessions[key] = s
			s.rebindLocked(target, opener, nextGeneration, nextCtx, cancel, nextMode)
			cancel = nil
		}
	}
	if err != nil {
		s.rebindFailedLocked(err)
	}
	empty := !s.inventory && len(s.views) == 0 && s.reservations == 0
	if empty && sc.sessions[s.key] == s {
		delete(sc.sessions, s.key)
	}
	s.mu.Unlock()
	sc.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if empty {
		go s.close()
	}
}
