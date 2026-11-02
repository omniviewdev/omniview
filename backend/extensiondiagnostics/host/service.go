// Package host adapts the pure diagnostics broker to authenticated Wails callers.
package host

import (
	"context"

	"github.com/omniviewdev/omniview/backend/extensiondiagnostics"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Service exposes only correlated responses, never evaluation or mutation.
type Service struct {
	broker *extensiondiagnostics.Broker
}

func NewService(broker *extensiondiagnostics.Broker) *Service {
	return &Service{broker: broker}
}

func (s *Service) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	app := application.Get()
	if app == nil {
		return nil
	}
	s.broker.Start(func(request extensiondiagnostics.Request) error {
		if app.Event.Emit(extensiondiagnostics.RequestEvent, request) {
			return extensiondiagnostics.ErrUnavailable
		}
		return nil
	})
	return nil
}

func (s *Service) ServiceShutdown() error {
	s.broker.Close()
	return nil
}

// Register takes its identity exclusively from the injected native/browser caller.
func (s *Service) Register(ctx context.Context) (extensiondiagnostics.Registration, error) {
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok {
		return extensiondiagnostics.Registration{}, extensiondiagnostics.ErrWindow
	}
	if registrationPending(window) {
		return extensiondiagnostics.Registration{Pending: true}, nil
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
	return s.broker.RegisterRuntime(window.Name(), alive)
}

func (s *Service) Unregister(ctx context.Context, token string) error {
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok {
		return extensiondiagnostics.ErrWindow
	}
	s.broker.UnregisterRuntime(window.Name(), token)
	return nil
}

// Respond verifies the native caller identity, not just its claimed window.
// Wails injects context without adding an argument to the generated binding.
func (s *Service) Respond(ctx context.Context, requestID, windowName, payload, errorMessage string) error {
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok || window.Name() != windowName {
		return extensiondiagnostics.ErrWindow
	}
	return s.broker.Respond(requestID, windowName, payload, errorMessage)
}
