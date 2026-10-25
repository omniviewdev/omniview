package resource

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
)

func TestUnissuedResourceInvocationCannotObserveOrSubscribe(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.Get(context.Background(), "supplied-actor", "root", "opaque", resource.GetInput{ID: "x"})
	if err == nil {
		t.Fatal("unissued request admitted")
	}
	if err := ctrl.SubscribeResource(context.Background(), "supplied-actor", "root", "opaque"); err == nil {
		t.Fatal("unissued subscription admitted")
	}
	if ctrl.isSubscribed("supplied-actor", "root", "opaque") {
		t.Fatal("denial populated subscription state")
	}
}

func TestProviderDenialThroughRealGRPCDoesNotObserveResult(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := resourcetest.NewTestProvider(t, resourcetest.WithGetFunc(func(context.Context, string, resource.GetInput) (*resource.GetResult, error) {
		return &resource.GetResult{Success: true, Result: json.RawMessage(`{"secret":"denied"}`)}, &resource.ResourceOperationError{Code: "FORBIDDEN", Title: "private-title", Message: "private-body"}
	}))
	registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, provider))
	_, err := ctrl.Get(testInvocationContext(), "cloud", "conn", "opaque", resource.GetInput{ID: "secret"})
	var app *apperror.AppError
	if !errors.As(err, &app) || app.Code != "FORBIDDEN" || app.RequestID == "" {
		t.Fatalf("denial lost through transport: %v", err)
	}
	if _, found := ctrl.registryStore.Get("cloud", "conn", "opaque", "", "secret"); found {
		t.Fatal("denial populated registry")
	}
}

func TestDeniedNativeReadyOpenCreatesNoHandle(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := resourcetest.NewTestProvider(t)
	provider.StreamActionFunc = func(context.Context, string, string, resource.ActionInput, chan<- resource.ActionEvent) error {
		return &resource.ResourceOperationError{Code: "FORBIDDEN", Title: "private", Message: "private"}
	}
	registerMockPlugin(ctrl, "container", setupGRPCProvider(t, provider))
	id, err := ctrl.StreamAction(testInvocationContext(), "container", "conn", "opaque", "start", resource.ActionInput{})
	if err == nil || id != "" || actionCount(ctrl.actions) != 0 {
		t.Fatalf("denied open left handle: id=%q err=%v count=%d", id, err, actionCount(ctrl.actions))
	}
}

func TestReadyFastTerminalIsReconciledAndForeignOwnerCannotAttach(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	provider := resourcetest.NewTestProvider(t)
	provider.StreamActionFunc = func(ctx context.Context, _ string, _ string, _ resource.ActionInput, ch chan<- resource.ActionEvent) error {
		for _, ev := range []resource.ActionEvent{{Type: "ready"}, {Type: "complete", Data: map[string]any{"message": "complete"}}} {
			select {
			case ch <- ev:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}
	registerMockPlugin(ctrl, "hypervisor", setupGRPCProvider(t, provider))
	owner := invocation.NewScope(invocation.TrustedUI)
	ctx := owner.Context(context.Background())
	id, err := ctrl.StreamAction(ctx, "hypervisor", "conn", "opaque", "start", resource.ActionInput{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ctrl.AttachStreamAction(invocation.NewScope(invocation.TrustedUI).Context(context.Background()), id); err == nil {
		t.Fatal("foreign owner attached")
	}
	if len(emitter.EventsWithKey("action/stream/"+id)) != 0 {
		t.Fatal("event emitted before attachment")
	}
	deadline := time.After(time.Second)
	for {
		snapshot, err := ctrl.AttachStreamAction(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if snapshot.Terminal {
			if snapshot.Event.Type != "complete" {
				t.Fatalf("wrong terminal: %+v", snapshot)
			}
			break
		}
		select {
		case <-deadline:
			t.Fatal("terminal outcome was lost")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	if err := ctrl.CancelStreamAction(ctx, id); err != nil {
		t.Fatal(err)
	}
	if actionCount(ctrl.actions) != 0 {
		t.Fatal("owning close leaked handle")
	}
}

func TestRegisteredSDKResourcerPreservesHostCorrelationThroughGRPC(t *testing.T) {
	seen := make(chan *resource.Session, 1)
	provider, err := resource.BuildResourceController(context.Background(), resource.ResourcePluginConfig[string]{Connections: &resourcetest.StubConnectionProvider[string]{}, Resources: []resource.ResourceRegistration[string]{{Meta: resource.ResourceMeta{Group: "cloud", Version: "v1", Kind: "Machine"}, Resourcer: &resourcetest.StubResourcer[string]{GetFunc: func(ctx context.Context, _ *string, _ resource.ResourceMeta, _ resource.GetInput) (*resource.GetResult, error) {
		session := resource.SessionFromContext(ctx)
		copy := *session
		seen <- &copy
		return nil, &resource.ResourceOperationError{Code: "FORBIDDEN", Title: "secret-title", Message: "secret-body"}
	}}}}})
	if err != nil {
		t.Fatal(err)
	}
	defer provider.Close()
	if _, err = provider.LoadConnections(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err = provider.StartConnection(context.Background(), "conn-1"); err != nil {
		t.Fatal(err)
	}
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, provider))
	_, err = ctrl.Get(testInvocationContext(), "cloud", "conn-1", "cloud::v1::Machine", resource.GetInput{ID: "opaque"})
	app := requireAppError(t, err)
	session := <-seen
	if session.RequestID == "" || session.RequestID != app.RequestID || session.RequesterID != "host" {
		t.Fatalf("actual resourcer correlation lost: session=%+v error=%s", session, app.Error())
	}
	if strings.Contains(app.Error(), "secret") {
		t.Fatal("native denial leaked provider fields")
	}
}

func TestResourceDiscoveryTransportFailureIsNotEmptySuccess(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := resourcetest.NewTestProvider(t)
	provider.GetResourceTypesFunc = func(context.Context, string) (map[string]resource.ResourceMeta, error) {
		return map[string]resource.ResourceMeta{"secret": {}}, &resource.ResourceOperationError{Code: "FORBIDDEN", Title: "secret-title", Message: "secret-body"}
	}
	registerMockPlugin(ctrl, "container", setupGRPCProvider(t, provider))
	result, err := ctrl.GetResourceTypes(testInvocationContext(), "container", "route")
	if result != nil || requireAppError(t, err).Code != "FORBIDDEN" {
		t.Fatal("denied discovery became empty/successful inventory")
	}
}

func TestOpenCancellationBeforeReadyLeavesNoHandle(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	started := make(chan struct{})
	provider := resourcetest.NewTestProvider(t)
	provider.StreamActionFunc = func(ctx context.Context, _ string, _ string, _ resource.ActionInput, _ chan<- resource.ActionEvent) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	registerMockPlugin(ctrl, "flat", setupGRPCProvider(t, provider))
	ctx, cancel := context.WithCancel(testInvocationContext())
	result := make(chan error, 1)
	go func() {
		_, err := ctrl.StreamAction(ctx, "flat", "route", "opaque", "start", resource.ActionInput{})
		result <- err
	}()
	<-started
	cancel()
	select {
	case err := <-result:
		if requireAppError(t, err).Code != "CANCELLED" {
			t.Fatal("open cancellation became internal failure")
		}
	case <-time.After(time.Second):
		t.Fatal("pending open did not cancel")
	}
	if actionCount(ctrl.actions) != 0 {
		t.Fatal("canceled open left pending or public state")
	}
}

func TestAcceptedProducerSurvivesCompletedOpenRequestCancellation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	stopped := make(chan struct{})
	provider := resourcetest.NewTestProvider(t)
	provider.StreamActionFunc = func(ctx context.Context, _ string, _ string, _ resource.ActionInput, events chan<- resource.ActionEvent) error {
		events <- resource.ActionEvent{Type: "ready"}
		<-ctx.Done()
		close(stopped)
		return ctx.Err()
	}
	registerMockPlugin(ctrl, "flat", setupGRPCProvider(t, provider))
	owner := invocation.NewScope(invocation.TrustedUI)
	ctx, cancel := context.WithCancel(owner.Context(context.Background()))
	id, err := ctrl.StreamAction(ctx, "flat", "route", "opaque", "start", resource.ActionInput{})
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	live := owner.Context(context.Background())
	if _, err = ctrl.AttachStreamAction(live, id); err != nil {
		t.Fatal("completed open cancellation killed accepted stream")
	}
	select {
	case <-stopped:
		t.Fatal("producer inherited completed Wails call lifetime")
	default:
	}
	if err = ctrl.CancelStreamAction(live, id); err != nil {
		t.Fatal(err)
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("owning cancellation did not reach native stream")
	}
}

func TestConnectionStateAggregatePreservesUnstartedNativeConnection(t *testing.T) {
	provider, err := resource.BuildResourceController(context.Background(), resource.ResourcePluginConfig[string]{
		Connections: &resourcetest.StubConnectionProvider[string]{},
		Resources:   []resource.ResourceRegistration[string]{{Meta: resource.ResourceMeta{Group: "cloud", Version: "v1", Kind: "Machine"}, Resourcer: &resourcetest.StubResourcer[string]{}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer provider.Close()
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, provider))
	ctx := testInvocationContext()
	connections, err := ctrl.LoadConnections(ctx, "cloud")
	if err != nil || len(connections) == 0 {
		t.Fatalf("native connections unavailable: %v", err)
	}
	states, err := ctrl.GetAllConnectionStates(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(states["cloud"]) != len(connections) {
		t.Fatal("unstarted native connections disappeared")
	}
	for _, state := range states["cloud"] {
		if state.Started || len(state.Resources) != 0 {
			t.Fatal("absent native watch became active")
		}
	}
}

func TestConnectionStateAggregateFailsClosedThroughTransport(t *testing.T) {
	for _, code := range []string{"FORBIDDEN", "CANCELLED", "PARTIAL_RESULT", "PROVIDER_ERROR", "INTERNAL"} {
		t.Run(code, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			provider := resourcetest.NewTestProvider(t)
			provider.GetWatchStateFunc = func(context.Context, string) (*resource.WatchConnectionSummary, error) {
				return &resource.WatchConnectionSummary{Resources: map[string]resource.WatchState{"secret": resource.WatchStateSynced}}, &resource.ResourceOperationError{Code: code, Title: "private", Message: "private"}
			}
			registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, provider))
			ctrl.connections["cloud"] = []types.Connection{{ID: "conn"}}
			states, err := ctrl.GetAllConnectionStates(testInvocationContext())
			if states != nil || requireAppError(t, err).Code != code {
				t.Fatalf("aggregate swallowed %s: %v", code, err)
			}
		})
	}
}

func TestConnectionStateAggregateCancellationStopsNativeRead(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := resourcetest.NewTestProvider(t)
	started, stopped := make(chan struct{}), make(chan struct{})
	provider.GetWatchStateFunc = func(ctx context.Context, _ string) (*resource.WatchConnectionSummary, error) {
		close(started)
		<-ctx.Done()
		close(stopped)
		return nil, ctx.Err()
	}
	registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, provider))
	ctrl.connections["cloud"] = []types.Connection{{ID: "conn"}}
	ctx, cancel := context.WithCancel(testInvocationContext())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		states, err := ctrl.GetAllConnectionStates(ctx)
		if states != nil {
			t.Error("cancelled aggregate returned a successful inventory")
		}
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("native watch read did not start")
	}
	cancel()
	select {
	case err := <-done:
		if requireAppError(t, err).Code != "CANCELLED" {
			t.Fatal("aggregate cancellation lost classification")
		}
	case <-time.After(time.Second):
		t.Fatal("aggregate did not cancel")
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("native watch read did not cancel")
	}
}

func TestConnectionStateAggregateDoesNotHideMissingProvider(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	ctrl.connections["missing"] = []types.Connection{{ID: "conn"}}
	states, err := ctrl.GetAllConnectionStates(testInvocationContext())
	if states != nil || requireAppError(t, err).Type != apperror.TypePluginNotFound {
		t.Fatal("missing provider became a stopped connection")
	}
}

func TestConnectionStateAggregateRejectsDeniedMemberBeforeNativeRead(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, _ invocation.Target) error {
		if operation == "resource.GetWatchState" {
			return errors.New("denied")
		}
		return nil
	}))
	provider := resourcetest.NewTestProvider(t)
	provider.GetWatchStateFunc = func(context.Context, string) (*resource.WatchConnectionSummary, error) {
		t.Error("denied member reached native watch read")
		return nil, errors.New("unexpected native read")
	}
	registerMockPlugin(ctrl, "cloud", setupGRPCProvider(t, provider))
	ctrl.connections["cloud"] = []types.Connection{{ID: "conn"}}
	states, err := ctrl.GetAllConnectionStates(testInvocationContext())
	if states != nil || requireAppError(t, err).Code != "FORBIDDEN" {
		t.Fatal("denied member became a successful aggregate")
	}
}
