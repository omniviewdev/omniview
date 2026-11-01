//go:build !darwin || server || !cgo

package processinfo

func (s *Service) nativeWindows() []Window {
	windows := []Window{}
	if s.app == nil {
		return windows
	}
	for _, window := range s.app.Window.GetAll() {
		windows = append(windows, Window{
			Name: window.Name(), ID: window.ID(), Ownership: "unverified",
			Error: "Native window ownership mapping is unsupported on this platform",
		})
	}
	return windows
}
