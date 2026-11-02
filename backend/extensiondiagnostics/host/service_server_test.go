//go:build server

package host

import (
	"context"
	"testing"

	"github.com/omniviewdev/omniview/backend/extensiondiagnostics"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestServiceRegistrationUsesInjectedBrowserIdentity(t *testing.T) {
	b := extensiondiagnostics.NewBroker()
	b.Start(func(extensiondiagnostics.Request) error { return nil })
	t.Cleanup(b.Close)
	service := NewService(b)
	ctx := context.WithValue(context.Background(), application.WindowKey, application.NewBrowserWindow(42, "private-client-id"))
	registration, err := service.Register(ctx)
	if err != nil || registration.Pending || registration.WindowName != "browser-42" || registration.Token == "" {
		t.Fatalf("trusted browser identity: %+v %v", registration, err)
	}
	// Keep the lease live without an application registry so discovery cannot
	// prune the runtime before unregister is checked.
	registration, err = b.RegisterRuntime(registration.WindowName, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Unregister(ctx, registration.Token); err != nil {
		t.Fatal(err)
	}
	windows, err := b.Windows(context.Background())
	if err != nil || len(windows) != 0 {
		t.Fatal("browser registration remained after unregister")
	}
}

func TestServiceRegistrationWaitsForRealBrowserCaller(t *testing.T) {
	b := extensiondiagnostics.NewBroker()
	b.Start(func(extensiondiagnostics.Request) error { return nil })
	t.Cleanup(b.Close)
	service := NewService(b)
	ctx := context.WithValue(context.Background(), application.WindowKey, &application.WebviewWindow{})
	registration, err := service.Register(ctx)
	if err != nil || !registration.Pending || registration.WindowName != "" || registration.Token != "" {
		t.Fatalf("virtual native caller received a lease: %+v %v", registration, err)
	}
	windows, err := b.Windows(context.Background())
	if err != nil || len(windows) != 0 {
		t.Fatalf("pending registration published a runtime: %+v %v", windows, err)
	}
}
