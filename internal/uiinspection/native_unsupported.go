//go:build !darwin || server || !cgo

package uiinspection

func (s *Service) installPolicy() {}

func (s *Service) getStatus(windowName string) Status {
	return Status{Window: windowName}
}
