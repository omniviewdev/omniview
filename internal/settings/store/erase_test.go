package store

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	bolt "go.etcd.io/bbolt"
	boltErrors "go.etcd.io/bbolt/errors"
)

// rawPluginEntry stores bytes under a plugin ID exactly as given.
func rawPluginEntry(t *testing.T, s *Store, pluginID, raw string) {
	t.Helper()
	require.NoError(t, s.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket(pluginsBucket).Put([]byte(pluginID), []byte(raw))
	}))
}

func readRawPluginEntry(t *testing.T, s *Store, pluginID string) []byte {
	t.Helper()
	var raw []byte
	require.NoError(t, s.db.View(func(tx *bolt.Tx) error {
		raw = append(raw, tx.Bucket(pluginsBucket).Get([]byte(pluginID))...)
		return nil
	}))
	return raw
}

func erasing(ids ...string) func(string) bool {
	return func(id string) bool {
		for _, candidate := range ids {
			if candidate == id {
				return true
			}
		}
		return false
	}
}

func TestErasePluginSettingsKeepsTheOtherValuesUnchanged(t *testing.T) {
	s := openPatchStore(t)
	// A number beyond float64 precision shows the kept values are not decoded
	// and encoded again.
	rawPluginEntry(t, s, "flux", `{"big":1234567890123456789,"note":"plain","token":"s3cret"}`)

	require.NoError(t, s.ErasePluginSettings("flux", erasing("token")))

	var kept map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(readRawPluginEntry(t, s, "flux"), &kept))
	assert.Equal(t, map[string]json.RawMessage{
		"big":  json.RawMessage(`1234567890123456789`),
		"note": json.RawMessage(`"plain"`),
	}, kept)
}

func TestErasePluginSettingsRemovesTheEntryWhenNothingIsKept(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"token": "s3cret", "password": "pw"}))
	require.NoError(t, s.SavePluginSettings("other", map[string]any{"token": "other-s3cret"}))

	require.NoError(t, s.ErasePluginSettings("flux", func(string) bool { return true }))

	all, err := s.LoadAllPluginSettings()
	require.NoError(t, err)
	assert.Equal(t, map[string]map[string]any{"other": {"token": "other-s3cret"}}, all)
}

func TestErasePluginSettingsWithoutEntryChangesNothing(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.SavePluginSettings("other", map[string]any{"theme": "dark"}))

	require.NoError(t, s.ErasePluginSettings("flux", func(string) bool { return true }))

	all, err := s.LoadAllPluginSettings()
	require.NoError(t, err)
	assert.Equal(t, map[string]map[string]any{"other": {"theme": "dark"}}, all)
}

func TestErasePluginSettingsRemovesAnUndecodableEntryWhole(t *testing.T) {
	for name, raw := range map[string]string{"not json": `{"token":"s3cret"`, "not an object": `["s3cret"]`} {
		t.Run(name, func(t *testing.T) {
			s := openPatchStore(t)
			rawPluginEntry(t, s, "flux", raw)
			rawPluginEntry(t, s, "other", `{"theme":"dark"}`)

			// The entry cannot be read, so which of its values are credentials is
			// unknown; erasing nothing would leave them readable.
			require.NoError(t, s.ErasePluginSettings("flux", func(string) bool { return false }))

			assert.Empty(t, readRawPluginEntry(t, s, "flux"))
			assert.JSONEq(t, `{"theme":"dark"}`, string(readRawPluginEntry(t, s, "other")))
		})
	}
}

func TestErasePluginSettingsReportsAStoreThatIsClosed(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"token": "s3cret"}))
	require.NoError(t, s.Close())

	require.ErrorIs(t, s.ErasePluginSettings("flux", func(string) bool { return true }), boltErrors.ErrDatabaseNotOpen)
}

func TestErasePluginSettingsWithoutStoreIsUnavailable(t *testing.T) {
	var s *Store
	require.ErrorIs(t, s.ErasePluginSettings("flux", func(string) bool { return true }), ErrUnavailable)
}

func TestErasePluginSettingsDoesNotLoseConcurrentWrites(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"token": "s3cret"}))
	const writers = 16
	var wg sync.WaitGroup
	for i := range writers {
		wg.Add(2)
		go func() {
			defer wg.Done()
			assert.NoError(t, s.PatchPluginSettings("flux", map[string]any{fmt.Sprintf("kept-%d", i): i}))
		}()
		go func() {
			defer wg.Done()
			assert.NoError(t, s.ErasePluginSettings("flux", erasing("token")))
		}()
	}
	wg.Wait()

	saved, err := s.LoadPluginSettings("flux")
	require.NoError(t, err)
	assert.NotContains(t, saved, "token")
	for i := range writers {
		assert.Contains(t, saved, fmt.Sprintf("kept-%d", i), "an erase must not drop a value written beside it")
	}
}
