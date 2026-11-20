package plugin

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/devdiag"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// Defect (plan item H1, log-sink leakage, plugin-manager call site):
// pluginManager.Shutdown (manager.go, "failed to shut down plugin") logs the
// error returned by shutdownPlugin as a raw "error" field. That error is the
// join of every controller and backend stop error, which carry plugin-origin
// text. The neighbouring shutdownBackend already logs only errorClass for the
// same error, so the call is inconsistent as well as unredacted.
//
// Fixed looks like: the record the manager emits for a failed plugin shutdown
// carries no text that devdiag.Redact would change (log errorClass, or pass the
// text through a redactor / apperror.PublicText).

type managerRecordingBackend struct {
	mu      sync.Mutex
	records []logging.Record
}

func (b *managerRecordingBackend) Write(_ context.Context, r logging.Record) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.records = append(b.records, r)
	return nil
}
func (b *managerRecordingBackend) Sync(context.Context) error { return nil }

func (b *managerRecordingBackend) rendered() []string {
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

func TestManagerShutdownLogDoesNotCarryPluginErrorSecrets(t *testing.T) {
	const leak = "stop failed: Authorization: Bearer abc123def456ghi789 ; password=hunter2 ; AKIAIOSFODNN7EXAMPLE"
	require.NotEqual(t, leak, devdiag.Redact(leak), "fixture must be secret-shaped for devdiag.Redact")

	backend := &managerRecordingBackend{}
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
			t.Errorf("H1: pluginManager.Shutdown logged plugin-origin error text with secret-shaped values verbatim:\n  %s", line)
		}
	}
}
