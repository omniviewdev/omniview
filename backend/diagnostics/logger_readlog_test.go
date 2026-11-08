package diagnostics

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestReadLog_SmallFileUnchanged(t *testing.T) {
	dir := t.TempDir()
	content := "{\"a\":1}\n{\"a\":2}\n"
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui.log"), []byte(content), 0o600))

	b := &BackendLogger{logDir: dir}
	got, err := b.ReadLog(context.Background(), "ui")
	require.NoError(t, err)
	require.Equal(t, content, got)
}

func TestReadLog_LargeFileBoundedTailAtLineBoundary(t *testing.T) {
	dir := t.TempDir()
	var sb strings.Builder
	n := 0
	for sb.Len() < maxReadLogBytes+maxReadLogBytes/2 {
		sb.WriteString(`{"line":` + strings.Repeat("x", 37) + "}\n")
		n++
	}
	full := sb.String()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui.log"), []byte(full), 0o600))

	b := &BackendLogger{logDir: dir}
	got, err := b.ReadLog(context.Background(), "ui")
	require.NoError(t, err)
	require.LessOrEqual(t, len(got), maxReadLogBytes)
	require.Greater(t, len(got), maxReadLogBytes-100)
	require.True(t, strings.HasSuffix(full, got), "result must be the tail of the file")
	require.True(t, strings.HasPrefix(got, `{"line":`), "result must start at a line boundary")
	require.True(t, strings.HasSuffix(got, "\n"))
}

// readLogLine is one 64-byte log line, so a whole number of them fills the cap.
func readLogLine(fill string) string {
	return fmt.Sprintf("%-63s\n", fill)
}

func readLogFile(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui.log"), []byte(content), 0o600))
	got, err := (&BackendLogger{logDir: dir}).ReadLog(context.Background(), "ui")
	require.NoError(t, err)
	return got
}

func TestReadLog_FileAtTheCapIsReturnedWhole(t *testing.T) {
	content := strings.Repeat(readLogLine("x"), maxReadLogBytes/64)
	require.Len(t, content, maxReadLogBytes)
	require.Equal(t, content, readLogFile(t, content))
}

// When the byte just before the window is a newline the window already starts
// on a line boundary, so its first line must be kept, not dropped with the rest
// of a partial line.
func TestReadLog_WindowThatStartsOnALineBoundaryKeepsItsFirstLine(t *testing.T) {
	body := readLogLine(`{"first":"kept"}`) + strings.Repeat(readLogLine("x"), maxReadLogBytes/64-1)
	require.Len(t, body, maxReadLogBytes)

	got := readLogFile(t, "old\n"+body)
	require.Len(t, got, maxReadLogBytes)
	require.Equal(t, body, got)
	require.True(t, strings.HasPrefix(got, `{"first":"kept"}`))
}

// A single line longer than the cap leaves no line boundary in the window to
// start at, so nothing is returned rather than half a line.
func TestReadLog_SingleLineLongerThanTheCapReturnsNothing(t *testing.T) {
	require.Empty(t, readLogFile(t, strings.Repeat("x", maxReadLogBytes+100)))
}

// The window offset comes from a size measured earlier. If the log was
// truncated since, ReadAt finds nothing at that offset and ReadLog must return
// an empty result instead of indexing an empty buffer.
func TestReadTailWindow_LogShrunkAfterItWasMeasured(t *testing.T) {
	data := []byte("{\"a\":1}\n{\"a\":2}\n")

	got, err := readTailWindow(bytes.NewReader(data), int64(maxReadLogBytes)*3)
	require.NoError(t, err)
	require.Empty(t, got)
}

// A log that shrank to just past the window start still yields what is left,
// from the line boundary.
func TestReadTailWindow_LogShrunkToJustPastTheWindowStart(t *testing.T) {
	data := []byte(strings.Repeat("a", maxReadLogBytes-1) + "\ntail-line\n")

	got, err := readTailWindow(bytes.NewReader(data), int64(maxReadLogBytes)*2)
	require.NoError(t, err)
	require.Equal(t, "tail-line\n", got)
}
