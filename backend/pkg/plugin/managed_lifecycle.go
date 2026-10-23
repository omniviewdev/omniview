package plugin

import (
	"context"
	"fmt"
	"time"

	"os"
	"strings"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/instance"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
)

// Optional interface keeps transactional fake boundaries narrow. Production's
// managed devserver implements this; no callback is inferred from build success.
type managedLifecycleObserver interface {
	LifecycleGeneration(id, source string) string
	RuntimeGeneration(id, source string) string
	NotifyPluginLifecycle(id, source, generation string, rpc, controllers bool, err error) bool
}

func (pm *pluginManager) managedGeneration(id, source string) string {
	if observer, ok := pm.devServerMgr.(managedLifecycleObserver); ok {
		return observer.LifecycleGeneration(id, source)
	}
	return ""
}

func (pm *pluginManager) managedRuntimeGeneration(id, source string) string {
	if observer, ok := pm.devServerMgr.(managedLifecycleObserver); ok {
		return observer.RuntimeGeneration(id, source)
	}
	return ""
}
func (pm *pluginManager) observeManagedLifecycle(id, source, generation string, rpc, controllers bool, err error) {
	if observer, ok := pm.devServerMgr.(managedLifecycleObserver); ok {
		observer.NotifyPluginLifecycle(id, source, generation, rpc, controllers, err)
	}
}

func verifyLifecycleRPC(backend plugintypes.PluginBackend, id string) error {
	raw, err := backend.Dispense("lifecycle")
	if err != nil {
		return fmt.Errorf("lifecycle RPC unavailable: %w", err)
	}
	client, ok := raw.(*lc.Client)
	if !ok {
		return fmt.Errorf("lifecycle client has unexpected type %T", raw)
	}
	return verifyLifecycleClient(client, id, backend.NegotiatedVersion())
}

func verifyLifecycleClient(client *lc.Client, id string, protocol int) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	info, err := client.GetInfo(ctx)
	if err != nil {
		return fmt.Errorf("lifecycle GetInfo: %w", err)
	}
	if info.GetPluginId() != id {
		return fmt.Errorf("lifecycle plugin ID %q does not match %q", info.GetPluginId(), id)
	}
	if protocol != plugintypes.CurrentProtocolVersion || int(info.GetSdkProtocolVersion()) != protocol {
		return fmt.Errorf("lifecycle SDK protocol %d / negotiated %d does not match required %d", info.GetSdkProtocolVersion(), protocol, plugintypes.CurrentProtocolVersion)
	}
	health, err := client.HealthCheck(ctx)
	if err != nil {
		return fmt.Errorf("lifecycle HealthCheck: %w", err)
	}
	if health.GetStatus() != lifecyclepb.ServingStatus_SERVING_STATUS_SERVING {
		return fmt.Errorf("lifecycle backend not serving: %s", health.GetStatus())
	}
	_, err = client.GetCapabilities(ctx)
	if err != nil {
		return fmt.Errorf("lifecycle GetCapabilities: %w", err)
	}
	return nil
}

// ReloadManagedPlugin revalidates cancellation and exact managed source after
// acquiring the lifecycle lock; a queued old watcher cannot reload a rebound ID.
func (pm *pluginManager) ReloadManagedPlugin(ctx context.Context, id, source, generation string) error {
	lock := pm.pluginOpsLock(id)
	lock.Lock()
	defer lock.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if generation == "" || pm.managedGeneration(id, source) != generation {
		return fmt.Errorf("managed plugin source/generation changed")
	}
	pm.recordsMu.RLock()
	record := pm.records[id]
	pm.recordsMu.RUnlock()
	if record != nil && record.DevPath != source {
		return fmt.Errorf("installed plugin source changed")
	}
	_, err := pm.reloadPluginLocked(id)
	return err
}

// StopDevPlugin stops the canonical managed processes but retains the installed
// binding for list/get/start. The watcher is stopped before taking pluginOpsLock:
// a build callback may already be waiting for that lock.
func (pm *pluginManager) StopDevPlugin(id string) error {
	pm.recordsMu.RLock()
	expected := pm.records[id]
	pm.recordsMu.RUnlock()
	if expected == nil {
		return fmt.Errorf("plugin %q not found", id)
	}
	if !expected.DevMode {
		return fmt.Errorf("plugin %q is not a development plugin", id)
	}
	if pm.devServerMgr != nil && pm.devServerMgr.IsManaged(id) {
		if err := pm.devServerMgr.StopDevServer(id); err != nil {
			return err
		}
	}
	lock := pm.pluginOpsLock(id)
	lock.Lock()
	defer lock.Unlock()
	pm.recordsMu.RLock()
	record := pm.records[id]
	pm.recordsMu.RUnlock()
	if record == nil || record.DevPath != expected.DevPath || !record.DevMode || (pm.devServerMgr != nil && pm.devServerMgr.IsManaged(id)) {
		return fmt.Errorf("plugin %q binding changed while stopping", id)
	}
	if record.Phase == lifecycle.PhaseStopped && record.Backend == nil {
		return nil
	}
	if pm.healthChecker != nil {
		pm.healthChecker.CancelRecovery(id)
	}
	if record.Phase == lifecycle.PhaseRunning {
		if err := pm.stopPlugin(record); err != nil {
			return err
		}
	}
	if err := pm.shutdownPlugin(id, record); err != nil {
		return err
	}
	stopped := *record
	stopped.Backend = nil
	stopped.Capabilities = nil
	stopped.ProtocolVersion = 0
	stopped.Phase = lifecycle.PhaseStopped
	stopped.LastError = ""
	pm.recordsMu.Lock()
	pm.records[id] = &stopped
	pm.recordsMu.Unlock()
	if stopped.StateMachine != nil {
		stopped.StateMachine.ForcePhase(lifecycle.PhaseStopped, "development plugin stopped")
	}
	return nil
}

func (pm *pluginManager) checkBackendRecovery(id string) error {
	if pm.pidTracker == nil {
		return fmt.Errorf("backend process ownership tracker unavailable")
	}
	env, err := instance.PluginEnvironment(pm.stateRoot.ResolvePath(""), id, os.Environ())
	if err != nil {
		return err
	}
	workspaceID := ""
	for _, entry := range env {
		if strings.HasPrefix(entry, "OMNIVIEW_WORKSPACE_ID=") {
			workspaceID = strings.TrimPrefix(entry, "OMNIVIEW_WORKSPACE_ID=")
		}
	}
	return pm.pidTracker.CheckAvailable(id, workspaceID)
}
