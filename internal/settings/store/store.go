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
	if updateErr := db.Update(func(tx *bolt.Tx) error {
		if _, bucketErr := tx.CreateBucketIfNotExists(coreBucket); bucketErr != nil {
			return fmt.Errorf("create core bucket: %w", bucketErr)
		}
		if _, bucketErr := tx.CreateBucketIfNotExists(pluginsBucket); bucketErr != nil {
			return fmt.Errorf("create plugins bucket: %w", bucketErr)
		}
		if _, bucketErr := tx.CreateBucketIfNotExists(mcpBucket); bucketErr != nil {
			return fmt.Errorf("create mcp bucket: %w", bucketErr)
		}
		return nil
	}); updateErr != nil {
		db.Close()
		return nil, fmt.Errorf("initialize buckets: %w", updateErr)
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
	return s.SaveCategories(map[string]map[string]any{categoryID: values})
}

// SaveCategories persists all supplied core categories in one transaction.
// Encoding and transaction failures leave every category unchanged.
func (s *Store) SaveCategories(categories map[string]map[string]any) error {
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
	return s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(coreBucket)
		for id, data := range encoded {
			if err := b.Put([]byte(id), data); err != nil {
				return fmt.Errorf("save category %q: %w", id, err)
			}
		}
		return nil
	})
}

// PatchSettings merges scoped host setting IDs into persisted categories atomically.
// Only the first dot separates the category from the local setting ID.
func (s *Store) PatchSettings(values map[string]any) error {
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
	return s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(coreBucket)
		for category, patch := range categories {
			if err := patchValues(b, category, patch); err != nil {
				return fmt.Errorf("patch category %q: %w", category, err)
			}
		}
		return nil
	})
}

// PatchPluginSettings merges raw setting IDs into one plugin's persisted values.
func (s *Store) PatchPluginSettings(pluginID string, values map[string]any) error {
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		if err := patchValues(tx.Bucket(pluginsBucket), pluginID, values); err != nil {
			return fmt.Errorf("patch plugin settings %q: %w", pluginID, err)
		}
		return nil
	})
}

func patchValues(bucket *bolt.Bucket, id string, patch map[string]any) error {
	values := make(map[string]any)
	if data := bucket.Get([]byte(id)); data != nil {
		if err := json.Unmarshal(data, &values); err != nil {
			return fmt.Errorf("decode saved settings: %w", err)
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
		return fmt.Errorf("encode settings: %w", err)
	}
	return bucket.Put([]byte(id), data)
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
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
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

// DeletePluginSettings removes a plugin's settings from the "plugins" bucket.
// It is a no-op if the plugin does not exist.
func (s *Store) DeletePluginSettings(pluginID string) error {
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(pluginsBucket)
		return b.Delete([]byte(pluginID))
	})
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
