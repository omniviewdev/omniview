package extensiondiagnostics

import (
	"context"
	"errors"
	"strconv"
	"sync/atomic"
	"testing"
)

func TestServiceRegistrationRequiresInjectedIdentity(t *testing.T) {
	b, _ := brokerFixture(t)
	service := NewService(b)
	if _, err := service.Register(context.Background()); !errors.Is(err, ErrWindow) {
		t.Fatalf("registration without native caller: %v", err)
	}
	if err := service.Unregister(context.Background(), "token"); !errors.Is(err, ErrWindow) {
		t.Fatalf("unregister without native caller: %v", err)
	}
}

func TestRuntimeRegistrationCapacityPrunesClosedWindows(t *testing.T) {
	b, _ := brokerFixture(t)
	var alive atomic.Bool
	alive.Store(true)
	for i := range MaxRuntimes - 1 {
		if _, err := b.register("runtime-"+strconv.Itoa(i), alive.Load); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := b.register("overflow", nil); !errors.Is(err, ErrCapacity) {
		t.Fatalf("unbounded runtime registrations: %v", err)
	}
	alive.Store(false)
	if _, err := b.register("replacement", nil); err != nil {
		t.Fatalf("closed windows exhausted registration capacity: %v", err)
	}
	windows, err := b.Windows(context.Background())
	if err != nil || len(windows) != 2 {
		t.Fatalf("closed windows remained in discovery: %+v %v", windows, err)
	}
}
