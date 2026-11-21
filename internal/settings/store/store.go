package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	bolt "go.etcd.io/bbolt"

	logging "github.com/omniviewdev/plugin-sdk/log"
)

var (
	// ErrUnavailable reports that no settings database is available.
	ErrUnavailable = errors.New("settings persistence is unavailable")

	coreBucket    = []byte("core")
	pluginsBucket = []byte("plugins")
	mcpBucket     = []byte("mcp")

	mcpRelayConfigKey = []byte("relay")
)

// isCorruptionError returns true if err indicates database corruption (invalid
// magic, checksum mismatch, etc.) rather than a transient or permissions error.
func isCorruptionError(err error) bool {
	if err == nil {
		return false
	}
	// Permission errors should not trigger corruption recovery.
	if errors.Is(err, os.ErrPermission) {
		return false
	}
	// bbolt surfaces corruption as string-based errors; match common patterns.
	// NOTE: This substring-based detection is fragile and tightly coupled to
	// bbolt's internal error messages. If bbolt changes its error wording,
	// these checks may silently stop matching. Revisit if bbolt exposes
	// typed error sentinels in a future release.
	msg := err.Error()
	for _, substr := range []string{
		"invalid database",
		"checksum error",
		"unexpected magic",
		"version mismatch",
		"invalid freelist",
	} {
		if strings.Contains(msg, substr) {
			return true
		}
	}
	// Default: only return true for known corruption sentinels above.
	// Unrecognized errors (timeouts, I/O errors, etc.) should not trigger
	// corruption recovery to avoid data loss.
	return false
}

// Store wraps bbolt for settings persistence.
type Store struct {
	db   *guardedDB
	log  logging.Logger
	path string
	cfg  config
}

// Open opens (or creates) a bbolt database at path.
// The top-level buckets ("core", "plugins", "mcp", "plugin-schemas" and "meta")
// are pre-created.
// If the file is corrupt, it is renamed with a .corrupt.<unix-timestamp> suffix
// and a fresh database is created in its place; corrupt.go says how long that
// copy is kept. A scrub that a crash interrupted is resolved before the file is
// opened, and one the database says is owed is done before Open returns.
func Open(path string, opts ...Option) (*Store, error) {
	cfg := newConfig(opts)
	path = resolveDatabasePath(path)
	entries := readDirectory(filepath.Dir(path))
	if err := recoverScrub(path, cfg); err != nil {
		return nil, fmt.Errorf("resolve an interrupted scrub: %w", err)
	}
	db, current, err := openDatabase(path, cfg)
	if err != nil {
		return nil, err
	}
	scrubIsOwed, err := prepareBuckets(db)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize buckets: %w", err)
	}
	s := &Store{db: &guardedDB{mu: sync.RWMutex{}, inner: db}, log: nil, path: path, cfg: cfg}
	s.finishOpen(entries, current, scrubIsOwed)
	return s, nil
}

// maxLinkHops bounds how many symbolic links resolveDatabasePath follows.
const maxLinkHops = 16

// resolveDatabasePath follows the symbolic links at path, one at a time, so that a
// scrub replaces the file the links lead to and leaves them where they are. The
// file at the end need not exist yet. Anything that is not a link is returned as it
// is.
func resolveDatabasePath(path string) string {
	for range maxLinkHops {
		info, err := os.Lstat(path)
		if err != nil || info.Mode()&os.ModeSymlink == 0 {
			return path
		}
		target, err := os.Readlink(path)
		if err != nil {
			return path
		}
		if !filepath.IsAbs(target) {
			target = filepath.Join(filepath.Dir(path), target)
		}
		path = target
	}
	return path
}

// openDatabase opens the file at path. A corrupt file is set aside first, and the
// name of the copy it becomes is returned; it is "" when nothing was set aside.
func openDatabase(path string, cfg config) (*bolt.DB, string, error) {
	db, err := bolt.Open(path, settingsFileMode, &bolt.Options{Timeout: openTimeout})
	if err == nil {
		return db, "", nil
	}
	if !isCorruptionError(err) {
		return nil, "", fmt.Errorf("failed to open database: %w", err)
	}
	// Attempt corruption recovery: rename the corrupt file and retry.
	backupPath := corruptCopyPath(path, cfg.clock())
	if renameErr := os.Rename(path, backupPath); renameErr != nil {
		return nil, "", fmt.Errorf("failed to open database and could not rename corrupt file: %w (rename error: %w)", err, renameErr)
	}
	// A scrub that was cut short may have left the intact old file beside the copy
	// that proved unreadable: that file, not an empty database, is what to open.
	if oldLeft, lookErr := pathExists(path + scrubOldSuffix); lookErr == nil && oldLeft {
		if restoreErr := renameBack(path+scrubOldSuffix, path); restoreErr != nil {
			return nil, "", fmt.Errorf("failed to restore the file a scrub replaced: %w", restoreErr)
		}
	}
	db, err = bolt.Open(path, settingsFileMode, &bolt.Options{Timeout: openTimeout})
	if err != nil {
		return nil, "", fmt.Errorf("failed to create fresh database after corruption recovery: %w", err)
	}
	return db, filepath.Base(backupPath), nil
}

// prepareBuckets pre-creates the top-level buckets and reports whether the
// marker says a scrub is owed.
func prepareBuckets(db *bolt.DB) (bool, error) {
	scrubIsOwed := false
	err := db.Update(func(tx *bolt.Tx) error {
		for _, name := range [][]byte{coreBucket, pluginsBucket, mcpBucket, []byte(pluginSchemasBucketName), []byte(metaBucketName)} {
			if _, bucketErr := tx.CreateBucketIfNotExists(name); bucketErr != nil {
				return fmt.Errorf("create %s bucket: %w", name, bucketErr)
			}
		}
		scrubIsOwed = scrubIsPending(tx)
		return nil
	})
	return scrubIsOwed, err
}

// Close closes the underlying bbolt database.
// It is safe to call on a nil Store or a Store with a nil db.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// SaveCategory persists a category's settings under the "core" bucket.
// Values are JSON-encoded and stored under the given categoryID key.
func (s *Store) SaveCategory(categoryID string, values map[string]any) error {
	return s.SaveCategories(map[string]map[string]any{categoryID: values})
}

// SaveCategories persists all supplied core categories in one transaction.
// Encoding and transaction failures leave every category unchanged.
func (s *Store) SaveCategories(categories map[string]map[string]any) error {
	ids := make([]string, 0, len(categories))
	for id := range categories {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return s.persistSave(categoryLabel(ids), "", func() error { return s.saveCategories(categories) })
}

func (s *Store) saveCategories(categories map[string]map[string]any) error {
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	encoded := make(map[string][]byte, len(categories))
	for id, values := range categories {
		data, err := json.Marshal(values)
		if err != nil {
			return fmt.Errorf("marshal category %q: %w", id, err)
		}
		encoded[id] = data
	}
	scrubNeeded := false
	err := s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(coreBucket)
		for id, data := range encoded {
			if credentialsDied(b.Get([]byte(id)), data, s.cfg.coreCredentials(id)) {
				scrubNeeded = true
			}
			if err := b.Put([]byte(id), data); err != nil {
				return fmt.Errorf("save category %q: %w", id, err)
			}
		}
		if scrubNeeded {
			return markScrubPending(tx)
		}
		return nil
	})
	if err == nil && scrubNeeded {
		s.scrubAfterWrite()
	}
	return err
}

// PatchSettings merges scoped host setting IDs into persisted categories atomically.
// Only the first dot separates the category from the local setting ID.
func (s *Store) PatchSettings(values map[string]any) error {
	ids := make([]string, 0, len(values))
	for id := range values {
		if category, _, ok := strings.Cut(id, "."); ok && category != "" {
			ids = append(ids, category)
		}
	}
	slices.Sort(ids)
	return s.persistSave(categoryLabel(slices.Compact(ids)), "", func() error { return s.patchSettings(values) })
}

func (s *Store) patchSettings(values map[string]any) error {
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	categories := make(map[string]map[string]any)
	for id, value := range values {
		category, setting, ok := strings.Cut(id, ".")
		if !ok || category == "" || setting == "" {
			return fmt.Errorf("invalid host setting ID %q", id)
		}
		if categories[category] == nil {
			categories[category] = make(map[string]any)
		}
		categories[category][setting] = value
	}
	scrubNeeded := false
	err := s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(coreBucket)
		for category, patch := range categories {
			died, err := patchValues(b, category, patch, s.cfg.coreCredentials(category))
			if err != nil {
				return fmt.Errorf("patch category %q: %w", category, err)
			}
			scrubNeeded = scrubNeeded || died
		}
		if scrubNeeded {
			return markScrubPending(tx)
		}
		return nil
	})
	if err == nil && scrubNeeded {
		s.scrubAfterWrite()
	}
	return err
}

// PatchPluginSettings merges raw setting IDs into one plugin's persisted values.
func (s *Store) PatchPluginSettings(pluginID string, values map[string]any) error {
	return s.persistSave("", pluginID, func() error { return s.patchPluginSettings(pluginID, values) })
}

func (s *Store) patchPluginSettings(pluginID string, values map[string]any) error {
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	scrubNeeded := false
	err := s.db.Update(func(tx *bolt.Tx) error {
		ordinary, _ := rememberedOrdinary(tx, pluginID)
		died, err := patchValues(tx.Bucket(pluginsBucket), pluginID, values, ordinaryCredentials(ordinary))
		if err != nil {
			return fmt.Errorf("patch plugin settings %q: %w", pluginID, err)
		}
		scrubNeeded = died
		if died {
			return markScrubPending(tx)
		}
		return nil
	})
	if err == nil && scrubNeeded {
		s.scrubAfterWrite()
	}
	return err
}

// patchValues merges patch into the stored document of id and reports whether
// that destroyed a credential, as the classifier names it (see credentialsDied).
func patchValues(bucket *bolt.Bucket, id string, patch map[string]any, isCredential credentialClassifier) (bool, error) {
	values := make(map[string]any)
	old := bucket.Get([]byte(id))
	if old != nil {
		if err := json.Unmarshal(old, &values); err != nil {
			return false, fmt.Errorf("decode saved settings: %w", err)
		}
	}
	if values == nil {
		values = make(map[string]any, len(patch))
	}
	for key, value := range patch {
		values[key] = value
	}
	data, err := json.Marshal(values)
	if err != nil {
		return false, fmt.Errorf("encode settings: %w", err)
	}
	died := credentialsDied(old, data, isCredential)
	return died, bucket.Put([]byte(id), data)
}

// LoadCategory retrieves a category's settings from the "core" bucket.
// Returns an empty (non-nil) map if the category does not exist.
func (s *Store) LoadCategory(categoryID string) (map[string]any, error) {
	if s == nil || s.db == nil {
		return nil, ErrUnavailable
	}
	result := make(map[string]any)
	err := s.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(coreBucket)
		data := b.Get([]byte(categoryID))
		if data == nil {
			return nil
		}
		return json.Unmarshal(data, &result)
	})
	if err != nil {
		return nil, fmt.Errorf("load category %q: %w", categoryID, err)
	}
	return result, nil
}

// SaveMCPRelayConfig persists the MCP relay configuration document under the
// "mcp" bucket.
func (s *Store) SaveMCPRelayConfig(cfg any) error {
	return s.persistSave("mcp", "", func() error { return s.saveMCPRelayConfig(cfg) })
}

func (s *Store) saveMCPRelayConfig(cfg any) error {
	data, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal mcp relay config: %w", err)
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket(mcpBucket).Put(mcpRelayConfigKey, data)
	})
}

// LoadMCPRelayConfig decodes the MCP relay configuration into out. found is
// false when no document was saved yet.
func (s *Store) LoadMCPRelayConfig(out any) (bool, error) {
	found := false
	err := s.db.View(func(tx *bolt.Tx) error {
		data := tx.Bucket(mcpBucket).Get(mcpRelayConfigKey)
		if data == nil {
			return nil
		}
		found = true
		return json.Unmarshal(data, out)
	})
	if err != nil {
		return false, fmt.Errorf("load mcp relay config: %w", err)
	}
	return found, nil
}

// SavePluginSettings persists a plugin's settings under the "plugins" bucket.
func (s *Store) SavePluginSettings(pluginID string, values map[string]any) error {
	return s.persistSave("", pluginID, func() error { return s.savePluginSettings(pluginID, values) })
}

func (s *Store) savePluginSettings(pluginID string, values map[string]any) error {
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	data, err := json.Marshal(values)
	if err != nil {
		return fmt.Errorf("marshal plugin settings %q: %w", pluginID, err)
	}
	scrubNeeded := false
	err = s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(pluginsBucket)
		key := []byte(pluginID)
		ordinary, _ := rememberedOrdinary(tx, pluginID)
		if credentialsDied(b.Get(key), data, ordinaryCredentials(ordinary)) {
			scrubNeeded = true
			if markErr := markScrubPending(tx); markErr != nil {
				return markErr
			}
		}
		return b.Put(key, data)
	})
	if err == nil && scrubNeeded {
		s.scrubAfterWrite()
	}
	return err
}

// LoadPluginSettings retrieves a plugin's settings from the "plugins" bucket.
// Returns an empty (non-nil) map if the plugin does not exist.
func (s *Store) LoadPluginSettings(pluginID string) (map[string]any, error) {
	if s == nil || s.db == nil {
		return nil, ErrUnavailable
	}
	result := make(map[string]any)
	err := s.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(pluginsBucket)
		data := b.Get([]byte(pluginID))
		if data == nil {
			return nil
		}
		return json.Unmarshal(data, &result)
	})
	if err != nil {
		return nil, fmt.Errorf("load plugin settings %q: %w", pluginID, err)
	}
	return result, nil
}

// DeletePluginSettings removes a plugin's settings from the "plugins" bucket and
// scrubs the database file of any credential they held (see scrub.go). It is a
// no-op if the plugin does not exist. An error that wraps ErrScrubFailed means the
// settings are gone but their old bytes may remain in the file.
func (s *Store) DeletePluginSettings(pluginID string) error {
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	err := s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(pluginsBucket)
		key := []byte(pluginID)
		ordinary, _ := rememberedOrdinary(tx, pluginID)
		if credentialsDied(b.Get(key), nil, ordinaryCredentials(ordinary)) {
			if markErr := markScrubPending(tx); markErr != nil {
				return markErr
			}
		}
		return b.Delete(key)
	})
	if err != nil {
		return err
	}
	return s.scrubTraced()
}

// LoadAllPluginSettings returns all plugin settings keyed by plugin ID.
// Returns an empty (non-nil) map if no plugins have saved settings.
func (s *Store) LoadAllPluginSettings() (map[string]map[string]any, error) {
	if s == nil || s.db == nil {
		return nil, ErrUnavailable
	}
	result := make(map[string]map[string]any)
	err := s.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(pluginsBucket)
		return b.ForEach(func(k, v []byte) error {
			var vals map[string]any
			if err := json.Unmarshal(v, &vals); err != nil {
				return fmt.Errorf("unmarshal plugin %q: %w", string(k), err)
			}
			result[string(k)] = vals
			return nil
		})
	})
	if err != nil {
		return nil, fmt.Errorf("load all plugin settings: %w", err)
	}
	return result, nil
}
