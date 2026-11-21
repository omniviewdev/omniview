package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/plugin-sdk/settings"
)

// The GOB file a migration leaves as settings.gob.bak holds the plaintext values
// of the old format, for a week.

func TestIsGOBBackupName(t *testing.T) {
	for _, name := range []string{"settings.gob.bak", "settings.gob.bak.1", "settings.gob.bak.99", "settings.gob.bak.100"} {
		assert.True(t, isGOBBackupName(name), name)
	}
	for _, name := range []string{
		"settings.gob.bak.", "settings.gob.bak.0", "settings.gob.bak.101", "settings.gob.bak.01", "settings.gob.bak.+1",
		"settings.gob.bak.-1", "settings.gob.bak.1x", "settings.gob.bak.1.2", "settings.gob.bak2", "settings.gob",
		"settings", "xsettings.gob.bak", "Settings.gob.bak", "settings.gob.bak~", "settings.gob.bak ",
	} {
		assert.False(t, isGOBBackupName(name), name)
	}
}

func writeBackup(t *testing.T, path string, modified time.Time, content string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o700))
	require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
	require.NoError(t, os.Chtimes(path, modified, modified))
}

func TestMigrateFromGOBRemovesBackupsOlderThanAWeek(t *testing.T) {
	root := t.TempDir()
	now := corruptNow()
	old := now.Add(-8 * 24 * time.Hour)
	fresh := now.Add(-24 * time.Hour)
	week := now.Add(-7 * 24 * time.Hour)
	// The core backups, the plugins' and files that only look like them.
	writeBackup(t, filepath.Join(root, "settings.gob.bak"), old, "core-backup-sentinel "+scrubPlanted)
	writeBackup(t, filepath.Join(root, "settings.gob.bak.1"), old, "numbered")
	writeBackup(t, filepath.Join(root, "settings.gob.bak.2"), fresh, "fresh numbered")
	writeBackup(t, filepath.Join(root, "plugins", "flux", "settings.gob.bak"), old, "plugin-backup-sentinel "+scrubPlanted)
	writeBackup(t, filepath.Join(root, "plugins", "calm", "settings.gob.bak"), week, "exactly a week")
	writeBackup(t, filepath.Join(root, "plugins", "calm", "settings.gob.bak.7"), old, "old numbered beside it")
	writeBackup(t, filepath.Join(root, "plugins", "calm", "settings.gob.bak.old"), old, "not a backup name")
	writeBackup(t, filepath.Join(root, "plugins", "calm", "notes.txt"), old, "not a backup")
	writeBackup(t, filepath.Join(root, "plugins", "orphan", "settings.gob.bak.3"), old, "numbered without the bare one")
	writeBackup(t, filepath.Join(root, "other", "settings.gob.bak"), old, "not under plugins")
	writeBackup(t, filepath.Join(root, "plugins", "loose-file.gob.bak"), old, "a file, not a plugin directory")
	require.NoError(t, os.Mkdir(filepath.Join(root, "plugins", "dir"), 0o700))
	require.NoError(t, os.Mkdir(filepath.Join(root, "plugins", "dir", "settings.gob.bak"), 0o700))
	s, err := Open(filepath.Join(root, "settings.db"), clockAt(now))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	require.NoError(t, MigrateFromGOB(root, s))

	gone := []string{
		"settings.gob.bak", "settings.gob.bak.1", "plugins/flux/settings.gob.bak", "plugins/calm/settings.gob.bak.7",
		"plugins/orphan/settings.gob.bak.3", // numbered, with no bare backup beside it
	}
	for _, name := range gone {
		assert.False(t, exists(t, filepath.Join(root, filepath.FromSlash(name))), name)
	}
	kept := []string{
		"settings.gob.bak.2", "plugins/calm/settings.gob.bak", "plugins/calm/settings.gob.bak.old", "plugins/calm/notes.txt",
		"other/settings.gob.bak", "plugins/loose-file.gob.bak", "plugins/dir/settings.gob.bak",
	}
	for _, name := range kept {
		assert.True(t, exists(t, filepath.Join(root, filepath.FromSlash(name))), name)
	}
	assert.Empty(t, filesContaining(t, root, "core-backup-sentinel"))
	assert.Empty(t, filesContaining(t, filepath.Join(root, "plugins", "flux"), "plugin-backup-sentinel"))
}

func TestABackupIsOverwrittenBeforeItIsRemoved(t *testing.T) {
	root := t.TempDir()
	now := corruptNow()
	path := filepath.Join(root, "settings.gob.bak")
	writeBackup(t, path, now.Add(-30*24*time.Hour), "legacy password "+scrubPlanted)
	witness := filepath.Join(root, "witness")
	if err := os.Link(path, witness); err != nil {
		t.Skipf("hard links are not available here: %v", err)
	}
	before, err := os.ReadFile(witness)
	require.NoError(t, err)
	s, err := Open(filepath.Join(root, "settings.db"), clockAt(now))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	require.NoError(t, MigrateFromGOB(root, s))

	assert.False(t, exists(t, path))
	after, err := os.ReadFile(witness)
	require.NoError(t, err)
	assert.Equal(t, make([]byte, len(before)), after)
}

func TestABackupMadeByThisMigrationIsNotPrunedAndStartsItsWeekNow(t *testing.T) {
	root := t.TempDir()
	now := corruptNow()
	gobPath := filepath.Join(root, "settings")
	writeGOBFile(t, gobPath, settings.Store{
		"general": {Settings: map[string]settings.Setting{"theme": {ID: "theme", Value: "dark"}}},
	})
	// The old host last wrote the file long ago.
	require.NoError(t, os.Chtimes(gobPath, now.Add(-400*24*time.Hour), now.Add(-400*24*time.Hour)))
	s, err := Open(filepath.Join(root, "settings.db"), clockAt(now))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })

	require.NoError(t, MigrateFromGOB(root, s))

	backup := filepath.Join(root, "settings.gob.bak")
	info, err := os.Stat(backup)
	require.NoError(t, err, "the backup this migration made stays")
	assert.WithinDuration(t, now, info.ModTime(), time.Second, "its week counts from the migration")

	// Six days on it is still there; eight days on it goes.
	require.NoError(t, MigrateFromGOB(root, storeWithClock(t, now.Add(6*24*time.Hour))))
	assert.True(t, exists(t, backup))
	require.NoError(t, MigrateFromGOB(root, storeWithClock(t, now.Add(8*24*time.Hour))))
	assert.False(t, exists(t, backup))
}

// storeWithClock opens a store of its own, with a clock set to now, for a call
// that only needs the clock.
func storeWithClock(t *testing.T, now time.Time) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "other.db"), clockAt(now))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestMigrateFromGOBWithoutAStoreRemovesNothing(t *testing.T) {
	var s *Store
	assert.NotPanics(t, func() { s.pruneMigrationBackups(t.TempDir()) })
}

func TestANumberedBackupGoesAWeekAfterItsOwnMigrationWhateverBecameOfTheBareOne(t *testing.T) {
	root := t.TempDir()
	now := corruptNow()
	writeBackup(t, filepath.Join(root, "settings.gob.bak"), now.Add(-8*24*time.Hour), "first migration")
	writeBackup(t, filepath.Join(root, "settings.gob.bak.1"), now.Add(-24*time.Hour), "second migration "+scrubPlanted)

	// First start: the bare backup is over a week old and goes; the numbered one is not.
	first := storeWithClock(t, now)
	require.NoError(t, MigrateFromGOB(root, first))
	assert.False(t, exists(t, filepath.Join(root, "settings.gob.bak")))
	assert.True(t, exists(t, filepath.Join(root, "settings.gob.bak.1")))

	// Later starts: with the bare one gone the numbered one is still looked at.
	later := storeWithClock(t, now.Add(7*24*time.Hour))
	require.NoError(t, MigrateFromGOB(root, later))
	assert.False(t, exists(t, filepath.Join(root, "settings.gob.bak.1")), "it does not stay for ever because the bare one is gone")
	assert.Empty(t, filesContaining(t, root, scrubPlanted))
}
