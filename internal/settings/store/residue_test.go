package store

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// These tests read the settings directory the way someone with the files would:
// byte for byte, every file, no database in between. bbolt is copy-on-write and
// does not zero a page it frees, so a value that was deleted or overwritten stays
// readable in the file until the page is reused, and a corrupt-database copy holds
// every value for ever. The store guarantees neither is left behind.

// filesContaining names the regular files directly in dir that hold needle.
func filesContaining(t *testing.T, dir, needle string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	var found []string
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		data, readErr := os.ReadFile(filepath.Join(dir, entry.Name()))
		require.NoError(t, readErr)
		if bytes.Contains(data, []byte(needle)) {
			found = append(found, entry.Name())
		}
	}
	sort.Strings(found)
	return found
}

func openResidueStore(t *testing.T) (*Store, string) {
	t.Helper()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })
	return s, dir
}

func TestEraseLeavesNoCopyOfTheValueInAnyFile(t *testing.T) {
	const planted = "erase-sentinel-3f9a61c07b2e"
	s, dir := openResidueStore(t)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"token": planted, "theme": "dark"}))
	// A second save leaves the earlier page behind as well.
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"token": planted, "theme": "light"}))
	require.NotEmpty(t, filesContaining(t, dir, planted), "the value is in the file while it is stored")

	result, err := s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	assert.Equal(t, 1, result.Erased)
	assert.Empty(t, filesContaining(t, dir, planted), "no file of the settings directory still holds the erased value")
	kept, err := s.LoadPluginSettings("flux")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "light"}, kept, "the ordinary value stays")
}

func TestEraseOfAValueLargerThanAPageLeavesNoCopy(t *testing.T) {
	// A multi-page value (a PEM key, a kubeconfig) sits in a run of overflow pages.
	// Nothing reuses them for as long as smaller writes find free pages below
	// them, so waiting for reuse never ends: 300 unrelated writes did not.
	const planted = "overflow-sentinel-77d0c4e91a5b"
	s, dir := openResidueStore(t)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	for i := range 20 {
		require.NoError(t, s.SavePluginSettings("filler-"+strconv.Itoa(i), map[string]any{"theme": "dark"}))
	}
	big := strings.Repeat("A", 3*os.Getpagesize()) + planted
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"pem": big, "theme": "dark"}))
	require.NotEmpty(t, filesContaining(t, dir, planted))

	_, err := s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	assert.Empty(t, filesContaining(t, dir, planted))
}

func TestClearingAPasswordLeavesNoCopyOfTheOldValue(t *testing.T) {
	const planted = "cleared-sentinel-52b8e0d6c9a1"
	s, dir := openResidueStore(t)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"password": planted, "theme": "dark"}))
	require.NotEmpty(t, filesContaining(t, dir, planted))

	require.NoError(t, s.PatchPluginSettings("flux", map[string]any{"password": ""}))

	assert.Empty(t, filesContaining(t, dir, planted))
	saved, err := s.LoadPluginSettings("flux")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"password": "", "theme": "dark"}, saved)
}

func TestReplacingACredentialLeavesNoCopyOfTheOldValue(t *testing.T) {
	const planted = "replaced-sentinel-0c7e4a91f3d2"
	for name, replace := range map[string]func(*Store) error{
		"patch": func(s *Store) error {
			return s.PatchPluginSettings("flux", map[string]any{"token": "rotated"})
		},
		"save": func(s *Store) error {
			return s.SavePluginSettings("flux", map[string]any{"token": "rotated", "theme": "dark"})
		},
		"save without the key": func(s *Store) error {
			return s.SavePluginSettings("flux", map[string]any{"theme": "dark"})
		},
	} {
		t.Run(name, func(t *testing.T) {
			s, dir := openResidueStore(t)
			require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
			require.NoError(t, s.SavePluginSettings("flux", map[string]any{"token": planted, "theme": "dark"}))
			require.NotEmpty(t, filesContaining(t, dir, planted))

			require.NoError(t, replace(s))

			assert.Empty(t, filesContaining(t, dir, planted))
		})
	}
}

func TestDeletingAPluginsSettingsLeavesNoCopy(t *testing.T) {
	const planted = "deleted-sentinel-9e13b7a05c64"
	s, dir := openResidueStore(t)
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"token": planted}))
	require.NotEmpty(t, filesContaining(t, dir, planted))

	require.NoError(t, s.DeletePluginSettings("flux"))

	assert.Empty(t, filesContaining(t, dir, planted))
}

func TestAnErasedValueDoesNotTakeAnotherPluginsValuesWithIt(t *testing.T) {
	const planted = "neighbour-sentinel-1d6f8c3a72e0"
	s, dir := openResidueStore(t)
	require.NoError(t, s.RememberPluginSchema("flux", []string{"theme"}))
	require.NoError(t, s.RememberPluginSchema("other", []string{"theme"}))
	require.NoError(t, s.SavePluginSettings("flux", map[string]any{"token": "flux-secret-value", "theme": "dark"}))
	require.NoError(t, s.SavePluginSettings("other", map[string]any{"token": planted, "theme": "dark"}))
	require.NoError(t, s.SaveCategory("appearance", map[string]any{"theme": "dark"}))

	_, err := s.ErasePluginSettings("flux", nil)

	require.NoError(t, err)
	assert.Empty(t, filesContaining(t, dir, "flux-secret-value"))
	assert.NotEmpty(t, filesContaining(t, dir, planted), "the other plugin's credential is still stored")
	other, err := s.LoadPluginSettings("other")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"token": planted, "theme": "dark"}, other)
	appearance, err := s.LoadCategory("appearance")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark"}, appearance)
	ordinary, found, err := s.LoadPluginSchema("other")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, []string{"theme"}, ordinary)
}

func TestEraseOfAnEntryThatCannotBeReadLeavesNoCopy(t *testing.T) {
	// The entry cannot be decoded, so it is removed whole; what it held is unknown,
	// and it may have held a credential.
	const planted = "unreadable-sentinel-6b2d90e1f4a8"
	s, dir := openResidueStore(t)
	rawPluginEntry(t, s, "flux", `{"token":"`+planted+`"`)
	require.NotEmpty(t, filesContaining(t, dir, planted))

	result, err := s.ErasePluginSettings("flux", declaring("token"))

	require.NoError(t, err)
	assert.True(t, result.Unreadable)
	assert.Empty(t, filesContaining(t, dir, planted))
}

// --- Corrupt-database copies ---

// corruptName is the name corruption recovery gives the copy it keeps.
func corruptName(base string, made time.Time) string {
	return base + ".corrupt." + strconv.FormatInt(made.Unix(), 10)
}

func writeCorruptCopy(t *testing.T, dir string, made time.Time, content string) string {
	t.Helper()
	name := corruptName("settings.db", made)
	require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600))
	return name
}

func exists(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Lstat(path)
	if err == nil {
		return true
	}
	require.ErrorIs(t, err, os.ErrNotExist)
	return false
}

func TestOpenRemovesACorruptCopyOlderThanAWeek(t *testing.T) {
	dir := t.TempDir()
	old := writeCorruptCopy(t, dir, time.Now().Add(-8*24*time.Hour), "corrupt-sentinel-aa11 every plugin's secrets")

	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	assert.False(t, exists(t, filepath.Join(dir, old)), "a copy older than 7 days does not live on")
	assert.Empty(t, filesContaining(t, dir, "corrupt-sentinel-aa11"))
}

func TestOpenKeepsAYoungCorruptCopyForARecovery(t *testing.T) {
	dir := t.TempDir()
	young := writeCorruptCopy(t, dir, time.Now().Add(-24*time.Hour), "young copy")

	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	data, err := os.ReadFile(filepath.Join(dir, young))
	require.NoError(t, err)
	assert.Equal(t, "young copy", string(data), "a copy inside its week stays, unchanged")
}

func TestOpenKeepsOnlyTheNewestCorruptCopy(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	older := writeCorruptCopy(t, dir, now.Add(-3*24*time.Hour), "older")
	newest := writeCorruptCopy(t, dir, now.Add(-24*time.Hour), "newest")
	middle := writeCorruptCopy(t, dir, now.Add(-2*24*time.Hour), "middle")

	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	assert.True(t, exists(t, filepath.Join(dir, newest)))
	assert.False(t, exists(t, filepath.Join(dir, middle)))
	assert.False(t, exists(t, filepath.Join(dir, older)))
}

func TestOpenNeverRemovesTheCorruptCopyItMadeInThisRun(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.db")
	older := writeCorruptCopy(t, dir, time.Now().Add(-48*time.Hour), "older copy")
	require.NoError(t, os.WriteFile(path, []byte("this is not a valid bbolt database"), 0o600))

	s, err := Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	var copies []string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "settings.db.corrupt.") {
			copies = append(copies, entry.Name())
		}
	}
	require.Len(t, copies, 1, "the copy of this run is the one copy that is kept")
	assert.NotEqual(t, older, copies[0])
	data, err := os.ReadFile(filepath.Join(dir, copies[0]))
	require.NoError(t, err)
	assert.Equal(t, "this is not a valid bbolt database", string(data), "it still holds what was found, for a recovery")
}

func TestOpenLeavesEveryOtherFileAlone(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows strips the trailing dot of \"settings.db.corrupt.\", so that name and \"settings.db.corrupt\" are one file")
	}
	dir := t.TempDir()
	stamp := strconv.FormatInt(time.Now().Add(-30*24*time.Hour).Unix(), 10)
	names := []string{
		"settings.db.corrupt.",               // no timestamp
		"settings.db.corrupt." + stamp + "x", // not a bare timestamp
		"settings.db.corrupt." + stamp + ".bak",
		"settings.db.corrupt.0" + stamp, // not the shape the store writes
		"settings.db.corrupt.-" + stamp,
		"settings.db.corrupt.+" + stamp,
		"settings.db.corrupt.abc",
		"settings.db.corrupt",
		"settings.db.bak." + stamp,
		"other.db.corrupt." + stamp,
		"xsettings.db.corrupt." + stamp,
		"settings.db.corrupt." + stamp + ".1",
		"settings.db-corrupt." + stamp,
		"notes.txt",
	}
	for _, name := range names {
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte("keep "+name), 0o600))
	}
	// A directory with the shape of a copy's name is not a copy.
	directory := "settings.db.corrupt." + strconv.FormatInt(time.Now().Add(-31*24*time.Hour).Unix(), 10)
	require.NoError(t, os.Mkdir(filepath.Join(dir, directory), 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, directory, "inside"), []byte("keep"), 0o600))

	s, err := Open(filepath.Join(dir, "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	for _, name := range names {
		data, readErr := os.ReadFile(filepath.Join(dir, name))
		require.NoError(t, readErr, name)
		assert.Equal(t, "keep "+name, string(data), name)
	}
	inside, err := os.ReadFile(filepath.Join(dir, directory, "inside"))
	require.NoError(t, err)
	assert.Equal(t, "keep", string(inside))
}
