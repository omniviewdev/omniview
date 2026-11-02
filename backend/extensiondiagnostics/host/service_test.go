package host

import (
	"context"
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/backend/extensiondiagnostics"
)

func TestServiceRegistrationRequiresInjectedIdentity(t *testing.T) {
	b := extensiondiagnostics.NewBroker()
	service := NewService(b)
	if _, err := service.Register(context.Background()); !errors.Is(err, extensiondiagnostics.ErrWindow) {
		t.Fatalf("registration without native caller: %v", err)
	}
	if err := service.Unregister(context.Background(), "token"); !errors.Is(err, extensiondiagnostics.ErrWindow) {
		t.Fatalf("unregister without native caller: %v", err)
	}
	if err := service.Respond(context.Background(), "request", "main", "", ""); !errors.Is(err, extensiondiagnostics.ErrWindow) {
		t.Fatalf("response without native caller: %v", err)
	}
}
