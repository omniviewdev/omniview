package settings

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Lifecycle registers plugin settings startup and shutdown without exposing
// trusted controller operations as public Wails methods.
type Lifecycle struct {
	Ctrl Controller
}

func (s *Lifecycle) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return s.Ctrl.ServiceStartup(ctx, options)
}

func (s *Lifecycle) ServiceShutdown() error {
	return s.Ctrl.ServiceShutdown()
}
