package store

import (
	"fmt"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
)

func TestSaveSpansExcludeValuesAndLogFailures(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter)))
	t.Cleanup(func() { otel.SetTracerProvider(previous) })

	sink := &logtest.RecordingSink{}
	logger := logging.New(logging.Config{
		Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug),
	})

	s, err := Open(filepath.Join(t.TempDir(), "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })
	s.SetLogger(logger)
	require.NoError(t, s.SaveCategory("appearance", map[string]any{"token": "value-secret-1"}))
	require.NoError(t, s.SavePluginSettings("my-plugin", map[string]any{"k": "value-secret-1"}))

	var unavailable *Store
	unavailable.SetLogger(logger)
	require.ErrorIs(t, (&Store{log: logger}).SavePluginSettings(
		"p", map[string]any{"k": "value-secret-1"}), ErrUnavailable)

	spans := exporter.GetSpans()
	require.Len(t, spans, 3)
	require.Equal(t, "settings.Save", spans[0].Name)
	got := map[string]string{}
	for _, span := range spans {
		for _, kv := range span.Attributes {
			require.NotContains(t, kv.Value.String(), "value-secret-1")
			got[string(kv.Key)+"@"+span.Name] = kv.Value.String()
		}
	}
	require.Equal(t, "appearance", got["category@settings.Save"])
	require.Equal(t, "failure", spans[2].Attributes[1].Value.String())

	var errorLogs int
	for _, rec := range sink.Records() {
		for _, f := range rec.Fields {
			require.NotContains(t, fmt.Sprint(f.Value), "value-secret-1")
		}
		if rec.Level == logging.LevelError && rec.Message == "settings persist failed" {
			errorLogs++
		}
	}
	require.Equal(t, 1, errorLogs)
}
