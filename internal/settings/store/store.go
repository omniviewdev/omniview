package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	bolt "go.etcd.io/bbolt"
)

var (
	coreBucket    = []byte("core")
	pluginsBucket = []byte("plugins")
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

// config holds optional configuration for the Store.
// Reserved for future use (e.g., encryption support).
type config struct{}

// Option configures the Store. Reserved for future encryption support.
type Option func(*config)

// Store wraps bbolt for settings persistence.
type Store struct {
	db *bolt.DB
}

// Open opens (or creates) a bbolt database at path.
// Both top-level buckets ("core" and "plugins") are pre-created.
// If the file is corrupt, it is renamed with a .corrupt.<unix-timestamp> suffix
// and a fresh database is created in its place.
func Open(path string, opts ...Option) (*Store, error) {
	// Apply options (currently unused, reserved for future use).
	_ = opts

	db, err := bolt.Open(path, 0o600, &bolt.Options{Timeout: 1 * time.Second})
	if err != nil {
		if !isCorruptionError(err) {
			return nil, fmt.Errorf("failed to open database: %w", err)
		}
		// Attempt corruption recovery: rename the corrupt file and retry.
		backupPath := fmt.Sprintf("%s.corrupt.%d", path, time.Now().Unix())
		if renameErr := os.Rename(path, backupPath); renameErr != nil {
			return nil, fmt.Errorf("failed to open database and could not rename corrupt file: %w (rename error: %v)", err, renameErr)
		}
		db, err = bolt.Open(path, 0o600, &bolt.Options{Timeout: 1 * time.Second})
		if err != nil {
			return nil, fmt.Errorf("failed to create fresh database after corruption recovery: %w", err)
		}
	}

	// Pre-create buckets.
	if err := db.Update(func(tx *bolt.Tx) error {
		if _, err := tx.CreateBucketIfNotExists(coreBucket); err != nil {
			return fmt.Errorf("create core bucket: %w", err)
		}
		if _, err := tx.CreateBucketIfNotExists(pluginsBucket); err != nil {
			return fmt.Errorf("create plugins bucket: %w", err)
		}
		return nil
	}); err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize buckets: %w", err)
	}

	return &Store{db: db}, nil
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
	data, err := json.Marshal(values)
	if err != nil {
		return fmt.Errorf("marshal category %q: %w", categoryID, err)
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(coreBucket)
		return b.Put([]byte(categoryID), data)
	})
}

// LoadCategory retrieves a category's settings from the "core" bucket.
// Returns an empty (non-nil) map if the category does not exist.
func (s *Store) LoadCategory(categoryID string) (map[string]any, error) {
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

// SavePluginSettings persists a plugin's settings under the "plugins" bucket.
func (s *Store) SavePluginSettings(pluginID string, values map[string]any) error {
	data, err := json.Marshal(values)
	if err != nil {
		return fmt.Errorf("marshal plugin settings %q: %w", pluginID, err)
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(pluginsBucket)
		return b.Put([]byte(pluginID), data)
	})
}

// LoadPluginSettings retrieves a plugin's settings from the "plugins" bucket.
// Returns an empty (non-nil) map if the plugin does not exist.
func (s *Store) LoadPluginSettings(pluginID string) (map[string]any, error) {
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

// DeletePluginSettings removes a plugin's settings from the "plugins" bucket.
// It is a no-op if the plugin does not exist.
func (s *Store) DeletePluginSettings(pluginID string) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(pluginsBucket)
		return b.Delete([]byte(pluginID))
	})
}

// LoadAllPluginSettings returns all plugin settings keyed by plugin ID.
// Returns an empty (non-nil) map if no plugins have saved settings.
func (s *Store) LoadAllPluginSettings() (map[string]map[string]any, error) {
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
