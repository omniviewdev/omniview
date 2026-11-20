package resource

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devdiag"
	"github.com/omniviewdev/omniview/internal/telemetry"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// The resource controller logs the plugin's raw error value, and the plugin's raw
// status text, at CheckConnection ("RPC failed", "error", err) and in the
// auto-connect goroutine ("auto-connect attempt did not connect", with "error" and
// "details"). It does not redact them: the log sink does, once, for every caller. These
// tests send what the controller logs through the sink as the host builds it and
// require that nothing a provider wrote survives in what reaches the core behind it.
// The sink itself, and each core the host puts behind it, is tested in
// internal/telemetry (TestRedactingCore*, TestHostLogPipelineRedactsProviderErrorText).

const (
	leakBearer = "Authorization: Bearer abc123def456ghi789"
	leakPass   = "password=hunter2"
	leakAWSKey = "AKIAIOSFODNN7EXAMPLE"
)

// recordingBackend is the host's log sink with an observer in the place of the log
// file and the exporter: a record goes through telemetry.NewZapBackend into a core
// behind telemetry.NewRedactingCore, which is how main builds the logger it hands the
// controller, and rendered returns what the core behind would have been given.
type recordingBackend struct {
	sink *telemetry.ZapBackend
	logs *observer.ObservedLogs
}

func newRecordingBackend() *recordingBackend {
	core, logs := observer.New(zapcore.DebugLevel)
	return &recordingBackend{
		sink: telemetry.NewZapBackend(zap.New(telemetry.NewRedactingCore(core))),
		logs: logs,
	}
}

func (b *recordingBackend) Write(ctx context.Context, r logging.Record) error {
	return b.sink.Write(ctx, r)
}
func (b *recordingBackend) Sync(ctx context.Context) error { return b.sink.Sync(ctx) }

func (b *recordingBackend) rendered() []string {
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

func newLeakTestController(t *testing.T) (*controller, *recordingBackend) {
	t.Helper()
	backend := newRecordingBackend()
	logger := logging.New(logging.Config{
		Name:    "omniview",
		Backend: backend,
		Level:   logging.NewLevelController(logging.LevelDebug),
	})
	svc := appstate.NewTestService(t)
	built := NewController(logger, nil, svc.PluginStore, nil)
	ctrl, ok := built.(*controller)
	require.True(t, ok, "NewController returned %T", built)
	ctrl.emitter = newRecordingEmitter()
	t.Cleanup(ctrl.actions.stopAll)
	t.Cleanup(func() {
		ctrl.pluginsMu.Lock()
		defer ctrl.pluginsMu.Unlock()
		for _, state := range ctrl.plugins {
			if state.cancel != nil {
				state.cancel()
			}
		}
	})
	return ctrl, backend
}

func leakingText() string {
	return "rpc error: code = Unauthenticated desc = " + leakBearer + " ; " + leakPass + " ; " + leakAWSKey
}

func requireLogCarriesNoSecret(t *testing.T, site string, lines []string) {
	t.Helper()
	require.NotEmpty(t, lines, "%s: the controller emitted no log record, the fixture did not reach the log site", site)
	for _, line := range lines {
		if devdiag.Redact(line) == line {
			continue
		}
		var leaked []string
		for _, s := range []string{"abc123def456ghi789", "hunter2", leakAWSKey} {
			if strings.Contains(line, s) {
				leaked = append(leaked, s)
			}
		}
		t.Errorf("%s logged provider-authored text with secret-shaped values %q verbatim:\n  %s", site, leaked, line)
	}
}

func TestControllerLogsRedactProviderErrorText(t *testing.T) {
	autoConnect := types.Connection{
		ID: "conn-1",
		Lifecycle: types.ConnectionLifecycle{AutoConnect: &types.ConnectionAutoConnect{
			Enabled:  true,
			Triggers: []types.ConnectionAutoConnectTrigger{types.ConnectionAutoConnectTriggerPluginStart},
			Retry:    types.ConnectionAutoConnectRetryNone,
		}},
	}

	t.Run("CheckConnection RPC failure", func(t *testing.T) {
		ctrl, backend := newLeakTestController(t)
		registerMockPlugin(ctrl, "p1", &mockProvider{
			CheckConnectionFunc: func(context.Context, string) (types.ConnectionStatus, error) {
				return types.ConnectionStatus{}, errors.New(leakingText())
			},
		})
		_, err := ctrl.CheckConnection(testInvocationContext(), "p1", "conn-1")
		require.Error(t, err)
		requireLogCarriesNoSecret(t, "controller.CheckConnection", backend.rendered())
	})

	t.Run("auto-connect StartConnection error", func(t *testing.T) {
		ctrl, backend := newLeakTestController(t)
		registerMockPlugin(ctrl, "p1", &mockProvider{
			StartConnectionFunc: func(context.Context, string) (types.ConnectionStatus, error) {
				return types.ConnectionStatus{}, errors.New(leakingText())
			},
		})
		ctrl.scheduleAutoConnect("p1", []types.Connection{autoConnect}, types.ConnectionAutoConnectTriggerPluginStart)
		waitForLogContaining(t, backend, "auto-connect attempt failed")
		requireLogCarriesNoSecret(t, "controller auto-connect (StartConnection error)", backend.rendered())
	})

	t.Run("auto-connect status text", func(t *testing.T) {
		ctrl, backend := newLeakTestController(t)
		registerMockPlugin(ctrl, "p1", &mockProvider{
			StartConnectionFunc: func(context.Context, string) (types.ConnectionStatus, error) {
				return types.ConnectionStatus{Status: types.ConnectionStatusError, Details: leakingText(), Error: leakBearer}, nil
			},
		})
		ctrl.scheduleAutoConnect("p1", []types.Connection{autoConnect}, types.ConnectionAutoConnectTriggerPluginStart)
		waitForLogContaining(t, backend, "auto-connect attempt did not connect")
		requireLogCarriesNoSecret(t, "controller auto-connect (status details/error)", backend.rendered())
	})
}

// waitForLogContaining waits at most 2 s for the auto-connect goroutine to log.
func waitForLogContaining(t *testing.T, backend *recordingBackend, msg string) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		for _, line := range backend.rendered() {
			if strings.HasPrefix(line, msg) {
				return
			}
		}
		select {
		case <-deadline:
			t.Fatalf("no %q record within 2s; got %q", msg, backend.rendered())
		case <-tick.C:
		}
	}
}
