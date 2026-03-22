package data

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// Controller provides a JSON key-value store for plugins to persist arbitrary data.
// Each key is stored as a separate JSON file under <stateRoot>/plugins/{pluginID}/data/.
type Controller interface {
	ServiceStartup(ctx context.Context, options application.ServiceOptions) error
	ServiceShutdown() error
	Get(pluginID, key string) (any, error)
	Set(pluginID, key string, value any) error
	Delete(pluginID, key string) error
	Keys(pluginID string) ([]string, error)
}

var _ Controller = (*controller)(nil)

type controller struct {
	logger       logging.Logger
	pluginDataFn func(pluginID string) (*appstate.ScopedRoot, error)
}

// NewController creates a new data store controller.
// pluginDataFn returns a ScopedRoot for the given plugin's data directory.
func NewController(logger logging.Logger, pluginDataFn func(string) (*appstate.ScopedRoot, error)) Controller {
	return &controller{
		logger:       logger.Named("DataController"),
		pluginDataFn: pluginDataFn,
	}
}

func (c *controller) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return nil
}

func (c *controller) ServiceShutdown() error {
	return nil
}


func (c *controller) Get(pluginID, key string) (any, error) {
	logger := c.logger.With(logging.Any("pluginID", pluginID), logging.Any("key", key))

	root, err := c.pluginDataFn(pluginID)
	if err != nil {
		return nil, err
	}
	data, err := root.ReadFile(key + ".json")
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		logger.Errorw(context.Background(), "failed to read data file", "error", err)
		return nil, err
	}

	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		logger.Errorw(context.Background(), "failed to unmarshal data", "error", err)
		return nil, err
	}

	return value, nil
}

func (c *controller) Set(pluginID, key string, value any) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID), logging.Any("key", key))

	root, err := c.pluginDataFn(pluginID)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		logger.Errorw(context.Background(), "failed to marshal data", "error", err)
		return err
	}

	if err := root.WriteFile(key+".json", data, 0600); err != nil {
		logger.Errorw(context.Background(), "failed to write data file", "error", err)
		return err
	}

	return nil
}

func (c *controller) Delete(pluginID, key string) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID), logging.Any("key", key))

	root, err := c.pluginDataFn(pluginID)
	if err != nil {
		return err
	}
	if err := root.Remove(key + ".json"); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		logger.Errorw(context.Background(), "failed to delete data file", "error", err)
		return err
	}

	return nil
}

func (c *controller) Keys(pluginID string) ([]string, error) {
	logger := c.logger.With(logging.Any("pluginID", pluginID))

	root, err := c.pluginDataFn(pluginID)
	if err != nil {
		return nil, err
	}
	entries, err := root.ReadDir(".")
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []string{}, nil
		}
		logger.Errorw(context.Background(), "failed to read data dir", "error", err)
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
