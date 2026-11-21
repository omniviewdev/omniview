package store

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
)

// A database that cannot be read is renamed, not deleted, so that a person can
// recover what it held: <path>.corrupt.<unix seconds>. The copy holds every
// plugin's settings, credentials included, so it does not live for ever. Opening
// the store keeps one copy at most, the newest, and only for a week:
//
//   - the copy made in this run is always kept, and every other copy goes;
//   - when this run made none, the newest copy is kept if it is not older than a
//     week, and every other copy goes;
//   - a copy that goes is overwritten with zeros before it is removed.
//
// Only a regular file named exactly <database>.corrupt.<seconds> is a copy; no
// other name in the directory is touched.

const (
	// corruptInfix joins the database's name to the second its copy was made.
	corruptInfix = ".corrupt."
	// corruptCopyMaxAge is how long the newest copy stays for a recovery.
	corruptCopyMaxAge = 7 * 24 * time.Hour
)

// corruptCopyPath is where corruption recovery keeps the copy it makes, at the
// given time, of the database at path.
func corruptCopyPath(path string, made time.Time) string {
	return path + corruptInfix + strconv.FormatInt(made.Unix(), 10)
}

// corruptCopy is a file that corruption recovery made.
type corruptCopy struct {
	// name is the file name, in the database's directory.
	name string
	// made is the second the name carries.
	made time.Time
	// modified is the file's modification time.
	modified time.Time
}

// parseCorruptCopyName returns the time in the name of a copy of the database
// called base. It accepts the shape the store writes and nothing else: no sign,
// no leading zero, no suffix.
func parseCorruptCopyName(base, name string) (time.Time, bool) {
	stamp, found := strings.CutPrefix(name, base+corruptInfix)
	if !found {
		return time.Time{}, false
	}
	seconds, err := strconv.ParseInt(stamp, 10, 64)
	if err != nil || seconds <= 0 || strconv.FormatInt(seconds, 10) != stamp {
		return time.Time{}, false
	}
	return time.Unix(seconds, 0), true
}

// listCorruptCopies picks the copies of the database called base out of a
// directory listing. A directory, a link or any other kind of file is not one.
func listCorruptCopies(entries []fs.DirEntry, base string) []corruptCopy {
	var copies []corruptCopy
	for _, entry := range entries {
		made, isCopy := parseCorruptCopyName(base, entry.Name())
		if !isCopy || !entry.Type().IsRegular() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		copies = append(copies, corruptCopy{name: entry.Name(), made: made, modified: info.ModTime()})
	}
	return copies
}

// madeAt is when the copy was made, as far as its age goes: the time in its name,
// unless that lies in the future (a clock that ran ahead, or a name the store did
// not write), when the file's modification time stands in. A copy that still lies
// in the future by both is not old, and counts as the newest.
func (c corruptCopy) madeAt(now time.Time) time.Time {
	if c.made.After(now) {
		return c.modified
	}
	return c.made
}

// copiesToPrune says which of the copies go. current names the copy made in this
// run ("" when none): it stays whatever the clock says.
func copiesToPrune(copies []corruptCopy, current string, now time.Time) []corruptCopy {
	keep := current
	if keep == "" {
		keep = newestWithinAWeek(copies, now)
	}
	var doomed []corruptCopy
	for _, c := range copies {
		if c.name != keep {
			doomed = append(doomed, c)
		}
	}
	return doomed
}

// newestWithinAWeek names the newest copy, or "" when there is none or the
// newest is older than a week.
func newestWithinAWeek(copies []corruptCopy, now time.Time) string {
	newest := ""
	var newestAt time.Time
	for _, c := range copies {
		at := c.madeAt(now)
		if newest == "" || at.After(newestAt) || (at.Equal(newestAt) && c.name > newest) {
			newest, newestAt = c.name, at
		}
	}
	if newest != "" && now.Sub(newestAt) > corruptCopyMaxAge {
		return ""
	}
	return newest
}

// pruneCorruptCopies applies the retention rule to the copies in entries, the
// listing of the database's directory. current names the copy made in this run.
// A copy that cannot be removed is logged by class and left for the next start.
func (s *Store) pruneCorruptCopies(entries []fs.DirEntry, current string) {
	directory := filepath.Dir(s.path)
	doomed := copiesToPrune(listCorruptCopies(entries, filepath.Base(s.path)), current, s.cfg.clock())
	removed := 0
	var lastErr error
	for _, c := range doomed {
		if err := zeroAndRemove(filepath.Join(directory, c.name)); err != nil {
			lastErr = err
			continue
		}
		removed++
	}
	if len(doomed) == 0 {
		return
	}
	ctx := context.Background()
	if lastErr != nil {
		s.logger().Warnw(ctx, "could not remove every old copy of a corrupt settings database",
			"removed", removed, "failed", len(doomed)-removed, "errorClass", telemetryutil.ErrorClass(lastErr))
		return
	}
	s.logger().Infow(ctx, "removed old copies of a corrupt settings database", "removed", removed)
}

// readDirectory lists dir. It returns nothing when dir cannot be read: the store
// then opens without its housekeeping, and bbolt reports the real problem.
func readDirectory(dir string) []fs.DirEntry {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	return entries
}
