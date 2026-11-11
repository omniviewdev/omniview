package networker

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
)

func TestPortForwardOpenFailureSpan(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() { otel.SetTracerProvider(previous); _ = provider.Shutdown(context.Background()) })

	controller := NewController(logging.NewNop(), nil, nil)
	_, err := controller.StartResourcePortForwardingSession(
		context.Background(), "missing", "conn", networker.PortForwardSessionOptions{},
	)
	if err == nil {
		t.Fatal("expected missing plugin error")
	}
	spans := exporter.GetSpans()
	if len(spans) != 1 || spans[0].Name != "networker.StartResourcePortForwardingSession" {
		t.Fatalf("unexpected spans: %v", spans)
	}
	attrs := fmt.Sprint(spans[0].Attributes, spans[0].Events, spans[0].Status)
	if !strings.Contains(attrs, "outcome") || !strings.Contains(attrs, "failure") ||
		!strings.Contains(attrs, "error_class") {
		t.Fatalf("missing classification: %s", attrs)
	}
}

type failingForwardProvider struct{ Provider }

func (failingForwardProvider) GetSupportedPortForwardTargets(*sdktypes.PluginContext) ([]string, error) {
	return nil, errors.New("fake-provider-token-abc123")
}

func TestProviderFailureAndMissingProviderAreSafe(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := tracer
	tracer = provider.Tracer("omniview.networker")
	t.Cleanup(func() { tracer = previous; _ = provider.Shutdown(context.Background()) })
	sink := &logtest.RecordingSink{}
	logger := logging.New(logging.Config{
		Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug),
	})
	c, ok := NewController(logger, nil, nil).(*controller)
	if !ok {
		t.Fatal("unexpected controller type")
	}
	c.clients = map[string]Provider{"failing": failingForwardProvider{}}
	c.sessionIndex["orphan"] = sessionIndex{pluginID: "missing", connectionID: "conn"}
	if _, err := c.GetSupportedPortForwardTargets("failing"); err == nil {
		t.Fatal("expected provider error")
	}
	if _, err := c.ListAllPortForwardSessions(); err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, record := range sink.Records() {
		text := fmt.Sprint(record.Message, record.Fields)
		if strings.Contains(text, "fake-provider-token-abc123") {
			t.Fatalf("provider error leaked in log: %s", text)
		}
		if record.Message == "port forward provider unavailable" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing classified log for unavailable provider")
	}
	for _, span := range exporter.GetSpans() {
		text := fmt.Sprint(span.Attributes, span.Events, span.Status)
		if strings.Contains(text, "fake-provider-token-abc123") {
			t.Fatalf("provider error leaked in span: %s", text)
		}
		if span.Name == "networker.GetSupportedPortForwardTargets" &&
			(!strings.Contains(text, "failure") || !strings.Contains(text, "error_class")) {
			t.Fatalf("missing classification: %s", text)
		}
	}
}

func TestForwardWrapperDecodeFailureRedactsInput(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := tracer
	tracer = provider.Tracer("omniview.networker")
	t.Cleanup(func() { tracer = previous; _ = provider.Shutdown(context.Background()) })
	wrapper := &ServiceWrapper{}
	_, err := wrapper.StartResourcePortForwardingSession(
		context.Background(), "plugin", "conn", `{"secret":"fake-token-abc123"`,
	)
	if err == nil {
		t.Fatal("expected decode failure")
	}
	spans := exporter.GetSpans()
	if len(spans) != 1 || spans[0].Name != "networker.StartResourcePortForwardingSession" {
		t.Fatalf("unexpected spans: %v", spans)
	}
	text := fmt.Sprint(spans[0].Attributes, spans[0].Events, spans[0].Status)
	if strings.Contains(text, "fake-token-abc123") {
		t.Fatalf("request secret leaked: %s", text)
	}
	if !strings.Contains(text, "failure") || !strings.Contains(text, "error_class") {
		t.Fatalf("missing failure classification: %s", text)
	}
}
