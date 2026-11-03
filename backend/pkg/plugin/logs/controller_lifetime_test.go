package logs

import (
	"context"
	"testing"
	"time"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

func TestDirectStopDrainsSDKLogStream(t *testing.T) {
	manager := sdklogs.NewManager(sdklogs.ManagerConfig{Logger: logging.NewNop()})
	backend, err := plugintypes.ComposeNativeBackend(plugintypes.NativeProviders{Logs: manager})
	if err != nil {
		t.Fatal(err)
	}
	ctrl := NewController(logging.NewNop(), nil, nil).(*controller)
	ctrl.ctx = context.Background()
	if err := ctrl.OnPluginStart("native", config.PluginMeta{}, backend); err != nil {
		t.Fatal(err)
	}
	ctrl.mu.RLock()
	done := ctrl.streams["native"].done
	ctrl.mu.RUnlock()
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		_ = ctrl.OnPluginStop("native", config.PluginMeta{})
	}()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("native log stop did not drain SDK stream")
	}
	select {
	case <-done:
	default:
		t.Fatal("native stream worker survived stop")
	}
	if err := ctrl.OnPluginShutdown("native", config.PluginMeta{}); err != nil {
		t.Fatal(err)
	}
	if err := backend.Stop(); err != nil {
		t.Fatal(err)
	}
}

func TestStopDiscardsPendingLogBatchAndRejectsLateOutput(t *testing.T) {
	ctrl := NewController(logging.NewNop(), nil, nil).(*controller)
	ctrl.sessionIndex["session"] = sessionIndex{pluginID: "native"}
	ctrl.bufferLine("session", sdklogs.LogLine{Content: "pending"})
	ctrl.batchMux.Lock()
	batch := ctrl.batches["session"]
	if batch == nil || batch.timer == nil {
		ctrl.batchMux.Unlock()
		t.Fatal("log line did not schedule a flush")
	}
	ctrl.batchMux.Unlock()
	if err := ctrl.OnPluginStop("native", config.PluginMeta{}); err != nil {
		t.Fatal(err)
	}
	// A caller may already have passed handleOutput's initial index lookup.
	ctrl.bufferLine("session", sdklogs.LogLine{Content: "late"})
	time.Sleep(2 * BatchFlushInterval)
	ctrl.batchMux.Lock()
	defer ctrl.batchMux.Unlock()
	if len(ctrl.batches) != 0 {
		t.Fatal("retired session retained or recreated a pending flush")
	}
	// The nil application intentionally makes any stale timer publication fail.
}
