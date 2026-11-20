package resource

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devdiag"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Defect (plan item H1, log-sink leakage, call-site half): the resource
// controller logs the plugin's raw error value, and the plugin's raw status
// text, at controller.go CheckConnection ("RPC failed", "error", err) and in
// the auto-connect goroutine ("auto-connect attempt failed" / "did not
// connect", with "error", "details"). No redaction sits between the plugin's
// error text and the log record, so a secret-shaped value in a provider error
// reaches the host log sink verbatim.
//
// Fixed looks like: no field of any record the controller emits carries text
// that devdiag.Redact would change, whether the fix redacts at these call
// sites, in a logging.Backend wrapper, or in the zap core. (A fix confined to
// the zap core is proved by TestHostLogPipelineRedactsProviderErrorText in
// internal/telemetry; this test then needs its recording backend swapped for
// the production pipeline.)

const (
	leakBearer = "Authorization: Bearer abc123def456ghi789"
	leakPass   = "password=hunter2"
	leakAWSKey = "AKIAIOSFODNN7EXAMPLE"
)

// recordingBackend keeps every record the controller's logger emits.
type recordingBackend struct {
	mu      sync.Mutex
	records []logging.Record
}

func (b *recordingBackend) Write(_ context.Context, r logging.Record) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.records = append(b.records, r)
	return nil
}
func (b *recordingBackend) Sync(context.Context) error { return nil }

func (b *recordingBackend) rendered() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]string, 0, len(b.records))
	for _, r := range b.records {
		var sb strings.Builder
		sb.WriteString(r.Message)
		for _, f := range r.Fields {
			fmt.Fprintf(&sb, " %s=%v", f.Key, f.Value)
		}
		out = append(out, sb.String())
	}
	return out
}

func newLeakTestController(t *testing.T) (*controller, *recordingBackend) {
	t.Helper()
	backend := &recordingBackend{}
	logger := logging.New(logging.Config{
		Name:    "omniview",
		Backend: backend,
		Level:   logging.NewLevelController(logging.LevelDebug),
	})
	svc := appstate.NewTestService(t)
	ctrl := NewController(logger, nil, svc.PluginStore, nil).(*controller)
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
		t.Errorf("H1: %s logged provider-authored text with secret-shaped values %q verbatim:\n  %s", site, leaked, line)
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
