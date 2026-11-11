package window

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
)

//nolint:gochecknoglobals // Package tracer binds to its first provider, so tests share an exporter.
var (
	windowSpanOnce     sync.Once
	windowSpanExporter = tracetest.NewInMemoryExporter()
)

// captureWindowSpans installs the process-wide provider once: the package
// tracer binds to the first global provider only, so tests share one exporter.
func captureWindowSpans(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	windowSpanOnce.Do(func() {
		otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(windowSpanExporter)))
	})
	windowSpanExporter.Reset()
	return windowSpanExporter
}

func spanAttrs(span tracetest.SpanStub) map[string]any {
	out := map[string]any{}
	for _, kv := range span.Attributes {
		out[string(kv.Key)] = kv.Value.String()
	}
	return out
}

func TestSaveStateSpanAndRejection(t *testing.T) {
	exporter := captureWindowSpans(t)
	sink := &logtest.RecordingSink{}
	h := newTestHarness(t, "", time.Hour)
	h.service.log = logging.New(logging.Config{
		Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug),
	})
	exporter.Reset()

	require.NoError(t, h.service.SaveState(MainWindowName, "layout", `{"secret":"state-token-123"}`))
	require.Error(t, h.service.SaveState("missing-window", "layout", `{}`))

	var ok, failed *tracetest.SpanStub
	spans := exporter.GetSpans()
	for i := range spans {
		if spans[i].Name != "window.SaveState" {
			continue
		}
		if spanAttrs(spans[i])["outcome"] == "success" {
			ok = &spans[i]
		} else {
			failed = &spans[i]
		}
	}
	require.NotNil(t, ok)
	require.NotNil(t, failed)
	require.NotEqual(t, "0", spanAttrs(*ok)["window_count"])
	require.Equal(t, "failure", spanAttrs(*failed)["outcome"])
	require.Contains(t, spanAttrs(*failed), "error_class")
	for _, span := range spans {
		for _, v := range spanAttrs(span) {
			require.NotContains(t, v, "state-token-123")
		}
	}
	warned := false
	for _, rec := range sink.Records() {
		if rec.Level == logging.LevelWarn && rec.Message == "window state save rejected" {
			warned = true
		}
	}
	require.True(t, warned)
}

func TestRestoreSessionSpan(t *testing.T) {
	exporter := captureWindowSpans(t)
	newTestHarness(t, "", time.Hour)
	var found bool
	for _, span := range exporter.GetSpans() {
		if span.Name == "window.RestoreSession" {
			found = true
			attrs := spanAttrs(span)
			require.Equal(t, "success", attrs["outcome"])
			require.Equal(t, "0", attrs["failed"])
		}
	}
	require.True(t, found)
}

func TestRestoreFailureLogsClassOnly(t *testing.T) {
	sink := &logtest.RecordingSink{}
	dir := filepath.Join(t.TempDir(), "path-secret-77")
	require.NoError(t, os.MkdirAll(dir, 0o700))
	sessionPath := filepath.Join(dir, SessionFileName)
	require.NoError(t, os.WriteFile(sessionPath, []byte(`{"windows": token-secret-88`), 0o600))

	host := newFakeHost()
	mainWindow := &fakeNativeWindow{name: MainWindowName}
	service := newService(serviceDependencies{
		host: host, emitter: &fakeEmitter{},
		log: logging.New(logging.Config{
			Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug),
		}),
		mainWindow: mainWindow, sessionPath: sessionPath, saveDelay: time.Hour, dropTimeout: time.Hour,
	})
	mainWindow.sink = service
	t.Cleanup(func() { _ = service.ServiceShutdown() })

	var logged bool
	for _, rec := range sink.Records() {
		if rec.Message == "window session not restored" {
			logged = true
			require.Equal(t, logging.LevelError, rec.Level)
		}
		for _, f := range rec.Fields {
			require.NotContains(t, fmt.Sprint(f.Value), "path-secret-77")
			require.NotContains(t, fmt.Sprint(f.Value), "token-secret-88")
		}
	}
	require.True(t, logged)

	var persistLogged bool
	service.persister.onError(fmt.Errorf("write %s: token-secret-88", sessionPath))
	for _, rec := range sink.Records() {
		if rec.Message == "failed to persist window session" {
			persistLogged = true
		}
		for _, f := range rec.Fields {
			require.NotContains(t, fmt.Sprint(f.Value), "token-secret-88")
		}
	}
	require.True(t, persistLogged)
}
