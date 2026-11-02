package resource

// retryBinding re-acquires a failed session whose route epoch has retired.
// A current session uses the ordinary refresh path instead.
func (sc *sourceCoordinator) retryBinding(s *sourceSession) bool {
	s.mu.Lock()
	pluginID, connection, generation, ctx := s.pluginID, s.target.Route.Connection, s.pluginGeneration, s.ctx
	s.mu.Unlock()
	captured, ok := ctx.Value(sourceEpochKey{}).(sourceEpochSnapshot)
	if !ok {
		return false
	}
	sc.ctrl.pluginsMu.RLock()
	current := sc.ctrl.plugins[pluginID]
	if current != generation || current == nil || current.provider == nil || current.ctx.Err() != nil || current.sourceChanging[connection] {
		sc.ctrl.pluginsMu.RUnlock()
		return false
	}
	epoch := current.sourceEpoch[connection]
	sc.ctrl.pluginsMu.RUnlock()
	if captured.Epoch == epoch {
		return false
	}
	go sc.recoverBinding(pluginID, connection, generation, epoch)
	return true
}
