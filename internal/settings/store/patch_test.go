package store

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	bolt "go.etcd.io/bbolt"
)

func openPatchStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	return s
}

func TestPatchSettingsPreservesSiblingsAndSplitsFirstDot(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.SaveCategory("editor", map[string]any{"theme": "light", "font": "mono"}))
	require.NoError(t, s.PatchSettings(map[string]any{
		"editor.theme": "dark", "editor.syntax.enabled": true, "general.locale": "en",
	}))
	got, err := s.LoadCategory("editor")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark", "font": "mono", "syntax.enabled": true}, got)
	got, err = s.LoadCategory("general")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"locale": "en"}, got)
}

func TestPatchSettingsRollsBack(t *testing.T) {
	for _, failure := range []string{"decode", "encode", "write"} {
		t.Run(failure, func(t *testing.T) {
			s := openPatchStore(t)
			require.NoError(t, s.SaveCategory("good", map[string]any{"value": "before"}))
			require.NoError(t, s.db.Update(func(tx *bolt.Tx) error {
				b := tx.Bucket(coreBucket)
				if failure == "write" {
					_, err := b.CreateBucket([]byte("bad"))
					return err
				}
				data := []byte(`{"value":"before"}`)
				if failure == "decode" {
					data = []byte(`broken`)
				}
				return b.Put([]byte("bad"), data)
			}))
			patch := map[string]any{"good.value": "after", "bad.value": "after"}
			if failure == "encode" {
				patch["bad.value"] = make(chan int)
			}
			require.Error(t, s.PatchSettings(patch))
			got, err := s.LoadCategory("good")
			require.NoError(t, err)
			assert.Equal(t, map[string]any{"value": "before"}, got)
		})
	}
}

func TestPatchSettingsRejectsInvalidIDsWithoutWrites(t *testing.T) {
	s := openPatchStore(t)
	for _, id := range []string{"missing", ".setting", "category."} {
		require.Error(t, s.PatchSettings(map[string]any{"valid.key": true, id: true}))
		got, err := s.LoadCategory("valid")
		require.NoError(t, err)
		assert.Empty(t, got)
	}
}

func TestPatchPluginSettingsPreservesRawIDsAndSiblings(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.SavePluginSettings("plugin.with.dots", map[string]any{"raw.id": "old", "sibling": true}))
	require.NoError(t, s.PatchPluginSettings("plugin.with.dots", map[string]any{"raw.id": "new", "other.id": nil}))
	got, err := s.LoadPluginSettings("plugin.with.dots")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"raw.id": "new", "sibling": true, "other.id": nil}, got)
	require.Error(t, s.PatchPluginSettings("plugin.with.dots", map[string]any{"raw.id": make(chan int)}))
	after, err := s.LoadPluginSettings("plugin.with.dots")
	require.NoError(t, err)
	assert.Equal(t, got, after)
}

func TestPatchPluginSettingsRejectsCorruptSavedValues(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket(pluginsBucket).Put([]byte("plugin"), []byte(`broken`))
	}))
	require.Error(t, s.PatchPluginSettings("plugin", map[string]any{"key": "value"}))
	require.NoError(t, s.db.View(func(tx *bolt.Tx) error {
		assert.Equal(t, "broken", string(tx.Bucket(pluginsBucket).Get([]byte("plugin"))))
		return nil
	}))
}

func TestConcurrentPatchesPreserveSiblings(t *testing.T) {
	s := openPatchStore(t)
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := range 20 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprintf("key%d", i)
			if err := s.PatchSettings(map[string]any{"category." + id: true}); err != nil {
				errs <- err
				return
			}
			errs <- s.PatchPluginSettings("plugin", map[string]any{id: true})
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	host, err := s.LoadCategory("category")
	require.NoError(t, err)
	plugin, err := s.LoadPluginSettings("plugin")
	require.NoError(t, err)
	assert.Len(t, host, 20)
	assert.Equal(t, host, plugin)
}

func TestUnavailablePluginPersistenceAndPatches(t *testing.T) {
	for _, s := range []*Store{nil, {}} {
		require.ErrorIs(t, s.PatchSettings(nil), ErrUnavailable)
		require.ErrorIs(t, s.PatchPluginSettings("plugin", nil), ErrUnavailable)
		require.ErrorIs(t, s.SavePluginSettings("plugin", nil), ErrUnavailable)
		_, err := s.LoadPluginSettings("plugin")
		require.ErrorIs(t, err, ErrUnavailable)
		_, err = s.LoadAllPluginSettings()
		require.ErrorIs(t, err, ErrUnavailable)
		require.ErrorIs(t, s.DeletePluginSettings("plugin"), ErrUnavailable)
	}
}
