package pluginlog

// ServiceWrapper exposes only frontend-safe methods of pluginlog.Manager.
// Excludes OnEmit (EmitFunc type), Stream (io.Writer), Close, LogDir.
type ServiceWrapper struct {
	Mgr *Manager
}

func (s *ServiceWrapper) GetLogs(pluginID string, count int) []LogEntry {
	return s.Mgr.GetLogs(pluginID, count)
}
func (s *ServiceWrapper) ListStreams() []string {
	return s.Mgr.ListStreams()
}
func (s *ServiceWrapper) SearchLogs(pluginID, pattern string) ([]LogEntry, error) {
	return s.Mgr.SearchLogs(pluginID, pattern)
}
func (s *ServiceWrapper) Subscribe(pluginID string) int {
	return s.Mgr.Subscribe(pluginID)
}
func (s *ServiceWrapper) Unsubscribe(pluginID string) int {
	return s.Mgr.Unsubscribe(pluginID)
}
