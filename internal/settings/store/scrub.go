package store

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	bolt "go.etcd.io/bbolt"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
)

// A scrub removes the old bytes of a credential that was deleted or overwritten.
//
// bbolt is copy-on-write and does not wipe the pages it frees. A freed page keeps
// what it held until a later write happens to reuse it, which may be never: a
// value that spans pages was still in the file after 300 unrelated writes. No
// bbolt option changes that, and neither does overwriting the value with zeros
// before deleting it (the zeros go to a new page, the old page is freed as it
// was). What does is a copy of the database that holds only what is live, put in
// the old file's place, with the old file overwritten.
//
// The transaction that deletes or overwrites a credential-class value sets a
// marker in the same transaction, so the marker and the change commit together or
// not at all. The store then scrubs, and the compacted copy, which does not
// carry the marker, is what clears it. If the process dies, or the scrub fails,
// the marker is still in the file and the next start scrubs.
//
// Replacing the file is crash-safe because nothing is destroyed until the new
// file is complete, verified and durable under its own name, and the one
// destructive step, overwriting the replaced file, comes last:
//
//	settings.db                     the live database
//	settings.db.scrub-new           the copy, written and verified (never complete under another name)
//	settings.db.scrub-old           the replaced file, until it is overwritten
//
//	1. write the copy to settings.db.scrub-new, flush it and its directory entry
//	2. close the database, rename settings.db to settings.db.scrub-old
//	3. rename settings.db.scrub-new to settings.db, open it
//	4. overwrite settings.db.scrub-old with zeros, flush, remove it
//
// A crash leaves a state recoverScrub resolves when the store is next opened:
// the old file when the copy is not installed, the copy when it is, and in
// either case no database is ever left without a file to open.
//
// Windows will not rename or replace an open file, so the database is closed
// before the renames and opened again after, as above. The code is written for
// that and compiled for it, but has not been run there.

const (
	// metaBucketName names the bucket for the store's own bookkeeping.
	metaBucketName = "meta"
	// scrubPendingKey is the marker that says a credential-class value was deleted
	// or overwritten and its old bytes are not yet scrubbed from the file.
	scrubPendingKey = "scrub-pending"

	scrubNewSuffix = ".scrub-new"
	scrubOldSuffix = ".scrub-old"

	// settingsFileMode is the mode of the database and of everything made from it.
	settingsFileMode = 0o600
	// openTimeout is how long to wait for the file lock.
	openTimeout = time.Second
	// compactTxMaxBytes bounds how much one transaction of the copy holds.
	compactTxMaxBytes = 4 << 20
)

// The steps of a scrub that change files, named for the fault hook.
const (
	stepBuild      = "build"
	stepVerify     = "verify"
	stepParkOld    = "park-old"
	stepInstallNew = "install-new"
	stepReopen     = "reopen"
	stepZeroOld    = "zero-old"
	stepRecover    = "recover"
	stepRestore    = "restore"
)

// ErrScrubFailed reports that a value was deleted or overwritten but its old
// bytes could not be removed from the settings file. The store keeps working, and
// the scrub is owed: it is retried by the next erase and at the next start.
var ErrScrubFailed = errors.New("settings file could not be scrubbed of a deleted value")

// guardedDB is the open database with the lock that lets a scrub replace the file
// under it. Every operation holds the read side while it runs; the scrub holds the
// write side from the moment it closes the database until it is open again, so
// nothing ever sees the database without its file.
type guardedDB struct {
	mu    sync.RWMutex
	inner *bolt.DB
}

func (g *guardedDB) Update(fn func(*bolt.Tx) error) error {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.inner.Update(fn)
}

func (g *guardedDB) View(fn func(*bolt.Tx) error) error {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.inner.View(fn)
}

func (g *guardedDB) Stats() bolt.Stats {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.inner.Stats()
}

func (g *guardedDB) Close() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.inner.Close()
}

// markScrubPending records, in the transaction that deletes or overwrites a
// credential-class value, that the file still holds its old bytes.
func markScrubPending(tx *bolt.Tx) error {
	meta, err := tx.CreateBucketIfNotExists([]byte(metaBucketName))
	if err != nil {
		return fmt.Errorf("create meta bucket: %w", err)
	}
	if meta.Get([]byte(scrubPendingKey)) != nil {
		return nil
	}
	return meta.Put([]byte(scrubPendingKey), []byte{1})
}

// scrubIsPending reports whether the marker is set.
func scrubIsPending(tx *bolt.Tx) bool {
	meta := tx.Bucket([]byte(metaBucketName))
	return meta != nil && meta.Get([]byte(scrubPendingKey)) != nil
}

// scrubOwed reports whether there is scrub work: the marker is set, or an earlier
// scrub left a file that still has to be overwritten.
func (s *Store) scrubOwed() (bool, error) {
	if s == nil || s.db == nil {
		return false, ErrUnavailable
	}
	pending := false
	err := s.db.View(func(tx *bolt.Tx) error {
		pending = scrubIsPending(tx)
		return nil
	})
	if err != nil {
		return false, err
	}
	copyLeft, err := pathExists(s.path + scrubNewSuffix)
	if err != nil {
		return false, err
	}
	oldLeft, err := pathExists(s.path + scrubOldSuffix)
	if err != nil {
		return false, err
	}
	return pending || copyLeft || oldLeft, nil
}

// scrubPending does the scrub work that is owed, and does nothing, not even a
// look at the file, when none is. It makes no span or log of its own: it is for a
// caller whose own span records the failure, which an erase's does.
func (s *Store) scrubPending() error {
	owed, err := s.scrubOwed()
	if err != nil || !owed {
		return err
	}
	return s.scrub()
}

// scrubTraced is scrubPending in a span of its own, for a caller that no span of
// its own covers.
func (s *Store) scrubTraced() error {
	owed, err := s.scrubOwed()
	if err != nil || !owed {
		return err
	}
	return s.persistOperation("settings.Scrub", "", "", s.scrub)
}

// scrubAfterWrite scrubs after a write that overwrote a credential-class value.
// The write itself succeeded and the caller is not told otherwise: a scrub that
// fails has been logged by class, and is owed until the next erase or start.
func (s *Store) scrubAfterWrite() {
	_ = s.scrubTraced()
}

// scrub overwrites what an earlier scrub left behind and, if the marker is set,
// replaces the database file with a compacted copy and overwrites the old file.
// Every operation of the store waits for it.
func (s *Store) scrub() error {
	if s == nil || s.db == nil || s.path == "" {
		return ErrUnavailable
	}
	s.db.mu.Lock()
	defer s.db.mu.Unlock()
	pending := false
	if err := s.db.inner.View(func(tx *bolt.Tx) error {
		pending = scrubIsPending(tx)
		return nil
	}); err != nil {
		return err
	}
	if err := s.removeScrubLeftovers(); err != nil {
		return fmt.Errorf("%w: %w", ErrScrubFailed, err)
	}
	if !pending {
		return nil
	}
	started := time.Now()
	before := fileSize(s.path)
	if err := s.replaceWithCompacted(); err != nil {
		return err
	}
	s.logger().Infow(context.Background(), "settings database scrubbed of deleted values",
		"bytesBefore", before, "bytesAfter", fileSize(s.path), "elapsedMillis", time.Since(started).Milliseconds())
	return nil
}

// removeScrubLeftovers overwrites and removes what an earlier scrub left behind.
// The live file is good, so neither leftover is needed.
func (s *Store) removeScrubLeftovers() error {
	return errors.Join(zeroAndRemove(s.path+scrubNewSuffix), zeroAndRemove(s.path+scrubOldSuffix))
}

// replaceWithCompacted puts a verified compacted copy in the file's place and
// overwrites the file it replaced. The caller holds the write lock.
func (s *Store) replaceWithCompacted() error {
	newPath, oldPath := s.path+scrubNewSuffix, s.path+scrubOldSuffix
	durable := s.cfg.directoryFlushes(filepath.Dir(s.path))
	if err := s.buildReplacement(newPath); err != nil {
		return fmt.Errorf("%w: %w", ErrScrubFailed, err)
	}
	if err := s.swapIn(newPath, oldPath); err != nil {
		return fmt.Errorf("%w: %w", ErrScrubFailed, err)
	}
	if !durable {
		// Nothing proves the renames reached the disk: after a power loss the directory
		// could still name the replaced file. It is not overwritten until the next
		// start, when the renames are known to have happened; the leftover keeps the
		// scrub owed until then.
		s.logger().Warnw(context.Background(), "the file system cannot flush a directory; the replaced settings file is overwritten at the next start")
		return nil
	}
	if err := s.cfg.step(stepZeroOld); err != nil {
		return fmt.Errorf("%w: %w", ErrScrubFailed, err)
	}
	if err := zeroAndRemove(oldPath); err != nil {
		return fmt.Errorf("%w: overwrite the replaced file: %w", ErrScrubFailed, err)
	}
	return nil
}

// buildReplacement writes the copy next to the live file, checks it against the
// live database, and makes it durable. The live file is not touched.
func (s *Store) buildReplacement(newPath string) error {
	if err := s.cfg.step(stepBuild); err != nil {
		return err
	}
	if err := compactInto(s.db.inner, newPath); err != nil {
		return errors.Join(err, zeroAndRemove(newPath))
	}
	if err := s.cfg.step(stepVerify); err != nil {
		return errors.Join(err, zeroAndRemove(newPath))
	}
	if err := verifyCopy(s.db.inner, newPath); err != nil {
		return errors.Join(err, zeroAndRemove(newPath))
	}
	if err := syncDir(filepath.Dir(newPath)); err != nil {
		return errors.Join(err, zeroAndRemove(newPath))
	}
	return nil
}

// swapIn closes the database, puts the copy in the live file's place and opens
// it. Whatever fails, it ends with the database open on a good file: the old one
// if the copy is not in place.
func (s *Store) swapIn(newPath, oldPath string) error {
	if err := s.db.inner.Close(); err != nil {
		return s.restoreAndReopen(newPath, oldPath, fmt.Errorf("close database: %w", err))
	}
	if err := s.cfg.step(stepParkOld); err != nil {
		return s.restoreAndReopen(newPath, oldPath, err)
	}
	if err := renameDurably(s.path, oldPath); err != nil {
		return s.restoreAndReopen(newPath, oldPath, fmt.Errorf("set the old file aside: %w", err))
	}
	if err := s.cfg.step(stepInstallNew); err != nil {
		return s.restoreAndReopen(newPath, oldPath, err)
	}
	if err := renameDurably(newPath, s.path); err != nil {
		return s.restoreAndReopen(newPath, oldPath, fmt.Errorf("put the copy in place: %w", err))
	}
	if err := s.cfg.step(stepReopen); err != nil {
		return s.restoreAndReopen(newPath, oldPath, err)
	}
	if err := s.reopen(); err != nil {
		return s.restoreAndReopen(newPath, oldPath, err)
	}
	return nil
}

// restoreAndReopen undoes a swap that did not finish: the old file, if it was set
// aside, goes back to its name (over the copy, if that was put in place), the
// database opens on it, and the copy is discarded. cause is returned with
// whatever the undoing itself reports.
func (s *Store) restoreAndReopen(newPath, oldPath string, cause error) error {
	oldLeft, lookErr := pathExists(oldPath)
	if lookErr != nil {
		// Nothing can be told about the files: keep them all and leave the database closed.
		return errors.Join(cause, lookErr)
	}
	if oldLeft {
		restoreErr := s.cfg.step(stepRestore)
		if restoreErr == nil {
			restoreErr = renameDurably(oldPath, s.path)
		}
		if restoreErr != nil {
			// The old file could not go back. It and the copy stay on disk for the next
			// start to resolve, and the database stays closed: opening it here would
			// create an empty one where the settings were.
			return errors.Join(cause, restoreErr)
		}
	}
	reopenErr := s.reopen()
	return errors.Join(cause, reopenErr, zeroAndRemove(newPath))
}

// openExisting opens a database file that must already exist. A scrub reopens the
// file it put in place, and must never create an empty one where there is none.
func openExisting(name string, flag int, mode os.FileMode) (*os.File, error) {
	return os.OpenFile(name, flag&^os.O_CREATE, mode)
}

// reopen opens the database at the store's path, which must exist.
func (s *Store) reopen() error {
	db, err := bolt.Open(s.path, settingsFileMode, &bolt.Options{Timeout: openTimeout, OpenFile: openExisting})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	s.db.inner = db
	return nil
}

// compactInto writes the live contents of src, and nothing else, to a new
// database file at dstPath, without the marker, and flushes it.
func compactInto(src *bolt.DB, dstPath string) error {
	dst, err := bolt.Open(dstPath, settingsFileMode, &bolt.Options{Timeout: openTimeout, NoSync: true})
	if err != nil {
		return fmt.Errorf("create copy: %w", err)
	}
	copyErr := bolt.Compact(dst, src, compactTxMaxBytes)
	if copyErr == nil {
		copyErr = dst.Update(func(tx *bolt.Tx) error {
			meta := tx.Bucket([]byte(metaBucketName))
			if meta == nil {
				return nil
			}
			return meta.Delete([]byte(scrubPendingKey))
		})
	}
	if copyErr == nil {
		copyErr = dst.Sync()
	}
	return errors.Join(copyErr, dst.Close())
}

// verifyCopy opens the copy from the disk and checks that it holds exactly what
// the live database holds, apart from the marker.
func verifyCopy(src *bolt.DB, dstPath string) error {
	return recovered(func() error {
		dst, err := bolt.Open(dstPath, settingsFileMode, &bolt.Options{Timeout: openTimeout, ReadOnly: true})
		if err != nil {
			return fmt.Errorf("open copy: %w", err)
		}
		defer dst.Close()
		return src.View(func(srcTx *bolt.Tx) error {
			return dst.View(func(dstTx *bolt.Tx) error {
				return compareDatabases(srcTx, dstTx)
			})
		})
	})
}

// recovered runs fn and turns a panic from a malformed file into an error.
func recovered(fn func() error) error {
	var result error
	func() {
		defer func() {
			if r := recover(); r != nil {
				result = fmt.Errorf("copy is unreadable: %v", r)
			}
		}()
		result = fn()
	}()
	return result
}

var errCopyDiffers = errors.New("the copy differs from the database")

// compareDatabases checks the buckets of two databases, but for the meta bucket
// that carries the marker.
func compareDatabases(srcTx, dstTx *bolt.Tx) error {
	srcBuckets := 0
	if err := srcTx.ForEach(func(name []byte, srcBucket *bolt.Bucket) error {
		if string(name) == metaBucketName {
			return nil
		}
		srcBuckets++
		dstBucket := dstTx.Bucket(name)
		if dstBucket == nil {
			return errCopyDiffers
		}
		return compareBuckets(srcBucket, dstBucket)
	}); err != nil {
		return err
	}
	dstBuckets := 0
	if err := dstTx.ForEach(func(name []byte, _ *bolt.Bucket) error {
		if string(name) != metaBucketName {
			dstBuckets++
		}
		return nil
	}); err != nil {
		return err
	}
	if srcBuckets != dstBuckets {
		return errCopyDiffers
	}
	return nil
}

// compareBuckets walks two buckets in step: the same keys, the same values, the
// same nested buckets.
func compareBuckets(a, b *bolt.Bucket) error {
	ca, cb := a.Cursor(), b.Cursor()
	ka, va := ca.First()
	kb, vb := cb.First()
	for ka != nil || kb != nil {
		if !bytes.Equal(ka, kb) || (va == nil) != (vb == nil) {
			return errCopyDiffers
		}
		if va == nil {
			if err := compareBuckets(a.Bucket(ka), b.Bucket(kb)); err != nil {
				return err
			}
		} else if !bytes.Equal(va, vb) {
			return errCopyDiffers
		}
		ka, va = ca.Next()
		kb, vb = cb.Next()
	}
	return nil
}

// recoverScrub resolves what a scrub that did not finish left in the database's
// directory, before the database is opened. It looks at the three names, not at a
// listing of the directory, which may not be readable where the names are, and it
// fails when it cannot tell: the store never creates a new, empty database where
// data may exist.
//
//	live  copy  old
//	 +     +     .   the crash came before the swap: the copy is discarded
//	 -     +     .   or +   between the two renames: the copy is installed
//	 -     -     +   the old file is the only one left: it goes back
//
// The old file that is left beside a live one is overwritten after the database
// has opened (finishOpen), so that it is the last thing to go.
func recoverScrub(path string, cfg config) error {
	live, err := pathExists(path)
	if err != nil {
		return err
	}
	copied, err := pathExists(path + scrubNewSuffix)
	if err != nil {
		return err
	}
	old, err := pathExists(path + scrubOldSuffix)
	if err != nil {
		return err
	}
	switch {
	case live && copied:
		return zeroAndRemove(path + scrubNewSuffix)
	case !live && copied:
		return renameForRecovery(path+scrubNewSuffix, path, cfg)
	case !live && old:
		return renameForRecovery(path+scrubOldSuffix, path, cfg)
	default:
		return nil
	}
}

// renameForRecovery puts the file that holds the data back under the database's name.
func renameForRecovery(from, to string, cfg config) error {
	if err := cfg.step(stepRecover); err != nil {
		return err
	}
	return renameBack(from, to)
}

// renameBack renames a file to a name nothing has, and flushes the directory as
// well as it can. A directory that cannot be opened for a flush (it may be
// searchable and writable but not readable) does not undo the rename or stop the
// start: if the rename is not on the disk after a power loss, the next start does
// it again.
func renameBack(from, to string) error {
	if err := os.Rename(from, to); err != nil {
		return err
	}
	_ = syncDir(filepath.Dir(to))
	return nil
}

// finishOpen does the housekeeping of a store that has just opened: it overwrites
// the file a scrub replaced, applies the retention rule to the corrupt copies, and
// scrubs if the marker was set. None of it can fail the open: the store works, and
// whatever did not finish is tried again at the next start.
func (s *Store) finishOpen(entries []fs.DirEntry, current string, scrubIsOwed bool) {
	// zeroAndRemove finds the file by its name, and does nothing when there is none.
	if err := zeroAndRemove(s.path + scrubOldSuffix); err != nil {
		s.logger().Warnw(context.Background(), "could not overwrite the file a scrub replaced",
			"errorClass", telemetryutil.ErrorClass(err))
	}
	s.pruneCorruptCopies(entries, current)
	if scrubIsOwed {
		// The failure, if any, is logged by class there.
		_ = s.scrubTraced()
	}
}

// fileSize returns the size of the file at path, or 0.
func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}
