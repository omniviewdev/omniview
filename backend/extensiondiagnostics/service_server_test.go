//go:build server

package extensiondiagnostics

import (
	"context"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestServiceRegistrationUsesInjectedBrowserIdentity(t *testing.T) {
	b, _ := brokerFixture(t)
	service := NewService(b)
	ctx := context.WithValue(context.Background(), application.WindowKey, application.NewBrowserWindow(42, "private-client-id"))
	registration, err := service.Register(ctx)
	if err != nil || registration.Pending || registration.WindowName != "browser-42" || registration.Token == "" {
		t.Fatalf("trusted browser identity: %+v %v", registration, err)
	}
	if err := service.Unregister(ctx, registration.Token); err != nil {
		t.Fatal(err)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, exists := b.runtimes["browser-42"]; exists {
		t.Fatal("browser registration remained after unregister")
	}
}

func TestServiceRegistrationWaitsForRealBrowserCaller(t *testing.T) {
	b := NewBroker()
	b.start(func(Request) error { return nil })
	t.Cleanup(b.close)
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
