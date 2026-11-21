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

// declaring is the schema of a plugin that declares these settings ordinary.
func declaring(ids ...string) *DeclaredSettings {
	return &DeclaredSettings{Ordinary: ids}
}

func TestErasePluginSettingsKeepsTheOtherValuesUnchanged(t *testing.T) {
	s := openPatchStore(t)
	// A number beyond float64 precision shows the kept values are not decoded
	// and encoded again.
	rawPluginEntry(t, s, "flux", `{"big":1234567890123456789,"note":"plain","token":"s3cret"}`)

	result, err := s.ErasePluginSettings("flux", declaring("big", "note"))

	require.NoError(t, err)
	assert.Equal(t, EraseResult{Erased: 1, Kept: 2, Basis: EraseBasisSession, Unreadable: false}, result)
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

	result, err := s.ErasePluginSettings("flux", declaring())

	require.NoError(t, err)
	assert.Equal(t, 2, result.Erased)
	assert.Equal(t, 0, result.Kept)
	all, err := s.LoadAllPluginSettings()
	require.NoError(t, err)
	assert.Equal(t, map[string]map[string]any{"other": {"token": "other-s3cret"}}, all)
}

func TestErasePluginSettingsWithoutEntryChangesNothing(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.SavePluginSettings("other", map[string]any{"theme": "dark"}))

	result, err := s.ErasePluginSettings("flux", declaring())

	require.NoError(t, err)
	assert.Equal(t, 0, result.Erased)
	assert.Equal(t, 0, result.Kept)
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
			result, err := s.ErasePluginSettings("flux", declaring("token"))

			require.NoError(t, err)
			assert.True(t, result.Unreadable, "the result says the entry was removed whole")
			assert.Empty(t, readRawPluginEntry(t, s, "flux"))
			assert.JSONEq(t, `{"theme":"dark"}`, string(readRawPluginEntry(t, s, "other")))
		})
	}
}

func TestErasePluginSettingsReportsAStoreThatIsClosed(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"token": "s3cret"}))
	require.NoError(t, s.Close())

	result, err := s.ErasePluginSettings("flux", declaring())

	require.ErrorIs(t, err, boltErrors.ErrDatabaseNotOpen)
	assert.Equal(t, EraseResult{}, result, "a failed erase reports nothing erased")
}

func TestErasePluginSettingsWithoutStoreIsUnavailable(t *testing.T) {
	var s *Store
	_, err := s.ErasePluginSettings("flux", declaring())
	require.ErrorIs(t, err, ErrUnavailable)
}

func TestErasePluginSettingsDoesNotLoseConcurrentWrites(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"token": "s3cret"}))
	const writers = 16
	ordinary := make([]string, 0, writers)
	for i := range writers {
		ordinary = append(ordinary, fmt.Sprintf("kept-%d", i))
	}
	var wg sync.WaitGroup
	for i := range writers {
		wg.Add(2)
		go func() {
			defer wg.Done()
			assert.NoError(t, s.PatchPluginSettings("flux", map[string]any{fmt.Sprintf("kept-%d", i): i}))
		}()
		go func() {
			defer wg.Done()
			_, err := s.ErasePluginSettings("flux", declaring(ordinary...))
			assert.NoError(t, err)
		}()
	}
	wg.Wait()

	saved, err := s.LoadPluginSettings("flux")
	require.NoError(t, err)
	assert.NotContains(t, saved, "token")
	for i := range writers {
		assert.Contains(t, saved, fmt.Sprintf("kept-%d", i), "an erase must not drop a declared value written beside it")
	}
}
