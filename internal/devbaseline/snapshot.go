package devbaseline

import (
	"context"
	"encoding/gob"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/omniviewdev/plugin-sdk/settings"
	bolt "go.etcd.io/bbolt"
)

// Snapshot acquires the application's root flock before opening settings read-only
// in one coherent bbolt View. Missing .lock may be created, but no source setting,
// inventory, legacy file, runtime record or directory is rewritten or recovered.
func Snapshot(ctx context.Context, opts SnapshotOptions) (*Baseline, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := checkPlatform(); err != nil {
		return nil, err
	}
	root, err := strictPath(opts.SourceRoot)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("baseline: source must be a directory")
	}
	if opts.SourceVersion != "" && !versionID.MatchString(opts.SourceVersion) {
		return nil, fmt.Errorf("baseline: source version must be a nonsecret version identifier")
	}
	release, lockMarker, err := acquireSourceLock(filepath.Join(root, ".lock"))
	if err != nil {
		return nil, err
	}
	defer func() { _ = release() }()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	dbPath := filepath.Join(root, "settings.db")
	var values map[string]map[string]any
	if _, err := os.Lstat(dbPath); err == nil {
		values, err = readDatabase(ctx, dbPath)
		if err != nil {
			return nil, err
		}
	} else if os.IsNotExist(err) {
		values, err = readLegacy(ctx, root, opts.TemporaryRoot)
		if err != nil {
			return nil, err
		}
	} else {
		return nil, err
	}
	plugins, err := readInventory(filepath.Join(root, "plugin_state.json"))
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	ids := ancestorIDs(root)
	return normalize(&Baseline{SchemaVersion: 1, Policy: Policy, CreatedAt: time.Now().UTC(), Source: Source{RootID: ids[0], Version: opts.SourceVersion, AncestorIDs: ids, LockMarker: lockMarker}, Preferences: values, Plugins: plugins})
}

func readDatabase(ctx context.Context, path string) (values map[string]map[string]any, err error) {
	// Malformed untrusted bbolt pages can panic; fail closed, without recovery
	// writes or formatting private values into logs/errors.
	defer func() {
		if recover() != nil {
			values = nil
			err = fmt.Errorf("baseline: corrupt source settings database")
		}
	}()
	if err := probeIntegrity(ctx, path); err != nil {
		return nil, err
	}
	db, err := openReadOnlyDatabase(path)
	if err != nil {
		return nil, fmt.Errorf("baseline: cannot open source settings database read-only")
	}
	defer db.Close()
	values = make(map[string]map[string]any)
	err = db.View(func(tx *bolt.Tx) error {
		core := tx.Bucket([]byte("core"))
		if core == nil {
			return nil
		}
		for category := range preferenceKeys {
			raw := core.Get([]byte(category))
			if raw == nil {
				continue
			}
			var fields map[string]any
			if json.Unmarshal(raw, &fields) != nil {
				return fmt.Errorf("baseline: malformed allowlisted settings category")
			}
			values[category] = fields
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return values, nil
}

func readInventory(path string) ([]Plugin, error) {
	file, err := openRegular(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	// Deliberately decode only identity and version. DevPath, enabled/phase,
	// arbitrary metadata and isolation declarations are not trusted provenance.
	var records []struct {
		ID       string `json:"id"`
		Metadata struct {
			Version string `json:"version"`
		} `json:"metadata"`
	}
	if err := json.NewDecoder(io.LimitReader(file, 16<<20)).Decode(&records); err != nil {
		return nil, fmt.Errorf("baseline: malformed plugin inventory")
	}
	plugins := make([]Plugin, 0, len(records))
	for _, record := range records {
		plugins = append(plugins, Plugin{ID: record.ID, Version: record.Metadata.Version})
	}
	return plugins, nil
}

func readLegacy(ctx context.Context, root, tempRoot string) (map[string]map[string]any, error) {
	source, err := openRegular(filepath.Join(root, "settings"))
	if os.IsNotExist(err) {
		return map[string]map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer source.Close()
	// The only copied legacy file lives in an independent private staging directory.
	// Never run writable migration/recovery against the source, nor traverse plugin data.
	stage, err := newOwnedStage(tempRoot, ".baseline-legacy-")
	if err != nil {
		return nil, err
	}
	defer func() { _ = stage.cleanup() }()
	file, err := stage.root.OpenFile("settings", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, err
	}
	_, copyErr := io.Copy(file, io.LimitReader(source, 16<<20))
	closeErr := file.Close()
	if copyErr != nil {
		return nil, copyErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	staged, err := stage.root.Open("settings")
	if err != nil {
		return nil, err
	}
	defer staged.Close()
	var legacy settings.Store
	if gob.NewDecoder(staged).Decode(&legacy) != nil {
		return nil, fmt.Errorf("baseline: malformed legacy settings")
	}
	values := make(map[string]map[string]any)
	for category, keys := range preferenceKeys {
		fields := legacy[category].Settings
		for _, key := range keys {
			field, ok := fields[key]
			if !ok || field.Sensitive {
				continue
			}
			if values[category] == nil {
				values[category] = make(map[string]any)
			}
			values[category][key] = field.Value
		}
	}
	return values, nil
}
