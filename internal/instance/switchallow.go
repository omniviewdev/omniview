package instance

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	bolt "go.etcd.io/bbolt"

	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/settings/store"
)

// What a channel switch carries to the new profile is an allow-list. A file the
// list does not name is not copied, so a file a later version of the host starts
// to write (a backup, a copy kept after corruption, a leftover of a scrub, a
// quarantined state file, a log) is not carried until someone decides it should
// be. The table of what is carried and what is not is in docs/ui-next/status/SEC3.md.
const (
	seedSettingsDatabase = "settings.db"
	seedPluginsDirectory = "plugins"
	// scrubMetaBucket and scrubPendingKey are the settings store's own marker that
	// says a database may hold the bytes of a deleted value (internal/settings/store,
	// scrub.go). Setting it before the store opens a staged copy makes the store
	// rebuild the file from its live contents. A test fails if the names drift: the
	// staged database would keep the pages it had.
	scrubMetaBucket = "meta"
	scrubPendingKey = "scrub-pending"

	zeroChunkBytes = 64 << 10
	// openFileTimeout is how long to wait for a database file, as the settings store does.
	openFileTimeout = time.Second

	privateFileMode      = 0o600
	privateDirectoryMode = 0o700
	// keptModeBits are the mode bits a copy keeps from what it copies.
	keptModeBits = os.ModePerm | os.ModeSetuid | os.ModeSetgid | os.ModeSticky
)

// seedFiles are the single files of the state root a new profile is given as they
// are. Each is read by the host at start, and each holds what the user made.
func seedFiles() []string {
	return []string{
		// The plugin inventory: which plugins are installed, at which version, enabled or not.
		"plugin_state.json",
		// The activity history.
		"activities.json",
	}
}

// seedNestedFiles are single files below a directory of the state root. Nothing
// else of that directory is carried.
func seedNestedFiles() []string {
	return []string{
		// The built-in Grafana provider's connections, secrets included.
		"builtin/grafana/connections.json",
		// The metric definitions, bindings and source defaults the user made. A metric
		// provider keeps its own connections and their secrets elsewhere.
		"metrics/configuration.json",
	}
}

// seedPluginEntries are the parts of one plugin's directory a new profile is given:
// what the install laid down (plugin.yaml, bin, assets) and what the plugin and the
// host keep for it (data, store: the plugin's files, its connection profiles and
// their credential files). Anything else in the directory is not carried.
func seedPluginEntries() []string {
	return []string{"plugin.yaml", "bin", "assets", "data", "store"}
}

// firstComponent returns the first element of a slash-separated path.
func firstComponent(rel string) string {
	head, _, _ := strings.Cut(rel, "/")
	return head
}

// keptMode returns the mode bits of info that a copy keeps.
func keptMode(info os.FileInfo) os.FileMode {
	return info.Mode() & keptModeBits
}

// isSeedTopLevel reports whether name is an entry of the state root that
// stageSwitchProfile can make.
func isSeedTopLevel(name string) bool {
	if name == seedSettingsDatabase || name == seedPluginsDirectory {
		return true
	}
	if slices.Contains(seedFiles(), name) {
		return true
	}
	for _, rel := range seedNestedFiles() {
		if firstComponent(rel) == name {
			return true
		}
	}
	return false
}

// stageSwitchProfile copies what a new profile needs from source into staging and
// returns the names of the entries it made at the top of staging. It writes
// nothing to source.
func stageSwitchProfile(source, staging string) ([]string, error) {
	names := []string{}
	add := func(name string, staged bool) {
		if staged && !slices.Contains(names, name) {
			names = append(names, name)
		}
	}

	staged, err := stageSettingsDatabase(source, staging)
	if err != nil {
		return nil, fmt.Errorf("stage settings database: %w", err)
	}
	add(seedSettingsDatabase, staged)

	for _, name := range seedFiles() {
		staged, err = stageEntry(filepath.Join(source, name), filepath.Join(staging, name), nil)
		if err != nil {
			return nil, fmt.Errorf("copy switch entry %q: %w", name, err)
		}
		add(name, staged)
	}
	for _, rel := range seedNestedFiles() {
		staged, err = stageNestedFile(source, staging, rel)
		if err != nil {
			return nil, fmt.Errorf("copy switch entry %q: %w", rel, err)
		}
		add(firstComponent(rel), staged)
	}
	staged, err = stagePlugins(filepath.Join(source, seedPluginsDirectory), filepath.Join(staging, seedPluginsDirectory))
	if err != nil {
		return nil, fmt.Errorf("copy switch entry %q: %w", seedPluginsDirectory, err)
	}
	add(seedPluginsDirectory, staged)
	return names, nil
}

// switchResidue reports whether a file inside a plugin's directory is one that is
// not carried: the temporary file of a write that did not finish, or a state file
// the host set aside because it could not read it (it keeps the text of the file).
func switchResidue(name string) bool {
	return strings.HasSuffix(name, ".tmp") || appstate.IsQuarantineName(name)
}

// stageEntry copies src to dst, a file, a directory or a link, leaving out what
// skip names at any depth, and reports whether dst exists afterwards. A src that
// is absent, or of a kind that is not copied, stages nothing.
func stageEntry(src, dst string, skip func(name string) bool) (bool, error) {
	_, err := os.Lstat(src)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err = copySwitchEntry(src, dst, skip); err != nil {
		return false, err
	}
	_, err = os.Lstat(dst)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("stat switch entry: %w", err)
	}
	return true, nil
}

// stageNestedFile copies the one file at rel, a slash-separated path below source,
// into staging, creating the directories above it with the modes they have in source.
// Nothing is made when the file is missing or a directory above it is not one.
func stageNestedFile(source, staging, rel string) (bool, error) {
	parts := strings.Split(rel, "/")
	dirParts, name := parts[:len(parts)-1], parts[len(parts)-1]
	modes := make([]os.FileMode, 0, len(dirParts))
	srcDir := source
	for _, part := range dirParts {
		srcDir = filepath.Join(srcDir, part)
		info, err := os.Lstat(srcDir)
		if errors.Is(err, fs.ErrNotExist) || (err == nil && !info.IsDir()) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		modes = append(modes, keptMode(info))
	}
	if _, err := os.Lstat(filepath.Join(srcDir, name)); errors.Is(err, fs.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	dstDir := staging
	dstDirs := make([]string, 0, len(dirParts))
	for _, part := range dirParts {
		dstDir = filepath.Join(dstDir, part)
		if err := os.Mkdir(dstDir, privateDirectoryMode); err != nil {
			return false, err
		}
		dstDirs = append(dstDirs, dstDir)
	}
	staged, err := stageEntry(filepath.Join(srcDir, name), filepath.Join(dstDir, name), nil)
	for i := len(dstDirs) - 1; i >= 0; i-- {
		if chmodErr := os.Chmod(dstDirs[i], modes[i]); chmodErr != nil && err == nil {
			err = chmodErr
		}
	}
	return staged, err
}

// stagePlugins copies the allowed part of every plugin directory under srcDir into
// dstDir and reports whether it made dstDir. A name that is not a plugin's (a
// transaction's stage directory, a set-aside copy) is not carried.
func stagePlugins(srcDir, dstDir string) (bool, error) {
	info, err := os.Lstat(srcDir)
	if errors.Is(err, fs.ErrNotExist) || (err == nil && !info.IsDir()) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return false, err
	}
	if err = os.Mkdir(dstDir, privateDirectoryMode); err != nil {
		return false, err
	}
	for _, entry := range entries {
		id := entry.Name()
		if id == "" || strings.HasPrefix(id, ".") || switchResidue(id) {
			continue
		}
		if err = stagePlugin(filepath.Join(srcDir, id), filepath.Join(dstDir, id)); err != nil {
			return false, fmt.Errorf("plugin %q: %w", id, err)
		}
	}
	return true, os.Chmod(dstDir, keptMode(info))
}

func stagePlugin(src, dst string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		// A plugin installed by link keeps pointing where it pointed.
		return copySwitchEntry(src, dst, nil)
	case !info.IsDir():
		return nil
	}
	if err = os.Mkdir(dst, privateDirectoryMode); err != nil {
		return err
	}
	for _, name := range seedPluginEntries() {
		if _, err = stageEntry(filepath.Join(src, name), filepath.Join(dst, name), switchResidue); err != nil {
			return fmt.Errorf("%q: %w", name, err)
		}
	}
	return os.Chmod(dst, keptMode(info))
}

// stageSettingsDatabase puts a copy of the source's settings database into staging
// that holds what is live in it and nothing else, and reports whether it did.
//
// bbolt does not wipe the pages it frees, so the file of a profile that ever
// erased a value can still hold it: a plain copy would hand it to the new profile.
// The copy is therefore rebuilt by the settings store's own scrub (compaction into
// a new file, checked against the old one, the old one overwritten with zeros),
// which the store runs when its marker is set. Only the copy is opened: the source
// is read, never written. A database that cannot be read is not carried: the new
// profile starts with default settings, which is what the store's recovery of a
// damaged file would have given it.
func stageSettingsDatabase(source, staging string) (bool, error) {
	in, err := os.Open(filepath.Join(source, seedSettingsDatabase))
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() {
		return false, nil
	}
	staged, err := rebuildDatabase(in, staging)
	if err == nil && staged {
		return true, nil
	}
	// Whatever stops here, the plain copy (pages and all) must not stay behind.
	return false, errors.Join(err, removeStagedDatabase(staging))
}

// rebuildDatabase copies the database from in into staging and has the settings
// store rebuild the copy.
func rebuildDatabase(in io.Reader, staging string) (bool, error) {
	dst := filepath.Join(staging, seedSettingsDatabase)
	if err := copyDatabaseFile(in, dst); err != nil {
		return false, err
	}
	if !databaseIsReadable(dst) {
		return false, nil
	}
	if err := markScrubOwed(dst); err != nil {
		return false, err
	}
	return scrubStagedDatabase(staging, dst)
}

func copyDatabaseFile(in io.Reader, dst string) error {
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, privateFileMode)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if err == nil {
		err = out.Sync()
	}
	return errors.Join(err, out.Close())
}

// databaseIsReadable reports whether path opens as a bbolt database. A damaged
// file can make bbolt panic, and that is an unreadable file, not a crash.
func databaseIsReadable(path string) bool {
	readable := false
	_ = recovered(func() error {
		db, err := bolt.Open(path, privateFileMode, &bolt.Options{ReadOnly: true, Timeout: openFileTimeout})
		if err != nil {
			return err
		}
		readable = true
		return db.Close()
	})
	return readable
}

// markScrubOwed sets the settings store's marker in the database at path.
func markScrubOwed(path string) error {
	return recovered(func() error {
		db, err := bolt.Open(path, privateFileMode, &bolt.Options{Timeout: openFileTimeout})
		if err != nil {
			return err
		}
		updateErr := db.Update(func(tx *bolt.Tx) error {
			meta, bucketErr := tx.CreateBucketIfNotExists([]byte(scrubMetaBucket))
			if bucketErr != nil {
				return bucketErr
			}
			return meta.Put([]byte(scrubPendingKey), []byte{1})
		})
		return errors.Join(updateErr, db.Close())
	})
}

// scrubStagedDatabase has the settings store open the staged copy, which scrubs it
// because of the marker, then checks that it did and that it left nothing beside
// the database. The store logs a scrub that fails and still opens, so the marker,
// which only the rebuilt file lacks, is what proves the rebuild.
func scrubStagedDatabase(staging, dst string) (bool, error) {
	var opened *store.Store
	err := recovered(func() error {
		var openErr error
		opened, openErr = store.Open(dst)
		return openErr
	})
	if err != nil {
		return false, fmt.Errorf("open staged settings: %w", err)
	}
	if err = opened.Close(); err != nil {
		return false, fmt.Errorf("close staged settings: %w", err)
	}
	entries, err := os.ReadDir(staging)
	if err != nil {
		return false, err
	}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, seedSettingsDatabase+".") {
			continue
		}
		// What a scrub that cannot flush a directory leaves until the next start, or
		// the copy of a file the store found damaged after all (its recovery then
		// made an empty database, which carries nothing of the source's).
		if err = overwriteAndRemove(filepath.Join(staging, name)); err != nil {
			return false, err
		}
	}
	stillMarked, err := databaseIsMarked(dst)
	if err != nil {
		return false, err
	}
	if stillMarked {
		return false, errors.New("the staged settings database was not rebuilt")
	}
	return true, nil
}

func databaseIsMarked(path string) (bool, error) {
	marked := false
	err := recovered(func() error {
		db, err := bolt.Open(path, privateFileMode, &bolt.Options{ReadOnly: true, Timeout: openFileTimeout})
		if err != nil {
			return err
		}
		viewErr := db.View(func(tx *bolt.Tx) error {
			meta := tx.Bucket([]byte(scrubMetaBucket))
			marked = meta != nil && meta.Get([]byte(scrubPendingKey)) != nil
			return nil
		})
		return errors.Join(viewErr, db.Close())
	})
	return marked, err
}

// recovered runs fn and turns a panic from a malformed database file into an error.
func recovered(fn func() error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("settings database is unreadable: %v", r)
		}
	}()
	return fn()
}

// removeStagedDatabase overwrites and removes the staged database and everything
// the store made beside it.
func removeStagedDatabase(staging string) error {
	entries, err := os.ReadDir(staging)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var errs []error
	for _, entry := range entries {
		if name := entry.Name(); name == seedSettingsDatabase || strings.HasPrefix(name, seedSettingsDatabase+".") {
			errs = append(errs, overwriteAndRemove(filepath.Join(staging, name)))
		}
	}
	return errors.Join(errs...)
}

// overwriteAndRemove overwrites a regular file with zeros, flushes it, and removes
// it. A file that is already gone is not an error.
func overwriteAndRemove(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode().IsRegular() {
		if err = overwriteWithZeros(path, info.Size()); err != nil {
			return err
		}
	}
	return os.Remove(path)
}

func overwriteWithZeros(path string, size int64) error {
	file, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	zeros := make([]byte, zeroChunkBytes)
	var writeErr error
	for left := size; left > 0 && writeErr == nil; {
		chunk := min(left, int64(len(zeros)))
		_, writeErr = file.Write(zeros[:chunk])
		left -= chunk
	}
	if writeErr == nil {
		writeErr = file.Sync()
	}
	return errors.Join(writeErr, file.Close())
}
