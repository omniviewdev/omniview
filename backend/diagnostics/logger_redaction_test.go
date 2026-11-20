package diagnostics

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devdiag"
)

// The frontend patches console.* and ships every call through DiagnosticsClient.Log
// (a Wails binding) into BackendLogger.Log, which writes ui.log. Anything a plugin UI
// or a failed query prints with console.error, including an upstream error message
// that holds a token, would land in ui.log and be served back by ReadLog and StartTail
// to whoever asks. The message and every field BackendLogger receives are therefore
// redacted before they reach the file.
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
		t.Errorf("ui.log carries secret-shaped values %q verbatim from DiagnosticsClient.Log: "+
			"the Go receiver does not redact\nlog: %s", leaked, raw)
	}
}

// The fields the frontend sends are a JSON document: strings, numbers and arrays and
// objects of them, to any depth. All four levels of the logger write through the same
// core.
func TestBackendLoggerRedactsNestedFieldsAtEveryLevel(t *testing.T) {
	dir := t.TempDir()
	b, err := NewBackendLogger("ui", true, dir)
	require.NoError(t, err)

	for _, level := range []string{"debug", "info", "warn", "error"} {
		b.Log(context.Background(), level, "console output", map[string]any{
			"component": "console",
			"count":     float64(3),
			"args": []any{
				"password=hunter2",
				map[string]any{"response": "Authorization: Bearer abc123def456ghi789"},
			},
			"headers": map[string]any{"x-amz-key": "AKIAIOSFODNN7EXAMPLE"},
			"cause":   errors.New("rpc error: password=hunter2"),
		})
	}
	require.NoError(t, b.Sugared.Sync())

	raw, err := os.ReadFile(filepath.Join(dir, "ui.log"))
	require.NoError(t, err)
	for _, secret := range []string{"abc123def456ghi789", "hunter2", "AKIAIOSFODNN7EXAMPLE"} {
		assert.NotContains(t, string(raw), secret)
	}
	assert.Equal(t, 4+1, strings.Count(string(raw), "\n"), "four lines, and the one that records the logger's own start")
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n")[1:] {
		assert.Contains(t, line, `"component":"console"`)
		assert.Contains(t, line, `"count":3`)
		assert.Contains(t, line, "[REDACTED]")
	}
}

// What holds no credential is written as it was.
func TestBackendLoggerWritesOrdinaryConsoleOutputAsItWas(t *testing.T) {
	dir := t.TempDir()
	b, err := NewBackendLogger("ui", false, dir)
	require.NoError(t, err)

	b.Error(context.Background(), "query failed: GET /api/v1/pods 500 (Internal Server Error)", map[string]any{
		"queryKey": "pods:kube-system",
		"digest":   "sha256:3d380ca8864549e74af4b29c10f9cb0956236dfb01c40ca076fb6c37253234db",
	})
	require.NoError(t, b.Sugared.Sync())

	raw, err := os.ReadFile(filepath.Join(dir, "ui.log"))
	require.NoError(t, err)
	assert.Contains(t, string(raw), `"msg":"query failed: GET /api/v1/pods 500 (Internal Server Error)"`)
	assert.Contains(t, string(raw), `"queryKey":"pods:kube-system"`)
	assert.Contains(t, string(raw), `"digest":"sha256:3d380ca8864549e74af4b29c10f9cb0956236dfb01c40ca076fb6c37253234db"`)
	assert.NotContains(t, string(raw), "[REDACTED]")
}

// Most secrets have no shape that a pattern finds: the password of a login form, the
// options of a request that failed. What a plugin UI prints with console.error carries
// them under the names it knows them by, and the name is what gives them away.
func TestBackendLoggerHidesTheValueOfAFieldNamedForACredential(t *testing.T) {
	dir := t.TempDir()
	b, err := NewBackendLogger("ui", false, dir)
	require.NoError(t, err)

	b.Error(context.Background(), "login failed", map[string]any{
		"component": "console",
		"authToken": "s3cr3t-no-shape",
		"password":  "correct-horse-battery",
		"options": map[string]any{
			"headers": map[string]any{"x-api-key": "plain-no-shape", "accept": "application/json"},
			"retries": float64(3),
		},
		"queryKey":  "pods:kube-system",
		"tokenizer": "wordpiece",
	})
	require.NoError(t, b.Sugared.Sync())

	raw, err := os.ReadFile(filepath.Join(dir, "ui.log"))
	require.NoError(t, err)
	for _, secret := range []string{"s3cr3t-no-shape", "correct-horse-battery", "plain-no-shape"} {
		assert.NotContains(t, string(raw), secret)
	}
	for _, kept := range []string{
		`"component":"console"`, `"authToken":"[REDACTED]"`, `"password":"[REDACTED]"`, `"x-api-key":"[REDACTED]"`,
		`"accept":"application/json"`, `"retries":3`, `"queryKey":"pods:kube-system"`, `"tokenizer":"wordpiece"`,
	} {
		assert.Contains(t, string(raw), kept)
	}
}
