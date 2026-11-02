package extensiondiagnostics

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Service exposes only correlated responses, never evaluation or mutation.
type Service struct {
	broker *Broker
}

func NewService(broker *Broker) *Service {
	return &Service{broker: broker}
}

func (s *Service) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	app := application.Get()
	if app == nil {
		return nil
	}
	s.broker.start(func(request Request) error {
		if app.Event.Emit(RequestEvent, request) {
			return ErrUnavailable
		}
		return nil
	})
	return nil
}

func (s *Service) ServiceShutdown() error {
	s.broker.close()
	return nil
}

// Register takes its identity exclusively from the injected native/browser caller.
func (s *Service) Register(ctx context.Context) (Registration, error) {
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok {
		return Registration{}, ErrWindow
	}
	if registrationPending(window) {
		return Registration{Pending: true}, nil
	}
	alive := func() bool {
		if browser, ok := window.(interface{ ClientID() string }); ok {
			current := application.GetBrowserWindow(browser.ClientID())
			return current != nil && current.Name() == window.Name()
		}
		app := application.Get()
		if app == nil {
			return false
		}
		current, exists := app.Window.GetByName(window.Name())
		return exists && current.ID() == window.ID()
	}
	return s.broker.register(window.Name(), alive)
}

func (s *Service) Unregister(ctx context.Context, token string) error {
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok {
		return ErrWindow
	}
	s.broker.unregister(window.Name(), token)
	return nil
}

// Respond verifies the native caller identity, not just its claimed window.
// Wails injects context without adding an argument to the generated binding.
func (s *Service) Respond(ctx context.Context, requestID, windowName, payload, errorMessage string) error {
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok || window.Name() != windowName {
		return ErrWindow
	}
	return s.broker.respond(requestID, windowName, payload, errorMessage)
}
