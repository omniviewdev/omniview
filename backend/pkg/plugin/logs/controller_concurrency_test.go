package logs

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// stubLogsProvider is a minimal LogsProvider for concurrency tests.
type stubLogsProvider struct{}

func (s *stubLogsProvider) GetSupportedResources(_ *sdktypes.PluginContext) []logs.Handler {
	return nil
}
func (s *stubLogsProvider) Stream(_ context.Context, _ chan logs.StreamInput) (chan logs.StreamOutput, error) {
	return make(chan logs.StreamOutput), nil
}
func (s *stubLogsProvider) CreateSession(_ *sdktypes.PluginContext, _ logs.CreateSessionOptions) (*logs.LogSession, error) {
	return &logs.LogSession{ID: "test"}, nil
}
func (s *stubLogsProvider) GetSession(_ *sdktypes.PluginContext, _ string) (*logs.LogSession, error) {
	return nil, nil
}
func (s *stubLogsProvider) ListSessions(_ *sdktypes.PluginContext) ([]*logs.LogSession, error) {
	return nil, nil
}
func (s *stubLogsProvider) CloseSession(_ *sdktypes.PluginContext, _ string) error { return nil }
func (s *stubLogsProvider) UpdateSessionOptions(_ *sdktypes.PluginContext, _ string, _ logs.LogSessionOptions) (*logs.LogSession, error) {
	return nil, nil
}

// TestController_ConcurrentMapAccess verifies that concurrent reads and writes
// to the controller's internal maps do not cause a race or panic.
// Run with: go test -race -run TestController_ConcurrentMapAccess
func TestController_ConcurrentMapAccess(t *testing.T) {
	ctrl := &controller{
		ctx:          context.Background(),
		logger:       zap.NewNop().Sugar(),
		clients:      make(map[string]LogsProvider),
		sessionIndex: make(map[string]sessionIndex),
		inChans:      make(map[string]chan logs.StreamInput),
		outputMux:    make(chan logs.StreamOutput, 256),
		handlerMap:   make(map[string]map[string]logs.Handler),
		batches:      make(map[string]*logBatch),
	}

	const N = 20
	var wg sync.WaitGroup

	// Concurrent writers: simulate OnPluginStart/Stop
	for i := range N {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			pluginID := "plugin-" + string(rune('a'+id%5))

			// Write
			ctrl.mu.Lock()
			ctrl.clients[pluginID] = &stubLogsProvider{}
			ctrl.inChans[pluginID] = make(chan logs.StreamInput)
			ctrl.mu.Unlock()

			// Read
			ctrl.ListPlugins()
			ctrl.HasPlugin(pluginID)
			ctrl.GetSupportedResources(pluginID)

			// Delete
			ctrl.mu.Lock()
			delete(ctrl.clients, pluginID)
			if ch, ok := ctrl.inChans[pluginID]; ok {
				close(ch)
				delete(ctrl.inChans, pluginID)
			}
			ctrl.mu.Unlock()
		}(i)
	}

	// Concurrent readers
	for range N {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctrl.ListPlugins()
			ctrl.HasPlugin("nonexistent")
			ctrl.GetSupportedResources("nonexistent")
		}()
	}

	wg.Wait()

	// Verify the controller is still usable
	plugins, err := ctrl.ListPlugins()
	assert.NoError(t, err)
	assert.NotNil(t, plugins)
}

// TestController_ConcurrentSessionIndex verifies that concurrent writes to
// sessionIndex do not race.
func TestController_ConcurrentSessionIndex(t *testing.T) {
	ctrl := &controller{
		ctx:          context.Background(),
		logger:       zap.NewNop().Sugar(),
		clients:      make(map[string]LogsProvider),
		sessionIndex: make(map[string]sessionIndex),
		inChans:      make(map[string]chan logs.StreamInput),
		outputMux:    make(chan logs.StreamOutput, 256),
		handlerMap:   make(map[string]map[string]logs.Handler),
		batches:      make(map[string]*logBatch),
	}

	meta := config.PluginMeta{ID: "test"}
	_ = meta

	const N = 20
	var wg sync.WaitGroup

	for i := range N {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			sessionID := "session-" + string(rune('a'+id%10))

			// Write session index
			ctrl.mu.Lock()
			ctrl.sessionIndex[sessionID] = sessionIndex{
				pluginID:     "test",
				connectionID: "conn",
			}
			ctrl.mu.Unlock()

			// Read session index
			ctrl.mu.RLock()
			_, _ = ctrl.sessionIndex[sessionID]
			ctrl.mu.RUnlock()

			// Delete session index
			ctrl.mu.Lock()
			delete(ctrl.sessionIndex, sessionID)
			ctrl.mu.Unlock()
		}(i)
	}

	wg.Wait()
}
