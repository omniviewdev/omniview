package host

import (
	"context"

	"github.com/omniviewdev/omniview/internal/diagnostics"
)

// Service exposes the native-free diagnostics service to Wails.
type Service struct {
	core   *diagnostics.Service
	server *diagnostics.HTTPServer
}

func NewService(core *diagnostics.Service, server *diagnostics.HTTPServer) *Service {
	return &Service{core: core, server: server}
}
func (s *Service) GetCatalog() diagnostics.Catalog            { return s.core.GetCatalog() }
func (s *Service) GetSnapshot() diagnostics.Snapshot          { return s.core.GetSnapshot() }
func (s *Service) GetHistory() diagnostics.History            { return s.core.GetHistory() }
func (s *Service) ListCaptures() []diagnostics.CaptureSummary { return s.core.ListCaptures() }
func (s *Service) StartCapture(request diagnostics.CaptureRequest) (diagnostics.Capture, error) {
	return s.core.StartCapture(request)
}
func (s *Service) GetCapture(id string) (diagnostics.Capture, error) { return s.core.GetCapture(id) }

// DeleteCapture removes a finished capture so its slot and storage can be reused.
func (s *Service) DeleteCapture(id string) error { return s.core.DeleteCapture(id) }

func (s *Service) CancelCapture(id string) (diagnostics.Capture, error) {
	return s.core.CancelCapture(id)
}
func (s *Service) CompareCaptures(baseline, candidate string) (diagnostics.Comparison, error) {
	return s.core.CompareCaptures(baseline, candidate)
}
func (s *Service) ServiceShutdown(context.Context) error {
	if s.server != nil {
		return s.server.Close()
	}
	return nil
}
