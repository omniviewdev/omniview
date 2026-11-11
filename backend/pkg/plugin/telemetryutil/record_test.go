package telemetryutil

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestRecordErrorDoesNotExportErrorText(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	_, span := provider.Tracer("test").Start(context.Background(), "test")
	err := errors.New("token=abc123 secret")
	RecordError(span, err)
	span.End()
	ended := recorder.Ended()[0]
	if got, want := ended.Status().Description, ErrorClass(err); got != want {
		t.Fatalf("status description = %q, want %q", got, want)
	}
	if strings.Contains(fmt.Sprint(ended.Attributes(), ended.Events(), ended.Status()), "abc123") {
		t.Fatal("span contains secret")
	}
}
