package resource

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Recovery follows surviving authenticated interests. It never reconstructs a
// connection-wide inventory or adds populations from catalog membership.
func (sc *sourceCoordinator) recoverBinding(pluginID, connection string, generation *pluginState, epoch uint64) {
	sc.mu.Lock()
	var candidates []*sourceSession
	for _, s := range sc.sessions {
		if s.pluginID == pluginID && s.target.Route.Connection == connection && sc.hasInterestsLocked(s) {
			candidates = append(candidates, s)
		}
	}
	sc.mu.Unlock()
	for _, s := range candidates {
		sc.recoverBindingSession(s, generation, epoch)
	}
}

func (sc *sourceCoordinator) recoverBindingSession(s *sourceSession, generation *pluginState, epoch uint64) {
	s.mu.Lock()
	sc.mu.Lock()
	sc.ctrl.pluginsMu.RLock()
	current := sc.ctrl.plugins[s.pluginID] == generation && generation.provider != nil && generation.ctx.Err() == nil && generation.sourceEpoch[s.target.Route.Connection] == epoch && !generation.sourceChanging[s.target.Route.Connection]
	if !current || sc.sessions[s.key] != s || s.closed || !sc.hasInterestsLocked(s) {
		sc.ctrl.pluginsMu.RUnlock()
		sc.mu.Unlock()
		s.mu.Unlock()
		return
	}
	if failure, ok := s.ctx.Value(sourceRecoveryFailureKey{}).(sourceRecoveryFailure); ok && failure.epoch == epoch {
		s.ctx = context.WithValue(s.ctx, sourceRecoveryFailureKey{}, nil)
	}
	sc.ctrl.pluginsMu.RUnlock()
	var interests []*sourceInterest
	for _, interest := range sc.interests {
		if !interest.closed && interest.session == s {
			interests = append(interests, interest)
		}
	}
	target, oldCtx, mode := s.target, s.ctx, s.mode
	sc.mu.Unlock()
	s.mu.Unlock()
	ctx := context.WithValue(context.WithoutCancel(oldCtx), sourceEpochKey{}, sourceEpochSnapshot{Connection: target.Route.Connection, Epoch: epoch})
	admission, catalog, err := sc.ctrl.routeCatalog(ctx, s.pluginID, target.Route)
	if err == nil {
		err = sc.observeConnectionPolicies(ctx, s.pluginID, target.Route, catalog, admission)
	}
	if err == nil {
		var authority AuthorityResolution
		authority, err = sc.ctrl.resolveAuthority(ctx, s.pluginID, target.Route, catalog, admission, target.Type)
		if err == nil {
			target.Provider = catalog.Provider
			target.Authority = authority.Authority
		}
	}
	var retired []*sourceInterest
	for _, interest := range interests {
		if err != nil {
			break
		}
		sc.mu.Lock()
		closed := interest.closed
		sc.mu.Unlock()
		if closed {
			continue
		}
		if observed, pinned := interest.ctx.Value(observationKey{}).(Observation); pinned && observed.admission != admission {
			retired = append(retired, interest)
			continue
		}
		// A grant for the former authority or scope cannot silently acquire the
		// replacement. Every original operation must admit the actual target.
		_, err = sc.ctrl.admit(context.WithoutCancel(interest.ctx), interest.operation, readTarget(s.pluginID, target))
	}
	for _, retiredSession := range sc.detachInterests(retired) {
		retiredSession.closeWithoutJoin()
	}
	updates := "none"
	if mode == resourcev2.SourceModeSnapshotAndUpdates {
		updates = "required"
	}
	var opener resourcev2.SourceStreamOpener
	var nextGeneration *pluginState
	var nextCtx context.Context
	var cancel context.CancelFunc
	var nextMode, owner string
	if err == nil {
		opener, nextGeneration, nextCtx, cancel, nextMode, owner, err = sc.prepare(ctx, s.pluginID, target, updates)
	}
	s.mu.Lock()
	sc.mu.Lock()
	sc.ctrl.pluginsMu.RLock()
	current = sc.ctrl.plugins[s.pluginID] == generation && generation.provider != nil && generation.ctx.Err() == nil && generation.sourceEpoch[target.Route.Connection] == epoch && !generation.sourceChanging[target.Route.Connection]
	sc.ctrl.pluginsMu.RUnlock()
	if !current || sc.sessions[s.key] != s || s.closed || !sc.hasInterestsLocked(s) {
		sc.mu.Unlock()
		s.mu.Unlock()
		if cancel != nil {
			cancel()
		}
		return
	}
	if err == nil {
		key := boundSourceKey(s.pluginID, owner, target, nextMode, nextCtx.Value(sourceBindingKey{}).(sourceBinding))
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
		s.ctx = context.WithValue(s.ctx, sourceRecoveryFailureKey{}, sourceRecoveryFailure{epoch: epoch, message: s.status.Error.Message})
	}
	sc.mu.Unlock()
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}
