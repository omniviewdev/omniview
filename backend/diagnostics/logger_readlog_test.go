package diagnostics

import (
	"context"
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
