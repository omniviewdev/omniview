package data

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// dataFilePerm is the permission for plugin data files.
const dataFilePerm os.FileMode = 0o600

// Snapshot pairs a stored JSON value with its content revision.
// An empty revision means absent; a stored JSON null has a nonempty revision.
type Snapshot struct {
	Value    any    `json:"value"`
	Revision string `json:"revision"`
}

// Controller provides a JSON key-value store for plugins to persist arbitrary data.
// Each key is stored as a separate JSON file under <stateRoot>/plugins/{pluginID}/data/.
type Controller interface {
	ServiceStartup(ctx context.Context, options application.ServiceOptions) error
	ServiceShutdown() error
	Get(pluginID, key string) (any, error)
	GetSnapshot(pluginID, key string) (Snapshot, error)
	CompareAndSwap(pluginID, key, expectedRevision string, value any) (bool, error)
	Set(pluginID, key string, value any) error
	Delete(pluginID, key string) error
	Keys(pluginID string) ([]string, error)
}

var _ Controller = (*controller)(nil)

type controller struct {
	mu     sync.Mutex
	logger logging.Logger
	state  PluginDataState
}

// PluginDataState is the app state surface the controller needs.
type PluginDataState interface {
	// PluginData opens, creating on demand, a plugin's data directory. Used by writes.
	PluginData(id string) (*appstate.ScopedRoot, error)
	// PluginDataIfExists opens a plugin's data directory only if it exists. Used by reads.
	PluginDataIfExists(id string) (*appstate.ScopedRoot, bool, error)
}

// NewController creates a new data store controller. Writes (Set, Delete,
// CompareAndSwap) create plugin data directories on demand; reads (Get,
// GetSnapshot, Keys) only open directories that already exist, so a missing
// directory reads as an empty store.
func NewController(logger logging.Logger, state PluginDataState) Controller {
	return &controller{
		logger: logger.Named("DataController"),
		state:  state,
	}
}

func (c *controller) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return nil
}

func (c *controller) ServiceShutdown() error {
	return nil
}

func (c *controller) Get(pluginID, key string) (any, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	value, _, err := c.read(pluginID, key)
	return value, err
}

func (c *controller) GetSnapshot(pluginID, key string) (Snapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	value, data, err := c.read(pluginID, key)
	if err != nil {
		return Snapshot{}, err
	}
	if data == nil {
		return Snapshot{}, nil
	}
	revision := revisionBytes(data)
	return Snapshot{Value: value, Revision: string(revision[:])}, nil
}

func revisionBytes(data []byte) [sha256.Size * 2]byte {
	hash := sha256.Sum256(data)
	var revision [sha256.Size * 2]byte
	hex.Encode(revision[:], hash[:])
	return revision
}

// read requires mu to be held. Missing files return nil bytes.
func (c *controller) read(pluginID, key string) (any, []byte, error) {
	logger := c.logger.With(logging.Any("pluginID", pluginID), logging.Any("key", key))

	root, ok, err := c.state.PluginDataIfExists(pluginID)
	if err != nil {
		return nil, nil, err
	}
	if !ok {
		return nil, nil, nil
	}
	data, err := root.ReadFile(key + ".json")
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil, nil
		}
		logger.Errorw(context.Background(), "failed to read data file", "error", err)
		return nil, nil, err
	}

	var value any
	if err = json.Unmarshal(data, &value); err != nil {
		logger.Errorw(context.Background(), "failed to unmarshal data", "error", err)
		return nil, nil, err
	}

	return value, data, nil
}

func (c *controller) Set(pluginID, key string, value any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.write(pluginID, key, value)
}

// CompareAndSwap writes only when expectedRevision matches the current raw JSON.
func (c *controller) CompareAndSwap(pluginID, key, expectedRevision string, value any) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, data, err := c.read(pluginID, key)
	if err != nil {
		return false, err
	}
	if data == nil {
		if expectedRevision != "" {
			return false, nil
		}
	} else {
		revision := revisionBytes(data)
		if expectedRevision != string(revision[:]) {
			return false, nil
		}
	}
	if err := c.write(pluginID, key, value); err != nil {
		return false, err
	}
	return true, nil
}

// write requires mu to be held.
func (c *controller) write(pluginID, key string, value any) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID), logging.Any("key", key))

	root, err := c.state.PluginData(pluginID)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		logger.Errorw(context.Background(), "failed to marshal data", "error", err)
		return err
	}

	temporary := filepath.Join(filepath.Dir(key), ".data-write.tmp")
	defer root.Remove(temporary)
	if err = root.WriteFile(temporary, data, dataFilePerm); err != nil {
		logger.Errorw(context.Background(), "failed to write temporary data file", "error", err)
		return err
	}
	if err = root.Rename(temporary, key+".json"); err != nil {
		logger.Errorw(context.Background(), "failed to replace data file", "error", err)
		return err
	}

	return nil
}

func (c *controller) Delete(pluginID, key string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	logger := c.logger.With(logging.Any("pluginID", pluginID), logging.Any("key", key))

	root, err := c.state.PluginData(pluginID)
	if err != nil {
		return err
	}
	if err = root.Remove(key + ".json"); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		logger.Errorw(context.Background(), "failed to delete data file", "error", err)
		return err
	}

	return nil
}

func (c *controller) Keys(pluginID string) ([]string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	logger := c.logger.With(logging.Any("pluginID", pluginID))

	root, ok, err := c.state.PluginDataIfExists(pluginID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return []string{}, nil
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
