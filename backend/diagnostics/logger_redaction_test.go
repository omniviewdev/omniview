package diagnostics

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devdiag"
)

// Defect (plan item H1, log-sink leakage, frontend half): the frontend patches
// console.* and ships every call through DiagnosticsClient.Log (Wails binding)
// into BackendLogger.Log, which writes straight to ui.log with no redaction.
// Anything a plugin UI or a failed query prints with console.error, including
// an upstream error message that holds a token, lands in ui.log verbatim and
// is later served back by ReadLog / StartTail.
//
// Fixed looks like: the message and every string field BackendLogger.Log
// receives are redacted (devdiag.Redact or equivalent) before they reach the
// zap core, so the ui.log file carries none of the secret-shaped values.
func TestBackendLoggerLogRedactsConsoleOutput(t *testing.T) {
	const message = "request failed: Authorization: Bearer abc123def456ghi789 ; password=hunter2 ; AKIAIOSFODNN7EXAMPLE"
	require.NotEqual(t, message, devdiag.Redact(message), "fixture must be secret-shaped for devdiag.Redact")

	dir := t.TempDir()
	// dev=false is the production level (error and above); console.error maps to "error".
	b, err := NewBackendLogger("ui", false, dir)
	require.NoError(t, err)

	// The call DiagnosticsClient.Log makes for a console.error with a field.
	b.Log(context.Background(), "error", message, map[string]any{
		"component": "console",
		"detail":    "password=hunter2",
	})
	require.NoError(t, b.Sugared.Sync())

	raw, err := os.ReadFile(filepath.Join(dir, "ui.log"))
	require.NoError(t, err)
	var leaked []string
	for _, s := range []string{"abc123def456ghi789", "hunter2", "AKIAIOSFODNN7EXAMPLE"} {
		if strings.Contains(string(raw), s) {
			leaked = append(leaked, s)
		}
	}
	if len(leaked) > 0 {
		t.Errorf("H1: ui.log carries secret-shaped values %q verbatim from DiagnosticsClient.Log: the Go receiver does not redact\nlog: %s", leaked, raw)
	}
}
