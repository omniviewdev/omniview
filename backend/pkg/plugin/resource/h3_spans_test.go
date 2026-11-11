package resource

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestH3OperationSpanClassifiesAndRedacts(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(context.Background())
	})
	_, end := h3StartOperation(context.Background(), "resource.test")
	err := errors.New("fake-provider-token-abc123")
	end(&err)
	spans := exporter.GetSpans()
	if len(spans) != 1 || spans[0].Name != "resource.test" {
		t.Fatalf("unexpected spans: %v", spans)
	}
	attrs := map[string]string{}
	for _, attr := range spans[0].Attributes {
		attrs[string(attr.Key)] = attr.Value.AsString()
	}
	if attrs["outcome"] != "failure" || attrs["error_class"] != "PROVIDER_ERROR" {
		t.Fatalf("unexpected classification: %v", attrs)
	}
	if strings.Contains(fmt.Sprint(spans[0].Attributes, spans[0].Events, spans[0].Status), "fake-provider-token-abc123") {
		t.Fatal("provider error text leaked")
	}
	exporter.Reset()
	wrapper := &ServiceWrapper{}
	_, err = wrapper.NativeQuery(context.Background(), "plugin", `{"token":"fake-secret",`)
	if err == nil {
		t.Fatal("expected invalid transport input to fail")
	}
	spans = exporter.GetSpans()
	if len(spans) != 1 || spans[0].Name != "resource.NativeQuery" {
		t.Fatalf("unexpected spans: %v", spans)
	}
	if strings.Contains(fmt.Sprint(spans[0].Attributes, spans[0].Events, spans[0].Status), "fake-secret") {
		t.Fatal("transport input leaked")
	}
}
