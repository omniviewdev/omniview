package store

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	bolt "go.etcd.io/bbolt"
	boltErrors "go.etcd.io/bbolt/errors"
)

// The host remembers, per plugin, which of the settings the plugin declared are
// ordinary preferences. An uninstall classifies the plugin's stored values with
// it when the plugin did not run in the session: it keeps the ordinary values
// and erases the rest. Whatever is not known fails closed.

func rawSchemaEntry(t *testing.T, s *Store, pluginID, raw string) {
	t.Helper()
	require.NoError(t, s.db.Update(func(tx *bolt.Tx) error {
		return pluginSchemas(tx).Put([]byte(pluginID), []byte(raw))
	}))
}

func readRawSchemaEntry(t *testing.T, s *Store, pluginID string) []byte {
	t.Helper()
	var raw []byte
	require.NoError(t, s.db.View(func(tx *bolt.Tx) error {
		raw = append(raw, pluginSchemas(tx).Get([]byte(pluginID))...)
		return nil
	}))
	return raw
}

// pageWrites counts the pages bbolt has written to the database file so far.
func pageWrites(s *Store) int64 {
	stats := s.db.Stats()
	return stats.TxStats.GetWrite()
}

func TestRememberPluginSchemaRoundTrips(t *testing.T) {
	s := openPatchStore(t)

	_, found, err := s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.False(t, found, "nothing is remembered before the plugin first reports a schema")

	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme", "retries", "theme"}))
	ordinary, found, err := s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, []string{"retries", "theme"}, ordinary, "sorted and deduplicated")
	assert.JSONEq(t, `{"v":1,"ordinary":["retries","theme"]}`, string(readRawSchemaEntry(t, s, "flux")),
		"the document holds the version and the IDs and nothing else")

	// The last known schema replaces the earlier one: it is not a union.
	require.NoError(t, s.RememberPluginSchema("flux", []string{"retries"}))
	ordinary, _, err = s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.Equal(t, []string{"retries"}, ordinary)

	// A schema with no ordinary setting is remembered too: it is not "unknown".
	require.NoError(t, s.RememberPluginSchema("flux", nil))
	ordinary, found, err = s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Empty(t, ordinary)
	assert.JSONEq(t, `{"v":1,"ordinary":[]}`, string(readRawSchemaEntry(t, s, "flux")))
}

func TestRememberPluginSchemaWritesNothingWhenTheSchemaIsUnchanged(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	before := pageWrites(s)

	// A plugin starts many times with the same schema: that costs no write.
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme", "theme"}))
	assert.Equal(t, before, pageWrites(s), "an unchanged schema must not be written again")

	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme", "retries"}))
	assert.Greater(t, pageWrites(s), before, "a changed schema is written")
	ordinary, _, err := s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.Equal(t, []string{"retries", "theme"}, ordinary)
}

func TestLoadPluginSchemaTreatsUnknownOrUnreadableDocumentsAsAbsent(t *testing.T) {
	for name, raw := range map[string]string{
		"future version": `{"v":2,"ordinary":["theme"]}`,
		"no version":     `{"ordinary":["theme"]}`,
		"version zero":   `{"v":0,"ordinary":["theme"]}`,
		"not json":       `{"v":1,"ordinary":["theme"]`,
		"wrong shape":    `{"v":1,"ordinary":"theme"}`,
		"no list":        `{"v":1}`,
		"null list":      `{"v":1,"ordinary":null}`,
		"not an object":  `["theme"]`,
	} {
		t.Run(name, func(t *testing.T) {
			s := openPatchStore(t)
			rawSchemaEntry(t, s, "flux", raw)
			require.NoError(t, s.SavePluginSettings("flux", map[string]any{"theme": "dark", "token": "s3cret"}))

			_, found, err := s.LoadPluginSchema("flux")
			require.NoError(t, err)
			assert.False(t, found)
			// And so the uninstall fails closed: nothing proves a value is ordinary.
			result, err := s.ErasePluginSettings("flux", nil)
			require.NoError(t, err)
			assert.Equal(t, EraseBasisNone, result.Basis)
			assert.Equal(t, 2, result.Erased)
			assert.Empty(t, readRawPluginEntry(t, s, "flux"))
		})
	}
}

func TestRememberPluginSchemaTooLargeToKeepForgetsInstead(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))

	err := s.RememberPluginSchema("flux", []string{strings.Repeat("x", maxRememberedIDBytes+1)})
	require.ErrorIs(t, err, ErrSchemaTooLarge)
	_, found, loadErr := s.LoadPluginSchema("flux")
	require.NoError(t, loadErr)
	assert.False(t, found, "an earlier, more permissive schema must not survive")

	many := make([]string, maxRememberedSettings+1)
	for i := range many {
		many[i] = fmt.Sprintf("setting-%d", i)
	}
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	require.ErrorIs(t, s.RememberPluginSchema("flux", many), ErrSchemaTooLarge)
	_, found, loadErr = s.LoadPluginSchema("flux")
	require.NoError(t, loadErr)
	assert.False(t, found)
}

func TestRememberPluginSchemaKeepsASchemaAtTheBounds(t *testing.T) {
	s := openPatchStore(t)
	longest := strings.Repeat("x", maxRememberedIDBytes)
	require.NoError(t, s.RememberPluginSchema("flux", []string{longest}))
	ordinary, found, err := s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, []string{longest}, ordinary)

	most := make([]string, maxRememberedSettings)
	for i := range most {
		most[i] = fmt.Sprintf("setting-%d", i)
	}
	require.NoError(t, s.RememberPluginSchema("flux", most))
	ordinary, found, err = s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Len(t, ordinary, maxRememberedSettings)
}

func TestForgetPluginSchemaDropsOnlyThatPluginsSchema(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	require.NoError(t, s.RememberPluginSchema("other", []string{"theme"}))

	require.NoError(t, s.ForgetPluginSchema("flux"))
	require.NoError(t, s.ForgetPluginSchema("never-remembered"))

	_, found, err := s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.False(t, found)
	_, found, err = s.LoadPluginSchema("other")
	require.NoError(t, err)
	assert.True(t, found)
}

func TestErasePluginSettingsUsesTheRememberedSchemaWhenNoneIsGiven(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme", "retries"}))
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{
		"theme": "dark", "retries": 3, "apiToken": "s3cret", "undeclared": "maybe-a-secret",
	}))

	result, err := s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	assert.Equal(t, EraseResult{Erased: 2, Kept: 2, Basis: EraseBasisRemembered, Unreadable: false}, result)
	saved, err := s.LoadPluginSettings("flux")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark", "retries": float64(3)}, saved)
	_, found, err := s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.True(t, found, "the schema stays while values it describes stay")

	// Erasing again changes nothing: a retried uninstall finds only ordinary values.
	again, err := s.ErasePluginSettings("flux", nil)
	require.NoError(t, err)
	assert.Equal(t, EraseResult{Erased: 0, Kept: 2, Basis: EraseBasisRemembered, Unreadable: false}, again)
	saved, err = s.LoadPluginSettings("flux")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark", "retries": float64(3)}, saved)
}

func TestErasePluginSettingsPrefersTheSchemaOfThisSession(t *testing.T) {
	s := openPatchStore(t)
	// The plugin's latest version declares `endpoint` sensitive; an earlier
	// remembered schema called it ordinary.
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme", "endpoint"}))
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"theme": "dark", "endpoint": "https://user:pw@host"}))

	result, err := s.ErasePluginSettings("flux", declaring("theme"))

	require.NoError(t, err)
	assert.Equal(t, EraseBasisSession, result.Basis)
	saved, err := s.LoadPluginSettings("flux")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark"}, saved)
}

func TestErasePluginSettingsWithoutAnySchemaErasesEveryValueAndSaysSo(t *testing.T) {
	s := openPatchStore(t)
	// A plugin installed before schemas were remembered, never started since.
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"theme": "dark", "apiToken": "s3cret"}))

	result, err := s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	assert.Equal(t, EraseResult{Erased: 2, Kept: 0, Basis: EraseBasisNone, Unreadable: false}, result,
		"the result says that nothing was known, so every value was erased")
	assert.Empty(t, readRawPluginEntry(t, s, "flux"))
}

func TestErasePluginSettingsForgetsTheSchemaWithTheEntry(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"apiToken": "s3cret"}))
	require.NoError(t, s.RememberPluginSchema("other", []string{"theme"}))

	_, err := s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	_, found, err := s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.False(t, found, "nothing is left for the schema to describe")
	_, found, err = s.LoadPluginSchema("other")
	require.NoError(t, err)
	assert.True(t, found, "another plugin's schema is never touched")
}

func TestErasePluginSettingsForgetsTheSchemaOfAPluginWithNoStoredValues(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))

	result, err := s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	assert.Equal(t, 0, result.Erased+result.Kept)
	_, found, err := s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestErasePluginSettingsRemovesTheSchemaWithAnUndecodableEntry(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	rawPluginEntry(t, s, "flux", `{"theme":"dark"`)

	result, err := s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	assert.True(t, result.Unreadable)
	assert.Empty(t, readRawPluginEntry(t, s, "flux"))
	_, found, err := s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestErasePluginSettingsKeepsAnotherPluginsSchemaAndValues(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"theme": "dark", "token": "s3cret"}))
	require.NoError(t, s.RememberPluginSchema("other", []string{"theme"}))
	require.NoError(t, s.SavePluginSettings("other", map[string]any{"theme": "dark", "token": "other-s3cret"}))

	_, err := s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	other, err := s.LoadPluginSettings("other")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark", "token": "other-s3cret"}, other)
	ordinary, found, err := s.LoadPluginSchema("other")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, []string{"theme"}, ordinary)
}

func TestOpenAddsTheSchemaBucketToADatabaseFromBeforeSchemasWereRemembered(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.db")
	old, err := bolt.Open(path, 0o600, nil)
	require.NoError(t, err)
	require.NoError(t, old.Update(func(tx *bolt.Tx) error {
		for _, name := range [][]byte{coreBucket, pluginsBucket, mcpBucket} {
			if _, bucketErr := tx.CreateBucket(name); bucketErr != nil {
				return bucketErr
			}
		}
		return tx.Bucket(pluginsBucket).Put([]byte("flux"), []byte(`{"theme":"dark"}`))
	}))
	require.NoError(t, old.Close())

	s, err := Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, s.Close()) })

	saved, err := s.LoadPluginSettings("flux")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark"}, saved)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	_, found, err := s.LoadPluginSchema("flux")
	require.NoError(t, err)
	assert.True(t, found)
	// A plugin of that database, uninstalled before it ever started: no schema, so
	// every value goes.
	require.NoError(t, s.ForgetPluginSchema("flux"))
	result, err := s.ErasePluginSettings("flux", nil)
	require.NoError(t, err)
	assert.Equal(t, EraseBasisNone, result.Basis)
}

func TestSchemaOperationsReportAClosedStoreAndAMissingStore(t *testing.T) {
	s := openPatchStore(t)
	require.NoError(t, s.Close())
	require.ErrorIs(t, s.RememberPluginSchema("flux", []string{"theme"}), boltErrors.ErrDatabaseNotOpen)
	require.ErrorIs(t, s.ForgetPluginSchema("flux"), boltErrors.ErrDatabaseNotOpen)
	_, _, err := s.LoadPluginSchema("flux")
	require.ErrorIs(t, err, boltErrors.ErrDatabaseNotOpen)

	var missing *Store
	require.ErrorIs(t, missing.RememberPluginSchema("flux", []string{"theme"}), ErrUnavailable)
	require.ErrorIs(t, missing.ForgetPluginSchema("flux"), ErrUnavailable)
	_, _, err = missing.LoadPluginSchema("flux")
	require.ErrorIs(t, err, ErrUnavailable)
}
