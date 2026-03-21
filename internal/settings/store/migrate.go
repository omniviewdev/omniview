package store

import (
	"bytes"
	"encoding/gob"
	"fmt"
	"log"
	"maps"
	"os"
	"path/filepath"

	"github.com/omniviewdev/plugin-sdk/settings"
)

func init() {
	// Register types that may appear inside GOB-encoded settings files.
	gob.Register(settings.Store{})
	gob.Register(settings.Category{})
	gob.Register(settings.Setting{})
	gob.Register(settings.SettingOption{})
	gob.Register([]any{})
	gob.Register(map[string]any{})
}

// MigrateFromGOB checks for old GOB settings files and migrates them to bbolt.
// stateRoot is the absolute path to the state directory (e.g., ~/.omniview).
// Old files are renamed to .gob.bak after successful migration.
// Corrupt or unreadable files are skipped and reported in a single aggregated log.
func MigrateFromGOB(stateRoot string, s *Store) error {
	var skipped []string

	// Migrate core settings.
	corePath := filepath.Join(stateRoot, "settings")
	if err := migrateCore(corePath, s, &skipped); err != nil {
		log.Printf("[settings/migrate] warning: core migration failed: %v", err)
	}

	// Migrate plugin settings.
	pluginsDir := filepath.Join(stateRoot, "plugins")
	entries, err := os.ReadDir(pluginsDir)
	if err != nil {
		if os.IsNotExist(err) {
			if len(skipped) > 0 {
				log.Printf("[settings/migrate] skipped corrupt files: %v", skipped)
			}
			return nil
		}
		log.Printf("[settings/migrate] warning: cannot read plugins dir: %v", err)
		if len(skipped) > 0 {
			log.Printf("[settings/migrate] skipped corrupt files: %v", skipped)
		}
		return nil
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pluginID := entry.Name()
		pluginSettingsPath := filepath.Join(pluginsDir, pluginID, "settings")
		if err := migratePlugin(pluginSettingsPath, pluginID, s, &skipped); err != nil {
			log.Printf("[settings/migrate] warning: plugin %q migration failed: %v", pluginID, err)
		}
	}

	if len(skipped) > 0 {
		log.Printf("[settings/migrate] skipped %d corrupt file(s): %v", len(skipped), skipped)
	}

	return nil
}

// migrateCore reads the core GOB settings file, extracts values, and saves them.
func migrateCore(path string, s *Store, skipped *[]string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read core settings: %w", err)
	}

	store, err := decodeGOB(data)
	if err != nil {
		*skipped = append(*skipped, path)
		return nil
	}

	for catID, cat := range store {
		values := extractValues(cat)
		if len(values) == 0 {
			continue
		}
		if err := s.SaveCategory(catID, values); err != nil {
			return fmt.Errorf("save category %q: %w", catID, err)
		}
	}

	return renameToBackup(path)
}

// migratePlugin reads a plugin GOB settings file, extracts values from the
// "plugin" category key, and saves them.
func migratePlugin(path, pluginID string, s *Store, skipped *[]string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read plugin settings %q: %w", pluginID, err)
	}

	store, err := decodeGOB(data)
	if err != nil {
		*skipped = append(*skipped, path)
		return nil
	}

	cat, ok := store["plugin"]
	if !ok {
		// No "plugin" category key — try migrating all categories into a flat map.
		values := make(map[string]any)
		for _, c := range store {
			maps.Copy(values, extractValues(c))
		}
		if len(values) > 0 {
			if err := s.SavePluginSettings(pluginID, values); err != nil {
				return fmt.Errorf("save plugin settings %q: %w", pluginID, err)
			}
		}
	} else {
		values := extractValues(cat)
		if len(values) > 0 {
			if err := s.SavePluginSettings(pluginID, values); err != nil {
				return fmt.Errorf("save plugin settings %q: %w", pluginID, err)
			}
		}
	}

	return renameToBackup(path)
}

// decodeGOB decodes a GOB-encoded settings.Store from raw bytes.
func decodeGOB(data []byte) (settings.Store, error) {
	var store settings.Store
	dec := gob.NewDecoder(bytes.NewReader(data))
	if err := dec.Decode(&store); err != nil {
		return nil, fmt.Errorf("gob decode: %w", err)
	}
	return store, nil
}

// extractValues pulls setting ID → Value pairs from a Category.
func extractValues(cat settings.Category) map[string]any {
	if cat.Settings == nil {
		return nil
	}
	values := make(map[string]any, len(cat.Settings))
	for id, setting := range cat.Settings {
		values[id] = setting.Value
	}
	return values
}

// renameToBackup renames a file to .gob.bak, avoiding overwrites.
func renameToBackup(path string) error {
	backup := path + ".gob.bak"
	if _, err := os.Stat(backup); err == nil {
		// .gob.bak already exists, try numbered suffix.
		found := false
		for i := 1; i <= 100; i++ {
			candidate := fmt.Sprintf("%s.gob.bak.%d", path, i)
			if _, err := os.Stat(candidate); os.IsNotExist(err) {
				backup = candidate
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("too many backup files for %q (100 limit reached)", path)
		}
	}
	return os.Rename(path, backup)
}
