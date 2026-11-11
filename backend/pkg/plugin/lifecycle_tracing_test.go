package plugin

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// recordLifecycleSpans swaps the package tracer for an in-memory recorder.
func recordLifecycleSpans(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := tracer
	tracer = provider.Tracer("test")
	t.Cleanup(func() {
		tracer = previous
		_ = provider.Shutdown(context.Background())
	})
	return recorder
}

func lifecycleSpanByName(t *testing.T, recorder *tracetest.SpanRecorder, name string) sdktrace.ReadOnlySpan {
	t.Helper()
	for _, span := range recorder.Ended() {
		if span.Name() == name {
			return span
		}
	}
	require.FailNowf(t, "span not found", "no ended span named %q", name)
	return nil
}

func lifecycleSpanAttr(span sdktrace.ReadOnlySpan, key string) (attribute.Value, bool) {
	for _, kv := range span.Attributes() {
		if string(kv.Key) == key {
			return kv.Value, true
		}
	}
	return attribute.Value{}, false
}

func TestPluginTelemetryEnvLogLevel(t *testing.T) {
	with := pluginTelemetryEnv(TelemetryEnvConfig{LogLevel: "debug"})
	require.Contains(t, with, "OMNIVIEW_PLUGIN_LOG_LEVEL=debug")

	without := pluginTelemetryEnv(TelemetryEnvConfig{})
	for _, entry := range without {
		require.NotContains(t, entry, "OMNIVIEW_PLUGIN_LOG_LEVEL")
	}
	require.Contains(t, without, "OMNIVIEW_TELEMETRY_ENABLED=false")
}

func TestLoadPluginMissingEmitsFailedSpanWithClassOnly(t *testing.T) {
	recorder := recordLifecycleSpans(t)
	pm := newTestManager(t)

	_, err := pm.LoadPlugin("nonexistent", nil)
	require.Error(t, err)

	span := lifecycleSpanByName(t, recorder, "plugin.Load")
	id, ok := lifecycleSpanAttr(span, "plugin_id")
	require.True(t, ok)
	require.Equal(t, "nonexistent", id.AsString())
	outcome, _ := lifecycleSpanAttr(span, "outcome")
	require.Equal(t, "failure", outcome.AsString())
	class, ok := lifecycleSpanAttr(span, "error_class")
	require.True(t, ok)
	require.NotEmpty(t, class.AsString())
	require.Equal(t, class.AsString(), span.Status().Description)
	require.NotContains(t, fmt.Sprint(span.Events(), span.Status()), err.Error())

	var lockEvent bool
	for _, event := range span.Events() {
		if event.Name == "plugin.ops_lock.acquired" {
			lockEvent = true
			require.Equal(t, "wait_ms", string(event.Attributes[0].Key))
		}
	}
	require.True(t, lockEvent, "ops lock wait must be recorded")
}

func TestConcurrentLifecycleOperationsAreSeparateRoots(t *testing.T) {
	recorder := recordLifecycleSpans(t)
	pm := newTestManager(t)
	endFirst := pm.lifecycleOp("plugin.first", "same-plugin")
	done := make(chan struct{})
	go func() {
		endSecond := pm.lifecycleOp("plugin.second", "same-plugin")
		endSecond(nil)
		close(done)
	}()
	defer func() {
		endFirst(nil)
		<-done
	}()

	require.Eventually(t, func() bool {
		return len(recorder.Started()) == 2
	}, time.Second, time.Millisecond)
	spans := recorder.Started()
	require.Equal(t, "plugin.first", spans[0].Name())
	require.Equal(t, "plugin.second", spans[1].Name())
	require.False(t, spans[0].Parent().IsValid())
	require.False(t, spans[1].Parent().IsValid())
	require.NotEqual(t, spans[0].SpanContext().TraceID(), spans[1].SpanContext().TraceID())
}

func TestLoadPluginSpansNestStartAndHandshake(t *testing.T) {
	recorder := recordLifecycleSpans(t)
	pm := newTestManager(t)
	pm.ctx = context.Background()
	installPluginFixture(t, pm, "traced", []string{"exec"}, true)
	pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) {
		return &capDetectingBackend{version: plugintypes.CurrentProtocolVersion, caps: []string{"exec"}}, nil
	}

	_, err := pm.LoadPlugin("traced", nil)
	require.NoError(t, err)

	load := lifecycleSpanByName(t, recorder, "plugin.Load")
	start := lifecycleSpanByName(t, recorder, "plugin.Start")
	handshake := lifecycleSpanByName(t, recorder, "plugin.Handshake")
	require.Equal(t, load.SpanContext().SpanID(), start.Parent().SpanID())
	require.Equal(t, start.SpanContext().SpanID(), handshake.Parent().SpanID())
	version, ok := lifecycleSpanAttr(handshake, "protocol_version")
	require.True(t, ok)
	require.Equal(t, int64(plugintypes.CurrentProtocolVersion), version.AsInt64())
	outcome, _ := lifecycleSpanAttr(load, "outcome")
	require.Equal(t, "success", outcome.AsString())
	caps, ok := lifecycleSpanAttr(lifecycleSpanByName(t, recorder, "plugin.StartPlugin"), "capabilities")
	require.True(t, ok)
	require.Equal(t, "exec", caps.AsString())
}

func TestHealthCheckSpanOnlyOnFailure(t *testing.T) {
	recorder := recordLifecycleSpans(t)
	pm := newTestManager(t)
	hc := NewHealthChecker(pm.logger, pm)

	healthy := &capDetectingBackend{version: plugintypes.CurrentProtocolVersion}
	record := &plugintypes.PluginRecord{ID: "ok", Phase: lifecycle.PhaseRunning, Metadata: config.PluginMeta{ID: "ok"}}
	require.True(t, hc.checkPlugin("ok", "", record, healthy))
	require.Empty(t, recorder.Ended(), "healthy probes emit metrics only")

	require.False(t, hc.checkPlugin("gone", "", record, nil))
	span := lifecycleSpanByName(t, recorder, "plugin.HealthCheck")
	reason, _ := lifecycleSpanAttr(span, "reason")
	require.Equal(t, "no_backend", reason.AsString())
	outcome, _ := lifecycleSpanAttr(span, "outcome")
	require.Equal(t, "failure", outcome.AsString())
}

type exitedBackend struct{ capDetectingBackend }

func (exitedBackend) Exited() bool { return true }

func TestHandlePluginCrashSpanClassifiesExit(t *testing.T) {
	recorder := recordLifecycleSpans(t)
	pm := newTestManager(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // the fallback retry returns immediately
	pm.ctx = ctx
	record := plugintypes.NewPluginRecord("crashy", config.PluginMeta{ID: "crashy"}, lifecycle.PhaseRunning)
	record.Backend = &exitedBackend{}
	pm.records["crashy"] = record

	pm.HandlePluginCrash("crashy")

	span := lifecycleSpanByName(t, recorder, "plugin.Crash")
	exit, ok := lifecycleSpanAttr(span, "exit_class")
	require.True(t, ok)
	require.Equal(t, "exited", exit.AsString())
	cycle, ok := lifecycleSpanAttr(span, "in_crash_cycle")
	require.True(t, ok)
	require.False(t, cycle.AsBool())
	require.Equal(t, lifecycle.PhaseRecovering, record.Phase)
}
