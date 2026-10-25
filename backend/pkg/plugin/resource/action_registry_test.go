package resource

import (
	"context"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
)

type controlledActionTimer struct {
	stopped bool
	fn      func()
}

func (timer *controlledActionTimer) Stop() bool {
	was := !timer.stopped
	timer.stopped = true
	return was
}

func TestActionRegistryExpiryReleasesOwnershipAndWork(t *testing.T) {
	registry := newActionRegistry()
	var timers []*controlledActionTimer
	registry.afterFunc = func(_ time.Duration, fn func()) actionTimer {
		timer := &controlledActionTimer{fn: fn}
		timers = append(timers, timer)
		return timer
	}
	scope := invocation.NewScope(invocation.TrustedUI)
	ctx, err := invocation.NewBoundary(nil).Admit(scope.Context(context.Background()), "resource.StreamAction", invocation.Target{Provider: "container"})
	if err != nil {
		t.Fatal(err)
	}
	request, _ := invocation.FromContext(ctx)
	canceled := false
	reservation, err := registry.reserve(request, func() { canceled = true })
	if err != nil {
		t.Fatal(err)
	}
	handle, err := registry.commit(reservation, ctx)
	if err != nil {
		t.Fatal(err)
	}
	if actionCount(registry) != 1 {
		t.Fatal("accepted stream not retained")
	}
	timers[0].fn()
	if !canceled || actionCount(registry) != 0 {
		t.Fatal("unattached expiry leaked state/work")
	}
	if _, err := registry.owned(scope.Context(context.Background()), handle.id); err == nil {
		t.Fatal("expired handle remained usable")
	}
}

func TestActionRegistryForeignAccessDoesNotReleaseOwner(t *testing.T) {
	registry := newActionRegistry()
	ctx, err := invocation.NewBoundary(nil).Admit(testInvocationContext(), "resource.StreamAction", invocation.Target{Provider: "flat"})
	if err != nil {
		t.Fatal(err)
	}
	request, _ := invocation.FromContext(ctx)
	reservation, err := registry.reserve(request, func() {})
	if err != nil {
		t.Fatal(err)
	}
	handle, err := registry.commit(reservation, ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer registry.stopAll()
	foreign := invocation.NewScope(invocation.TrustedUI).Context(context.Background())
	if _, err = registry.owned(foreign, handle.id); err == nil {
		t.Fatal("foreign owner acquired handle")
	}
	if actionCount(registry) != 1 {
		t.Fatal("foreign access changed owner state")
	}
}

func TestActionQuotaCountsPendingAndReleasesFailedOpens(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := resourcetest.NewTestProvider(t)
	started := make(chan struct{}, 33)
	provider.StreamActionFunc = func(ctx context.Context, _ string, _ string, _ resource.ActionInput, _ chan<- resource.ActionEvent) error {
		started <- struct{}{}
		<-ctx.Done()
		return ctx.Err()
	}
	registerMockPlugin(ctrl, "flat", setupGRPCProvider(t, provider))
	owner := invocation.NewScope(invocation.TrustedUI)
	var cancels []context.CancelFunc
	done := make(chan error, 33)
	opened, drained := 0, 0
	t.Cleanup(func() {
		for _, cancel := range cancels {
			cancel()
		}
		for drained < opened {
			select {
			case <-done:
				drained++
			case <-time.After(time.Second):
				t.Error("pending native open did not cancel")
				return
			}
		}
	})
	open := func() {
		ctx, cancel := context.WithCancel(owner.Context(context.Background()))
		cancels = append(cancels, cancel)
		opened++
		go func() {
			_, err := ctrl.StreamAction(ctx, "flat", "route", "opaque", "start", resource.ActionInput{})
			done <- err
		}()
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("native pending open did not start")
		}
	}
	for range 32 {
		open()
	}
	id, err := ctrl.StreamAction(owner.Context(context.Background()), "flat", "route", "opaque", "start", resource.ActionInput{})
	if id != "" || requireAppError(t, err).Code != "RESOURCE_LIMIT" {
		t.Fatal("public pending quota was bypassed")
	}
	cancels[0]()
	select {
	case err := <-done:
		drained++
		if requireAppError(t, err).Code != "CANCELLED" {
			t.Fatal("failed open lost cancellation")
		}
	case <-time.After(time.Second):
		t.Fatal("failed open retained reservation")
	}
	open()
}

func TestTerminalSnapshotCannotBecomeLateLifetimeTimeout(t *testing.T) {
	registry := newActionRegistry()
	defer registry.stopAll()
	var timers []*controlledActionTimer
	registry.afterFunc = func(_ time.Duration, fn func()) actionTimer {
		timer := &controlledActionTimer{fn: fn}
		timers = append(timers, timer)
		return timer
	}
	ctx, err := invocation.NewBoundary(nil).Admit(testInvocationContext(), "resource.StreamAction", invocation.Target{Provider: "flat"})
	if err != nil {
		t.Fatal(err)
	}
	request, _ := invocation.FromContext(ctx)
	reservation, err := registry.reserve(request, func() {})
	if err != nil {
		t.Fatal(err)
	}
	handle, err := registry.commit(reservation, ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = registry.attach(ctx, handle.id); err != nil {
		t.Fatal(err)
	}
	registry.update(handle, ActionEventDTO{Type: "complete"}, true)
	timers[1].fn()
	snapshot, err := registry.attach(ctx, handle.id)
	if err != nil || snapshot.Event.Type != "complete" || !snapshot.Terminal {
		t.Fatal("late lifetime timer overwrote or removed terminal result")
	}
	timers[2].fn()
	if actionCount(registry) != 0 {
		t.Fatal("terminal retention leaked state")
	}
}

func TestSuccessfulAttachSurvivesAlreadyStartedAttachmentExpiry(t *testing.T) {
	registry := newActionRegistry()
	defer registry.stopAll()
	var timers []*controlledActionTimer
	registry.afterFunc = func(_ time.Duration, fn func()) actionTimer {
		timer := &controlledActionTimer{fn: fn}
		timers = append(timers, timer)
		return timer
	}
	ctx, err := invocation.NewBoundary(nil).Admit(testInvocationContext(), "resource.StreamAction", invocation.Target{Provider: "flat"})
	if err != nil {
		t.Fatal(err)
	}
	request, _ := invocation.FromContext(ctx)
	producer, cancel := context.WithCancel(context.Background())
	defer cancel()
	reservation, err := registry.reserve(request, cancel)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := registry.commit(reservation, producer)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = registry.attach(ctx, handle.id); err != nil {
		t.Fatal(err)
	}
	// AfterFunc may already have started: Stop cannot prevent this stale callback.
	timers[0].fn()
	if _, err = registry.owned(ctx, handle.id); err != nil {
		t.Fatal("stale attachment callback removed an attached handle")
	}
	if producer.Err() != nil {
		t.Fatal("stale attachment callback cancelled accepted work")
	}
	registry.update(handle, ActionEventDTO{Type: "complete"}, true)
	timers[len(timers)-1].fn()
	if actionCount(registry) != 0 {
		t.Fatal("attachment guard disabled legitimate terminal retention expiry")
	}
}

func TestActionDispatchFencedAcrossOverlappingRemovalAndShutdown(t *testing.T) {
	for _, scenario := range []string{"cancel then service stop", "plugin then service stop", "timeout then service stop"} {
		t.Run(scenario, func(t *testing.T) {
			registry := newActionRegistry()
			t.Cleanup(registry.stopAll)
			ctx, err := invocation.NewBoundary(nil).Admit(testInvocationContext(), "resource.StreamAction", invocation.Target{Provider: "flat"})
			if err != nil {
				t.Fatal(err)
			}
			request, _ := invocation.FromContext(ctx)
			producer, cancel := context.WithCancel(context.Background())
			defer cancel()
			reservation, err := registry.reserve(request, cancel)
			if err != nil {
				t.Fatal(err)
			}
			handle, err := registry.commit(reservation, producer)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = registry.attach(ctx, handle.id); err != nil {
				t.Fatal(err)
			}
			dispatching, gate := make(chan struct{}), make(chan struct{})
			var once sync.Once
			release := func() { once.Do(func() { close(gate) }) }
			t.Cleanup(release)
			var emitted atomic.Int32
			registry.emit = func(string, ActionSnapshot) {
				close(dispatching)
				<-gate
				emitted.Add(1)
			}
			dispatched := make(chan struct{})
			go func() {
				if scenario == "timeout then service stop" {
					registry.expire(handle, true)
				} else {
					registry.update(handle, ActionEventDTO{Type: "progress"}, false)
				}
				close(dispatched)
			}()
			select {
			case <-dispatching:
			case <-time.After(time.Second):
				t.Fatal("dispatch did not start")
			}
			first := make(chan error, 1)
			if scenario == "cancel then service stop" {
				go func() { first <- registry.cancelOwned(ctx, handle.id) }()
			} else if scenario == "plugin then service stop" {
				go func() { registry.stopPlugin("flat"); first <- nil }()
			} else {
				first <- nil
			}
			select {
			case <-producer.Done():
			case <-time.After(time.Second):
				t.Fatal("removal did not cancel producer")
			}
			stopped := make(chan struct{})
			go func() { registry.stopAll(); close(stopped) }()
			deadline := time.After(time.Second)
			for {
				registry.mu.Lock()
				stopping := registry.closed
				registry.mu.Unlock()
				if stopping {
					break
				}
				select {
				case <-deadline:
					t.Fatal("service stop did not enter")
				default:
					runtime.Gosched()
				}
			}
			select {
			case <-stopped:
				t.Fatal("overlapping service stop missed a still-delivering handle")
			case <-time.After(20 * time.Millisecond):
			}
			release()
			select {
			case err = <-first:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("first removal did not finish")
			}
			select {
			case <-stopped:
			case <-time.After(time.Second):
				t.Fatal("service stop did not finish")
			}
			select {
			case <-dispatched:
			case <-time.After(time.Second):
				t.Fatal("dispatch did not finish")
			}
			registry.update(handle, ActionEventDTO{Type: "progress"}, false)
			if emitted.Load() != 1 || actionCount(registry) != 0 {
				t.Fatal("completed shutdown allowed another dispatch or retained a handle")
			}
		})
	}
}
