package plugin

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hashicorp/go-hclog"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/pluginlog"
	"github.com/omniviewdev/omniview/internal/devdiag"
)

// go-plugin writes the log of a plugin process (its stderr, a line at a time, and the
// host's account of starting it) to the host's stdout and to the plugin's log stream.
// stdout is not nowhere: a terminal keeps it, the systemd journal keeps it for an
// application started from a Linux desktop, and the development supervisor writes it to
// its log. So the copy for stdout is redacted, as the stream is.

func requireNoCredential(t *testing.T, where, text string) {
	t.Helper()
	for _, secret := range []string{"abc123def456ghi789", "hunter2", "AKIAIOSFODNN7EXAMPLE"} {
		require.NotContains(t, text, secret, "%s carries a credential", where)
	}
}

// newPluginLogger writes through hclog as go-plugin does, so that the lines are the ones
// a plugin's stderr produces when it echoes a request.
func newPluginLogger(output io.Writer) hclog.Logger {
	return hclog.New(&hclog.LoggerOptions{Name: "alpha", Output: output, Level: hclog.Debug})
}

func TestPluginProcessLogOutputRedactsTheStdoutCopyAndTheStream(t *testing.T) {
	const leak = "rpc failed: Authorization: Bearer abc123def456ghi789 ; password=hunter2 ; AKIAIOSFODNN7EXAMPLE"
	require.NotEqual(t, leak, devdiag.Redact(leak), "the fixture must be what devdiag.Redact changes")

	dir := t.TempDir()
	logs, err := pluginlog.NewManager(dir, pluginlog.DefaultRotation())
	require.NoError(t, err)
	t.Cleanup(func() { _ = logs.Close() })

	var stdout bytes.Buffer
	logger := newPluginLogger(pluginProcessLogOutput(&stdout, logs, "alpha"))
	logger.Debug("plugin stderr", "error", leak)
	logger.Warn("nothing to hide", "pluginID", "alpha", "durationMs", 412)

	requireNoCredential(t, "the stdout copy", stdout.String())
	require.Contains(t, stdout.String(), "rpc failed:")
	require.Contains(t, stdout.String(), "nothing to hide")

	entries := logs.GetLogs("alpha", 0)
	require.Len(t, entries, 2)
	for _, entry := range entries {
		requireNoCredential(t, "the plugin log stream", entry.Message)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "plugin.alpha.log"))
	require.NoError(t, err)
	requireNoCredential(t, "plugin.alpha.log", string(raw))
	require.Equal(t, strings.Count(stdout.String(), "\n"), strings.Count(string(raw), "\n"), "both get the same lines")
}

// Without a log manager the log goes to stdout alone, and is redacted all the same.
func TestPluginProcessLogOutputRedactsStdoutWithoutALogManager(t *testing.T) {
	var stdout bytes.Buffer
	logger := newPluginLogger(pluginProcessLogOutput(&stdout, nil, "alpha"))
	logger.Error("plugin stderr", "error", "Authorization: Bearer abc123def456ghi789 ; password=hunter2")
	requireNoCredential(t, "the stdout copy", stdout.String())
	require.Contains(t, stdout.String(), "plugin stderr")
}
