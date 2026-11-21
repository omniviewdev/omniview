package store

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
)

// A settings file of the old GOB format that was migrated into the database is
// kept beside where it was, as settings.gob.bak (settings.gob.bak.N when that name
// is taken), in case the migration lost something. It holds the same plaintext
// values the database does, passwords included, and nothing reads it again, so it
// does not live for ever: it is overwritten with zeros and removed a week after
// its migration, counted from its modification time, which the migration sets.

const (
	gobBackupName = "settings.gob.bak"
	// gobBackupMaxAge is how long a backup stays for a recovery.
	gobBackupMaxAge = 7 * 24 * time.Hour
	// gobBackupLimit is the highest N renameToBackup numbers a backup with.
	gobBackupLimit = 100
)

// isGOBBackupName reports whether name is one renameToBackup gives a backup: the
// bare name, or the name with a canonical number from 1 to the limit.
func isGOBBackupName(name string) bool {
	if name == gobBackupName {
		return true
	}
	number, found := strings.CutPrefix(name, gobBackupName+".")
	if !found {
		return false
	}
	n, err := strconv.Atoi(number)
	return err == nil && n >= 1 && n <= gobBackupLimit && strconv.Itoa(n) == number
}

// pruneMigrationBackups removes the backups of earlier migrations that are older
// than a week, in the state root (the core settings) and in every plugin's
// directory. Failures are logged by class and left for the next start.
func (s *Store) pruneMigrationBackups(stateRoot string) {
	if s == nil {
		return
	}
	now := s.cfg.clock()
	directories := []string{stateRoot}
	pluginsDir := filepath.Join(stateRoot, "plugins")
	if entries, err := os.ReadDir(pluginsDir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				directories = append(directories, filepath.Join(pluginsDir, entry.Name()))
			}
		}
	}
	removed, failed := 0, 0
	var lastErr error
	for _, directory := range directories {
		gone, stuck, err := pruneBackupsIn(directory, now)
		removed += gone
		failed += stuck
		if err != nil {
			lastErr = err
		}
	}
	ctx := context.Background()
	switch {
	case failed > 0:
		s.logger().Warnw(ctx, "could not remove every old backup of a migrated settings file",
			"removed", removed, "failed", failed, "errorClass", telemetryutil.ErrorClass(lastErr))
	case removed > 0:
		s.logger().Infow(ctx, "removed old backups of migrated settings files", "removed", removed)
	}
}

// pruneBackupsIn overwrites and removes the backups in one directory that are older
// than a week at now. It returns how many it removed and how many it could not
// (a directory it cannot list counts as one), and the last error.
func pruneBackupsIn(directory string, now time.Time) (int, int, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return 0, 1, err
	}
	removed, failed := 0, 0
	var lastErr error
	for _, entry := range entries {
		if !isGOBBackupName(entry.Name()) || !entry.Type().IsRegular() {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil || now.Sub(info.ModTime()) <= gobBackupMaxAge {
			continue
		}
		if removeErr := zeroAndRemove(filepath.Join(directory, entry.Name())); removeErr != nil {
			lastErr = removeErr
			failed++
			continue
		}
		removed++
	}
	return removed, failed, lastErr
}
