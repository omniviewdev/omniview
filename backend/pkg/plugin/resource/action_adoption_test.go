package resource

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func TestAdoptedActionCancellationRetainsObservation(t *testing.T) {
	registry := newActionRegistry()
	registry.afterFunc = func(_ time.Duration, fn func()) actionTimer {
		return &controlledActionTimer{fn: fn}
	}
	ctx, err := invocation.NewBoundary(nil).Admit(testInvocationContext(), "resource.StreamAction", invocation.Target{Provider: "flat"})
	if err != nil {
		t.Fatal(err)
	}
	request, _ := invocation.FromContext(ctx)
	canceled := false
	reservation, err := registry.reserve(request, func() {
		canceled = true
	})
	if err != nil {
		t.Fatal(err)
	}
	var updates []ActionSnapshot
	reservation.observer = func(snapshot ActionSnapshot) {
		updates = append(updates, snapshot)
	}
	handle, err := registry.commit(reservation, ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer registry.stopAll()

	if handle.attachTimer != nil {
		t.Fatal("host observation must not require a frontend attach")
	}
	if err := registry.requestCancellation(handle.id); err != nil {
		t.Fatal(err)
	}
	if !canceled || actionCount(registry) != 1 || len(updates) != 0 {
		t.Fatal("cancellation discarded observation or invented an outcome")
	}

	presentation := &sdkresource.ActivityPresentation{Title: "Provider phase"}
	registry.update(handle, ActionEventDTO{Type: "progress", Activity: presentation}, false)
	registry.update(handle, ActionEventDTO{Type: "complete"}, true)
	if len(updates) != 2 || updates[0].Event.Activity.Title != presentation.Title || !updates[1].Terminal {
		t.Fatal("observer lost typed presentation or actual outcome")
	}
}

func TestAdoptedActionRetirementReportsUnknownOutcome(t *testing.T) {
	registry := newActionRegistry()
	registry.afterFunc = func(_ time.Duration, fn func()) actionTimer {
		return &controlledActionTimer{fn: fn}
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
	var updates []ActionSnapshot
	reservation.observer = func(snapshot ActionSnapshot) {
		updates = append(updates, snapshot)
	}
	_, err = registry.commit(reservation, ctx)
	if err != nil {
		t.Fatal(err)
	}

	registry.stopPlugin("flat")
	if len(updates) != 1 || !updates[0].Terminal || updates[0].Event.Error.Code != "ACTIVITY_OBSERVATION_LOST" {
		t.Fatal("producer loss must report an unknown outcome")
	}
}

func TestActionEventPreservesTypedActivityWithoutBusinessOutput(t *testing.T) {
	event, err := actionEvent(sdkresource.ActionEvent{
		Type:     "progress",
		Activity: &sdkresource.ActivityPresentation{Title: "Expanding"},
	}, "request")
	if err != nil {
		t.Fatal(err)
	}
	if event.Activity == nil || event.Activity.Title != "Expanding" || event.Data != nil {
		t.Fatal("typed presentation was lost or business output invented")
	}
}

func TestFiniteActivityStartsOnceAfterPersistenceAndOutlivesBrowser(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	descriptor := sdkresource.ActionDescriptor{ID: "restart", Scope: sdkresource.ActionScopeInstance}
	var calls atomic.Int32
	begun := make(chan context.Context, 1)
	release := make(chan struct{})
	provider := &mockProvider{
		GetActionsFunc: func(context.Context, sdkresource.AccessRoute, string) ([]sdkresource.ActionDescriptor, error) {
			return []sdkresource.ActionDescriptor{descriptor}, nil
		},
		ActionFunc: func(ctx context.Context, _ sdkresource.ActionRequest) (sdkresource.Value, error) {
			calls.Add(1)
			begun <- ctx
			<-release
			return sdkresource.Value{Kind: "int64", Int: "9007199254740993"}, nil
		},
	}
	registerActionTestPlugin(ctrl, "p1", provider)
	request := admittedActionRequest(t, ctrl, "p1", "conn-1", "pods", "restart")
	request.ExpectedDescriptor = &descriptor
	ctx, browserGone := context.WithCancel(testInvocationContext())
	defer browserGone()
	updates := make(chan ActionSnapshot, 1)
	cancel, start, err := ctrl.PrepareActivityAction(ctx, "p1", request, func(snapshot ActionSnapshot) {
		updates <- snapshot
	})
	if err != nil {
		t.Fatal(err)
	}
	if cancel != nil || start == nil || calls.Load() != 0 {
		t.Fatal("finite RPC started before durable task admission or invented cancellation")
	}
	browserGone()
	start()
	start()
	select {
	case native := <-begun:
		if native.Err() != nil {
			t.Fatal("browser lifetime canceled native execution")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("finite action never started")
	}
	close(release)
	select {
	case snapshot := <-updates:
		if !snapshot.Terminal || snapshot.Event.Type != "complete" || snapshot.Event.Data == nil || snapshot.Event.Data.Int != "9007199254740993" {
			t.Fatal("finite RPC outcome or numeric precision lost")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("finite outcome was not observed")
	}
	if calls.Load() != 1 {
		t.Fatal("finite mutation replayed")
	}
}

func TestActivityActionRejectsStaleExecutionLaneBeforeMutation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	advertised := sdkresource.ActionDescriptor{ID: "restart", Scope: sdkresource.ActionScopeInstance, Streaming: true}
	var calls atomic.Int32
	provider := &mockProvider{
		GetActionsFunc: func(context.Context, sdkresource.AccessRoute, string) ([]sdkresource.ActionDescriptor, error) {
			return []sdkresource.ActionDescriptor{advertised}, nil
		},
		ActionFunc: func(context.Context, sdkresource.ActionRequest) (sdkresource.Value, error) {
			calls.Add(1)
			return sdkresource.Value{Kind: "null"}, nil
		},
		StreamActionFunc: func(context.Context, sdkresource.ActionRequest, chan<- sdkresource.ActionEvent) error {
			calls.Add(1)
			return nil
		},
	}
	registerActionTestPlugin(ctrl, "p1", provider)
	request := admittedActionRequest(t, ctrl, "p1", "conn-1", "pods", "restart")
	stale := advertised
	stale.Streaming = false
	request.ExpectedDescriptor = &stale
	_, _, err := ctrl.PrepareActivityAction(testInvocationContext(), "p1", request, func(ActionSnapshot) {})
	if err == nil || calls.Load() != 0 {
		t.Fatal("untrusted execution lane bypassed fresh descriptor review")
	}
}

func TestActivityActionDoesNotRetryDescriptorErrors(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	var metadataCalls atomic.Int32
	provider := &mockProvider{
		GetActionsFunc: func(context.Context, sdkresource.AccessRoute, string) ([]sdkresource.ActionDescriptor, error) {
			metadataCalls.Add(1)
			return nil, sdkresource.NewError("RESET_REQUIRED", "Review current metadata.")
		},
	}
	registerActionTestPlugin(ctrl, "p1", provider)
	request := admittedActionRequest(t, ctrl, "p1", "conn-1", "pods", "restart")
	_, _, err := ctrl.PrepareActivityAction(testInvocationContext(), "p1", request, func(ActionSnapshot) {})
	if err == nil || metadataCalls.Load() != 1 {
		t.Fatal("descriptor failure was retried or suppressed")
	}
}
