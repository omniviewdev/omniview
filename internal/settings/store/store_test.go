package store

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Basic CRUD ---

func TestOpen_CreatesFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.db")

	s, err := Open(path)
	require.NoError(t, err)
	defer s.Close()

	_, statErr := os.Stat(path)
	assert.NoError(t, statErr, "database file should exist")
}

func TestOpen_ExistingFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.db")

	// Open, write, close.
	s, err := Open(path)
	require.NoError(t, err)
	require.NoError(t, s.SaveCategory("general", map[string]any{"theme": "dark"}))
	require.NoError(t, s.Close())

	// Reopen and verify data preserved.
	s2, err := Open(path)
	require.NoError(t, err)
	defer s2.Close()

	vals, err := s2.LoadCategory("general")
	require.NoError(t, err)
	assert.Equal(t, "dark", vals["theme"])
}

func TestClose_Idempotent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.db")

	s, err := Open(path)
	require.NoError(t, err)

	require.NoError(t, s.Close())
	// Second close should not panic or error.
	err = s.Close()
	assert.NoError(t, err)

	// Nil store close should not panic.
	var nilStore *Store
	assert.NoError(t, nilStore.Close())
}

func TestSaveAndLoadCategory(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	input := map[string]any{
		"fontSize": float64(14),
		"theme":    "dark",
		"enabled":  true,
	}
	require.NoError(t, s.SaveCategory("editor", input))

	got, err := s.LoadCategory("editor")
	require.NoError(t, err)
	assert.Equal(t, input, got)
}

func TestSaveCategory_Overwrites(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	require.NoError(t, s.SaveCategory("editor", map[string]any{"theme": "light"}))
	require.NoError(t, s.SaveCategory("editor", map[string]any{"theme": "dark"}))

	got, err := s.LoadCategory("editor")
	require.NoError(t, err)
	assert.Equal(t, "dark", got["theme"])
}

func TestSaveAndLoadPluginSettings(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	input := map[string]any{"apiKey": "secret123", "timeout": float64(30)}
	require.NoError(t, s.SavePluginSettings("my-plugin", input))

	got, err := s.LoadPluginSettings("my-plugin")
	require.NoError(t, err)
	assert.Equal(t, input, got)
}

func TestDeletePluginSettings(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	require.NoError(t, s.SavePluginSettings("my-plugin", map[string]any{"key": "val"}))
	require.NoError(t, s.DeletePluginSettings("my-plugin"))

	got, err := s.LoadPluginSettings("my-plugin")
	require.NoError(t, err)
	assert.Empty(t, got)
}

func TestDeletePluginSettings_NonExistent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	err = s.DeletePluginSettings("does-not-exist")
	assert.NoError(t, err)
}

func TestLoadCategory_Empty(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	got, err := s.LoadCategory("nonexistent")
	require.NoError(t, err)
	assert.NotNil(t, got)
	assert.Empty(t, got)
}

func TestLoadAllPluginSettings(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	plugins := map[string]map[string]any{
		"plugin-a": {"keyA": "valA"},
		"plugin-b": {"keyB": float64(42)},
		"plugin-c": {"keyC": true},
	}
	for id, vals := range plugins {
		require.NoError(t, s.SavePluginSettings(id, vals))
	}

	got, err := s.LoadAllPluginSettings()
	require.NoError(t, err)
	assert.Equal(t, plugins, got)
}

func TestLoadAllPluginSettings_Empty(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	got, err := s.LoadAllPluginSettings()
	require.NoError(t, err)
	assert.NotNil(t, got)
	assert.Empty(t, got)
}

func TestSaveCategory_EmptyMap(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	require.NoError(t, s.SaveCategory("empty", map[string]any{}))

	got, err := s.LoadCategory("empty")
	require.NoError(t, err)
	assert.NotNil(t, got)
	assert.Empty(t, got)
}

func TestOpen_InvalidPath(t *testing.T) {
	t.Parallel()
	_, err := Open("/nonexistent/deeply/nested/path/settings.db")
	assert.Error(t, err)
}

// --- Concurrent access ---

func TestConcurrentWrites(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			cat := fmt.Sprintf("category-%d", i)
			err := s.SaveCategory(cat, map[string]any{"index": float64(i)})
			assert.NoError(t, err)
		}(i)
	}
	wg.Wait()

	// Verify all writes landed.
	for i := 0; i < 10; i++ {
		cat := fmt.Sprintf("category-%d", i)
		got, err := s.LoadCategory(cat)
		require.NoError(t, err)
		assert.Equal(t, float64(i), got["index"])
	}
}

func TestConcurrentReadWrite(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	// Seed initial data.
	require.NoError(t, s.SaveCategory("shared", map[string]any{"counter": float64(0)}))

	var wg sync.WaitGroup
	// Writers.
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			err := s.SaveCategory("shared", map[string]any{"counter": float64(i)})
			assert.NoError(t, err)
		}(i)
	}
	// Readers.
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, err := s.LoadCategory("shared")
			assert.NoError(t, err)
			assert.NotNil(t, got)
		}()
	}
	wg.Wait()
}

func TestConcurrentPluginWrites(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprintf("plugin-%d", i)
			err := s.SavePluginSettings(id, map[string]any{"id": float64(i)})
			assert.NoError(t, err)
		}(i)
	}
	wg.Wait()

	all, err := s.LoadAllPluginSettings()
	require.NoError(t, err)
	assert.Len(t, all, 10)
}

// --- Edge cases ---

func TestSaveCategory_SpecialCharacters(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	cases := map[string]map[string]any{
		"unicode.category":    {"name": "日本語テスト"},
		"dots.in.name":        {"a.b": "c.d"},
		"spaces in name":      {"empty-key-id": true},
		"emoji-\U0001F680":    {"rocket": true},
		"slashes/and\\back":   {"path": "/usr/bin"},
	}
	for id, vals := range cases {
		require.NoError(t, s.SaveCategory(id, vals), "save %q", id)
		got, err := s.LoadCategory(id)
		require.NoError(t, err, "load %q", id)
		assert.Equal(t, vals, got, "round-trip %q", id)
	}
}

func TestSaveCategory_NilValue(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	input := map[string]any{"present": "yes", "absent": nil}
	require.NoError(t, s.SaveCategory("niltest", input))

	got, err := s.LoadCategory("niltest")
	require.NoError(t, err)
	assert.Equal(t, input, got)
}

func TestSaveCategory_Idempotent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	vals := map[string]any{"key": "value"}
	require.NoError(t, s.SaveCategory("idem", vals))
	require.NoError(t, s.SaveCategory("idem", vals))

	got, err := s.LoadCategory("idem")
	require.NoError(t, err)
	assert.Equal(t, vals, got)
}

func TestDeletePlugin_Idempotent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	require.NoError(t, s.SavePluginSettings("p", map[string]any{"k": "v"}))
	require.NoError(t, s.DeletePluginSettings("p"))
	require.NoError(t, s.DeletePluginSettings("p")) // second delete is no-op

	got, err := s.LoadPluginSettings("p")
	require.NoError(t, err)
	assert.Empty(t, got)
}

func TestSaveCategory_LargeValues(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	defer s.Close()

	largeStr := strings.Repeat("x", 1<<20) // 1 MB
	input := map[string]any{"big": largeStr}
	require.NoError(t, s.SaveCategory("large", input))

	got, err := s.LoadCategory("large")
	require.NoError(t, err)
	assert.Equal(t, largeStr, got["big"])
}

// --- Corruption recovery ---

func TestOpen_CorruptFile_RecreatesClean(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.db")

	// Write garbage to simulate corruption.
	require.NoError(t, os.WriteFile(path, []byte("this is not a valid bbolt database"), 0o600))

	s, err := Open(path)
	require.NoError(t, err, "Open should recover from corrupt file")
	defer s.Close()

	// Fresh store should work.
	require.NoError(t, s.SaveCategory("test", map[string]any{"works": true}))
	got, err := s.LoadCategory("test")
	require.NoError(t, err)
	assert.Equal(t, true, got["works"])
}

func TestOpen_CorruptFile_BackupPreserved(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.db")

	garbage := []byte("corrupt data for backup test")
	require.NoError(t, os.WriteFile(path, garbage, 0o600))

	s, err := Open(path)
	require.NoError(t, err)
	defer s.Close()

	// Find the backup file.
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)

	var backupFound bool
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "settings.db.corrupt.") {
			backupFound = true
			data, err := os.ReadFile(filepath.Join(dir, e.Name()))
			require.NoError(t, err)
			assert.Equal(t, garbage, data, "backup should contain original corrupt data")
		}
	}
	assert.True(t, backupFound, "corrupt backup file should exist")
}
