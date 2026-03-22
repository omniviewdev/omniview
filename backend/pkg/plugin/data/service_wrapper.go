package data

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ServiceWrapper is an explicit delegation wrapper around data.Controller.
type ServiceWrapper struct {
	Ctrl Controller
}

func (s *ServiceWrapper) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if ss, ok := s.Ctrl.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return ss.ServiceStartup(ctx, options)
	}
	return nil
}
func (s *ServiceWrapper) ServiceShutdown() error {
	if ss, ok := s.Ctrl.(interface{ ServiceShutdown() error }); ok {
		return ss.ServiceShutdown()
	}
	return nil
}
func (s *ServiceWrapper) Get(pluginID, key string) (any, error) {
	return s.Ctrl.Get(pluginID, key)
}
func (s *ServiceWrapper) Set(pluginID, key string, value any) error {
	return s.Ctrl.Set(pluginID, key, value)
}
func (s *ServiceWrapper) Delete(pluginID, key string) error {
	return s.Ctrl.Delete(pluginID, key)
}
func (s *ServiceWrapper) Keys(pluginID string) ([]string, error) {
	return s.Ctrl.Keys(pluginID)
}
