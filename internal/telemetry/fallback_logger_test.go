package telemetry

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/internal/devdiag"
)

// The host logs through the fallback logger when telemetry could not start. It is the
// production logger of zap (JSON, info level, a sample of the repeated entries, a stack
// for an error) behind the redacting core, and a test through the constructor main
// calls is the only thing that holds the three together: a logger built in main has no
// test, and a redactor put outside the sampler once made the sampler vanish.

func fallbackLog(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	return string(raw)
}

func TestFallbackLoggerSamplesWhatItWritesAndRedactsIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fallback.log")
	logger, err := NewFallbackLogger(path)
	require.NoError(t, err)

	for range 1000 {
		logger.Info("RPC failed", zap.String("detail", credentialText))
	}
	require.NoError(t, logger.Sync())

	written := fallbackLog(t, path)
	lines := strings.Count(written, "\n")
	assert.Positive(t, lines)
	assert.Less(t, lines, 200, "1000 identical entries were written in full: the sampling was lost")
	requireRedacted(t, "the fallback log", written)
}

// The production logger writes the first 100 entries with one message in a second and
// then every 100th. A clock that does not move keeps the second from ending.
func TestFallbackLoggerWritesTheFirstHundredAndEveryHundredthAfter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fallback.log")
	logger, err := newFallbackLogger([]string{path}, zap.WithClock(fixedClock{}))
	require.NoError(t, err)

	for range 1000 {
		logger.Info("RPC failed", zap.String("detail", credentialText))
	}
	logger.Info("another message", zap.String("detail", credentialText))
	require.NoError(t, logger.Sync())

	written := fallbackLog(t, path)
	assert.Equal(t, 100+9+1, strings.Count(written, "\n"), "100, 9 of the other 900, and the other message")
	requireRedacted(t, "the fallback log", written)
}

func TestFallbackLoggerKeepsTheSettingsOfTheProductionLogger(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fallback.log")
	logger, err := NewFallbackLogger(path)
	require.NoError(t, err)

	logger.Debug("below the level")
	logger.Info("info", zap.String("token", opaqueSecret), zap.String("pluginID", "kubernetes"))
	logger.Error("error", zap.Error(errors.New("rpc error: "+credentialText)))
	require.NoError(t, logger.Sync())

	written := fallbackLog(t, path)
	assert.NotContains(t, written, "below the level", "the level is info")
	assert.Contains(t, written, `"level":"info"`)
	assert.Contains(t, written, `"caller":"telemetry/fallback_logger_test.go:`)
	assert.Contains(t, written, `"stacktrace":`, "an error carries its stack")
	assert.NotContains(t, written, opaqueSecret)
	assert.Contains(t, written, `"token":"`+devdiag.Placeholder+`"`, "a field is hidden by its name")
	assert.Contains(t, written, `"pluginID":"kubernetes"`)
	requireRedacted(t, "the fallback log", written)
}

// main calls the constructor with no path, and the logger then writes to stderr, as the
// production logger of zap does.
func TestFallbackLoggerWithNoPathIsTheProductionLoggerOfZap(t *testing.T) {
	logger, err := NewFallbackLogger()
	require.NoError(t, err)
	assert.True(t, logger.Core().Enabled(zap.InfoLevel))
	assert.False(t, logger.Core().Enabled(zap.DebugLevel))
}
