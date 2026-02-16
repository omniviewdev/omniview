package data

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"go.uber.org/zap"
)

// Controller provides a JSON key-value store for plugins to persist arbitrary data.
// Each key is stored as a separate JSON file under ~/.omniview/plugins/{pluginID}/data/.
type Controller interface {
	Get(pluginID, key string) (any, error)
	Set(pluginID, key string, value any) error
	Delete(pluginID, key string) error
	Keys(pluginID string) ([]string, error)
}

var _ Controller = (*controller)(nil)

type controller struct {
	logger *zap.SugaredLogger
}

// NewController creates a new data store controller.
func NewController(logger *zap.SugaredLogger) Controller {
	return &controller{
		logger: logger.Named("DataController"),
	}
}

// dataDir returns the data directory for a plugin, creating it if necessary.
func (c *controller) dataDir(pluginID string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(homeDir, ".omniview", "plugins", pluginID, "data")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

// keyPath returns the full file path for a given plugin/key combination.
func (c *controller) keyPath(pluginID, key string) (string, error) {
	dir, err := c.dataDir(pluginID)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, key+".json"), nil
}

func (c *controller) Get(pluginID, key string) (any, error) {
	logger := c.logger.With("pluginID", pluginID, "key", key)

	path, err := c.keyPath(pluginID, key)
	if err != nil {
		logger.Errorw("failed to resolve key path", "error", err)
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		logger.Errorw("failed to read data file", "error", err)
		return nil, err
	}

	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		logger.Errorw("failed to unmarshal data", "error", err)
		return nil, err
	}

	return value, nil
}

func (c *controller) Set(pluginID, key string, value any) error {
	logger := c.logger.With("pluginID", pluginID, "key", key)

	path, err := c.keyPath(pluginID, key)
	if err != nil {
		logger.Errorw("failed to resolve key path", "error", err)
		return err
	}

	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		logger.Errorw("failed to marshal data", "error", err)
		return err
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		logger.Errorw("failed to write data file", "error", err)
		return err
	}

	return nil
}

func (c *controller) Delete(pluginID, key string) error {
	logger := c.logger.With("pluginID", pluginID, "key", key)

	path, err := c.keyPath(pluginID, key)
	if err != nil {
		logger.Errorw("failed to resolve key path", "error", err)
		return err
	}

	if err := os.Remove(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		logger.Errorw("failed to delete data file", "error", err)
		return err
	}

	return nil
}

func (c *controller) Keys(pluginID string) ([]string, error) {
	logger := c.logger.With("pluginID", pluginID)

	dir, err := c.dataDir(pluginID)
	if err != nil {
		logger.Errorw("failed to resolve data dir", "error", err)
		return nil, err
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []string{}, nil
		}
		logger.Errorw("failed to read data dir", "error", err)
		return nil, err
	}

	keys := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasSuffix(name, ".json") {
			keys = append(keys, strings.TrimSuffix(name, ".json"))
		}
	}

	return keys, nil
}
