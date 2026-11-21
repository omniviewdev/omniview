package plugin

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/devdiag"
	"github.com/omniviewdev/omniview/internal/telemetry"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// pluginManager.Shutdown (manager.go, "failed to shut down plugin") logs the error
// returned by shutdownPlugin as a raw "error" field. That error is the join of every
// controller and backend stop error, which carry plugin-origin text. The manager does
// not redact it: the log sink does, once, for every caller. This test sends what the
// manager logs through the sink as the host builds it and requires that nothing a
// plugin wrote survives in what reaches the core behind it. The sink itself, and each
// core the host puts behind it, is tested in internal/telemetry (TestRedactingCore*,
// TestHostLogPipelineRedactsProviderErrorText).

// managerRecordingBackend is the host's log sink with an observer in the place of the
// log file and the exporter: a record goes through telemetry.NewZapBackend into a core
// behind telemetry.NewRedactingCore, which is how main builds the logger it hands the
// manager, and rendered returns what the core behind would have been given.
type managerRecordingBackend struct {
	sink *telemetry.ZapBackend
	logs *observer.ObservedLogs
}

func newManagerRecordingBackend() *managerRecordingBackend {
	core, logs := observer.New(zapcore.DebugLevel)
	return &managerRecordingBackend{
		sink: telemetry.NewZapBackend(zap.New(telemetry.NewRedactingCore(core))),
		logs: logs,
	}
}

func (b *managerRecordingBackend) Write(ctx context.Context, r logging.Record) error {
	return b.sink.Write(ctx, r)
}
func (b *managerRecordingBackend) Sync(ctx context.Context) error { return b.sink.Sync(ctx) }

func (b *managerRecordingBackend) rendered() []string {
	entries := b.logs.All()
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		var sb strings.Builder
		sb.WriteString(entry.Message)
		fields := entry.ContextMap()
		for _, key := range slices.Sorted(maps.Keys(fields)) {
			fmt.Fprintf(&sb, " %s=%v", key, fields[key])
		}
		out = append(out, sb.String())
	}
	return out
}

func TestManagerShutdownLogDoesNotCarryPluginErrorSecrets(t *testing.T) {
	const leak = "stop failed: Authorization: Bearer abc123def456ghi789 ; password=hunter2 ; AKIAIOSFODNN7EXAMPLE"
	require.NotEqual(t, leak, devdiag.Redact(leak), "fixture must be secret-shaped for devdiag.Redact")

	backend := newManagerRecordingBackend()
	pm := newTestManager(t)
	pm.logger = logging.New(logging.Config{
		Name:    "omniview",
		Backend: backend,
		Level:   logging.NewLevelController(logging.LevelDebug),
	})
	pm.records = map[string]*plugintypes.PluginRecord{
		"leaky": {
			ID:       "leaky",
			Phase:    lifecycle.PhaseRunning,
			Metadata: config.PluginMeta{ID: "leaky", Capabilities: []string{"resource"}},
			Backend: plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{
				Shutdown: func() error { return errors.New(leak) },
			}),
		},
	}

	pm.Shutdown()

	lines := backend.rendered()
	var failed []string
	for _, line := range lines {
		if strings.HasPrefix(line, "failed to shut down plugin") {
			failed = append(failed, line)
		}
	}
	require.NotEmpty(t, failed, "manager did not log the shutdown failure; got %q", lines)
	for _, line := range failed {
		if devdiag.Redact(line) != line {
			t.Errorf("pluginManager.Shutdown logged plugin-origin error text with secret-shaped values verbatim:\n  %s", line)
		}
	}
}
