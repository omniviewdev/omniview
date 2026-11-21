package plugin

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
)

func installCaptureSpans(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	// The package tracer binds to the first global provider ever set, so swap the
	// variable itself to keep this test independent of other tests' providers.
	previous := tracer
	tracer = provider.Tracer("omniview.plugin")
	t.Cleanup(func() {
		tracer = previous
		_ = provider.Shutdown(context.Background())
	})
	return exporter
}

func installRecordingLogger(pm *pluginManager) *logtest.RecordingSink {
	sink := &logtest.RecordingSink{}
	pm.logger = logging.New(logging.Config{
		Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug),
	})
	return sink
}

func installSpanAttrMap(kvs []attribute.KeyValue) map[string]string {
	out := make(map[string]string, len(kvs))
	for _, kv := range kvs {
		out[string(kv.Key)] = kv.Value.String()
	}
	return out
}

func installFindSpan(t *testing.T, exporter *tracetest.InMemoryExporter, name string) tracetest.SpanStub {
	t.Helper()
	for _, span := range exporter.GetSpans() {
		if span.Name == name {
			return span
		}
	}
	t.Fatalf("span %q not exported; got %v", name, installSpanNames(exporter))
	return tracetest.SpanStub{}
}

func installSpanNames(exporter *tracetest.InMemoryExporter) []string {
	var names []string
	for _, span := range exporter.GetSpans() {
		names = append(names, span.Name)
	}
	return names
}

func TestInstallPluginFromPath_EmitsInstallSpanTree(t *testing.T) {
	pm := newTestManager(t)
	sink := installRecordingLogger(pm)
	exporter := installCaptureSpans(t)
	archive := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.1.0\ncapabilities: [ui]\n"},
		{name: "assets/entry.js", mode: 0644, body: "bundle"},
	})

	_, err := pm.InstallPluginFromPath(archive)
	require.NoError(t, err)

	root := installFindSpan(t, exporter, "plugin.Install")
	attrs := installSpanAttrMap(root.Attributes)
	assert.Equal(t, "path", attrs["source"])
	assert.Equal(t, "flux", attrs["plugin_id"])
	assert.Equal(t, "success", attrs["outcome"])

	for _, child := range []string{"plugin.Extract", "plugin.Commit", "plugin.archive.commit"} {
		span := installFindSpan(t, exporter, child)
		assert.Equal(t, "flux", installSpanAttrMap(span.Attributes)["plugin_id"], child)
	}
	commit := installFindSpan(t, exporter, "plugin.archive.commit")
	var phases []string
	for _, event := range commit.Events {
		if event.Name == "phase" {
			phases = append(phases, installSpanAttrMap(event.Attributes)["phase"])
		}
	}
	assert.Equal(t, []string{"validated", "state_written", "marker_committed"}, phases)

	var committed bool
	for _, record := range sink.Records() {
		if record.Message == "plugin install committed" && record.Level == logging.LevelInfo {
			committed = true
		}
	}
	assert.True(t, committed, "successful install must log Info")
}

func TestInstallPluginFromPath_FailureIsClassifiedWithoutLeakingInput(t *testing.T) {
	pm := newTestManager(t)
	sink := installRecordingLogger(pm)
	exporter := installCaptureSpans(t)
	bad := filepath.Join(t.TempDir(), "path-secret-xyz.tar.gz")
	require.NoError(t, os.WriteFile(bad, []byte("not an archive"), 0600))

	_, err := pm.InstallPluginFromPath(bad)
	require.Error(t, err)

	root := installFindSpan(t, exporter, "plugin.Install")
	attrs := installSpanAttrMap(root.Attributes)
	assert.Equal(t, "failure", attrs["outcome"])
	assert.NotEmpty(t, attrs["error_class"])
	for _, span := range exporter.GetSpans() {
		blob := fmt.Sprint(span.Attributes, span.Status, span.Events)
		assert.NotContains(t, blob, "path-secret-xyz", "span %s leaked the source path", span.Name)
	}
	var failed, rejected bool
	for _, record := range sink.Records() {
		assert.NotContains(t, fmt.Sprint(record.Message, record.Fields), "path-secret-xyz", "log leaked source path")
		switch record.Message {
		case "plugin install failed":
			failed = record.Level == logging.LevelError
		case "plugin package rejected":
			rejected = record.Level == logging.LevelWarn
		}
	}
	assert.True(t, failed, "failed install must log Error")
	assert.True(t, rejected, "rejected package must log Warn")
}

func TestUninstallPlugin_EmitsSpanAndInfoLog(t *testing.T) {
	pm := newTestManager(t)
	sink := installRecordingLogger(pm)
	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll(filepath.Join("flux", "assets"), 0755))
	require.NoError(t, pm.pluginsRoot.WriteFile(filepath.Join("flux", "assets", "entry.js"), []byte("bundle"), 0644))
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	exporter := installCaptureSpans(t)

	_, err = pm.UninstallPlugin("flux")
	require.NoError(t, err)

	span := installFindSpan(t, exporter, "plugin.Uninstall")
	attrs := installSpanAttrMap(span.Attributes)
	assert.Equal(t, "flux", attrs["plugin_id"])
	assert.Equal(t, "success", attrs["outcome"])
	var logged bool
	for _, record := range sink.Records() {
		if record.Message == "plugin uninstalled" && record.Level == logging.LevelInfo {
			logged = true
		}
	}
	assert.True(t, logged)
}

func TestArchivePublicationFailureLogsClassWithoutCauseText(t *testing.T) {
	pm := newTestManager(t)
	sink := installRecordingLogger(pm)
	cause := errors.New("sync failed token=archive-secret-xyz")

	_ = pm.archivePublicationFailure(&archiveRecovery{ID: "flux"}, cause)

	var logged bool
	for _, record := range sink.Records() {
		if record.Message != "plugin archive publication requires recovery" {
			continue
		}
		logged = record.Level == logging.LevelError
		assert.NotContains(t, fmt.Sprint(record.Fields), "archive-secret-xyz")
	}
	assert.True(t, logged)
}
