package resource

// fenceStoppedRoute runs under profilesMu and prevents discovery during native
// stop. Retirement precedes source IO, so failed stop cannot revive old ads.
func (c *controller) fenceStoppedRoute(pluginID, connection string) (func(), error) {
	c.pluginsMu.Lock()
	generation := c.plugins[pluginID]
	if err := c.invalidateSourceRoutesLocked(pluginID, []string{connection}, false); err != nil {
		c.pluginsMu.Unlock()
		return nil, err
	}
	if generation.sourceChanging == nil {
		generation.sourceChanging = make(map[string]bool)
	}
	generation.sourceChanging[connection] = true
	c.pluginsMu.Unlock()
	return func() { c.pluginsMu.Lock(); delete(generation.sourceChanging, connection); c.pluginsMu.Unlock() }, nil
}
