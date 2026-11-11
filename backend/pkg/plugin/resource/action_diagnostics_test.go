package resource

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestActionDiagnosticDoesNotExportInputOrProviderError(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := tracer
	tracer = provider.Tracer("test")
	defer func() { tracer = previous; _ = provider.Shutdown(context.Background()) }()

	request := actionTestRequest("p1", "nodes", "drain")
	request.Input = resourcev2.Value{Kind: "string", String: "secret-input"}
	ctx, diagnostic := (&controller{}).beginActionDiagnostic(context.Background(), "resource.Action", "p1", request)
	diagnostic.finish(ctx, "completion", &resourcev2.ResourceOperationError{Code: "FORBIDDEN", Message: "secret-provider-message"})
	spans := recorder.Ended()
	require.Len(t, spans, 1)
	text := fmt.Sprint(spans[0].Attributes(), spans[0].Events(), spans[0].Status())
	require.Contains(t, text, "FORBIDDEN")
	require.Contains(t, text, "drain")
	require.NotContains(t, text, "secret-input")
	require.NotContains(t, text, "secret-provider-message")
	require.Equal(t, "PROVIDER_ERROR", telemetryutil.ErrorClass(errors.New("secret error")))
}

func TestStreamActionSpanCoversProducerLifetime(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := tracer
	tracer = provider.Tracer("test")
	defer func() { tracer = previous; _ = provider.Shutdown(context.Background()) }()

	ctrl, _ := newTestControllerWithEmitter(t)
	release := make(chan struct{})
	registerActionTestPlugin(ctrl, "p1", &mockProvider{StreamActionFunc: func(ctx context.Context, _ resourcev2.ActionRequest, events chan<- resourcev2.ActionEvent) error {
		events <- resourcev2.ActionEvent{Type: "ready"}
		<-release
		return context.Canceled
	}})
	id, err := ctrl.StreamAction(testInvocationContext(), "p1", admittedActionRequest(t, ctrl, "p1", "conn-1", "opaque", "restart"))
	require.NoError(t, err)
	for _, span := range recorder.Ended() {
		require.NotEqual(t, "resource.StreamAction", span.Name())
	}
	close(release)
	require.Eventually(t, func() bool {
		for _, span := range recorder.Ended() {
			if span.Name() == "resource.StreamAction" {
				return strings.Contains(fmt.Sprint(span.Attributes()), "canceled")
			}
		}
		return false
	}, 2*time.Second, time.Millisecond)
	_ = ctrl.CancelStreamAction(testInvocationContext(), id)
}

func TestStreamActionSpanWaitsForTerminalObservation(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := tracer
	tracer = provider.Tracer("test")
	defer func() { tracer = previous; _ = provider.Shutdown(context.Background()) }()

	ctrl, _ := newTestControllerWithEmitter(t)
	returned := make(chan struct{})
	observed := make(chan struct{})
	release := make(chan struct{})
	registerActionTestPlugin(ctrl, "p1", &mockProvider{StreamActionFunc: func(_ context.Context, _ resourcev2.ActionRequest, events chan<- resourcev2.ActionEvent) error {
		defer close(returned)
		events <- resourcev2.ActionEvent{Type: "ready"}
		events <- resourcev2.ActionEvent{Type: "complete"}
		return nil
	}})
	_, err := ctrl.AdoptStreamAction(testInvocationContext(), "p1", admittedActionRequest(t, ctrl, "p1", "conn-1", "opaque", "restart"), func(snapshot ActionSnapshot) {
		if snapshot.Terminal {
			close(observed)
			<-release
		}
	})
	require.NoError(t, err)
	select {
	case <-returned:
	case <-time.After(2 * time.Second):
		t.Fatal("producer did not return")
	}
	select {
	case <-observed:
	case <-time.After(2 * time.Second):
		t.Fatal("terminal event was not observed")
	}
	for _, span := range recorder.Ended() {
		require.NotEqual(t, "resource.StreamAction", span.Name())
	}
	close(release)
	require.Eventually(t, func() bool {
		for _, span := range recorder.Ended() {
			if span.Name() == "resource.StreamAction" {
				return strings.Contains(fmt.Sprint(span.Events()), "resource.action.terminal")
			}
		}
		return false
	}, 2*time.Second, time.Millisecond)
}

func TestStreamActionSpanEndsAfterAdmissionFailure(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := tracer
	tracer = provider.Tracer("test")
	defer func() { tracer = previous; _ = provider.Shutdown(context.Background()) }()

	ctrl, _ := newTestControllerWithEmitter(t)
	registerActionTestPlugin(ctrl, "p1", &mockProvider{StreamActionFunc: func(context.Context, resourcev2.ActionRequest, chan<- resourcev2.ActionEvent) error {
		return errors.New("private provider error")
	}})
	_, err := ctrl.StreamAction(testInvocationContext(), "p1", admittedActionRequest(t, ctrl, "p1", "conn-1", "opaque", "restart"))
	require.Error(t, err)
	require.Eventually(t, func() bool {
		for _, span := range recorder.Ended() {
			if span.Name() == "resource.StreamAction" {
				text := fmt.Sprint(span.Attributes(), span.Events(), span.Status())
				return strings.Contains(text, "PROVIDER_ERROR") && !strings.Contains(text, "private provider error")
			}
		}
		return false
	}, 2*time.Second, time.Millisecond)
}
