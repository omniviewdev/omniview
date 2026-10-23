package devserver

import (
	"context"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/instance"
)

// ConfigureWorkspace is startup-only, before services/managed plugins start.
// expectedSDKRevision must come from the trusted reviewed-source build graph,
// never plugin.yaml or a plugin-controlled environment value.
func (m *DevServerManager) ConfigureWorkspace(profile instance.Profile, registryRoot, expectedSDKRevision string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.instances) != 0 {
		return fmt.Errorf("cannot change workspace with managed plugins")
	}
	if profile.Workspace == nil || profile.Descriptor.WorkspaceID == "" {
		return fmt.Errorf("managed workspace requires a resolved workspace")
	}
	if profile.Descriptor.StateRoot != m.stateRoot.ResolvePath("") {
		return fmt.Errorf("managed workspace state root mismatch")
	}
	if err := profile.Workspace.Manifest.Validate(); err != nil {
		return err
	}
	policy := profile.Workspace.Manifest.Ports
	policy.Overrides = maps.Clone(policy.Overrides)
	registry, err := devsession.OpenRegistry(registryRoot, devsession.RegistryOptions{})
	if err != nil {
		return err
	}
	owner, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: profile.Descriptor.WorkspaceID, Generation: profile.Descriptor.Generation, Role: "host", Source: profile.Workspace.ManifestPath})
	if err != nil {
		return err
	}
	buildEnvironment, err := profile.ChildEnvironment(os.Environ(), "")
	if err != nil {
		return err
	}
	m.ports.registry, m.ports.owner = registry, owner
	m.ports.portPolicy = policy
	m.buildEnvironment = buildEnvironment
	m.workspace = profile.Workspace
	m.expectedSDKRevision = expectedSDKRevision
	return nil
}

func (m *DevServerManager) LifecycleGeneration(id, source string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	inst := m.instances[id]
	if inst == nil {
		return ""
	}
	canonical, err := filepath.EvalSymlinks(source)
	if err != nil {
		return ""
	}
	if canonical != inst.devPath {
		return ""
	}
	return inst.generation
}

// RuntimeGeneration changes for each replacement build, independently of the
// stable managed watcher generation used by control operations.
func (m *DevServerManager) RuntimeGeneration(id, source string) string {
	m.mu.RLock()
	inst := m.instances[id]
	m.mu.RUnlock()
	if inst == nil {
		return ""
	}
	canonical, err := filepath.EvalSymlinks(source)
	if err != nil || canonical != inst.devPath {
		return ""
	}
	inst.mu.RLock()
	defer inst.mu.RUnlock()
	return inst.runtimeGeneration
}

// NotifyPluginLifecycle rejects late observations from stopped/rebound sessions.
func (m *DevServerManager) NotifyPluginLifecycle(id, source, generation string, rpc, controllers bool, lifecycleErr error) bool {
	m.mu.RLock()
	inst := m.instances[id]
	m.mu.RUnlock()
	if inst == nil || generation == "" {
		return false
	}
	canonical, err := filepath.EvalSymlinks(source)
	if err != nil || canonical != inst.devPath {
		return false
	}
	return inst.notifyLifecycleGeneration(generation, rpc, controllers, lifecycleErr)
}

func (m *DevServerManager) WaitReady(ctx context.Context, id, generation string) (DevServerState, error) {
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		state := m.GetDevServerState(id)
		if state.Generation != generation || generation == "" {
			return state, devcontract.Fail(4, "stale_target", "managed plugin generation changed")
		}
		if state.LastError != "" {
			return state, fmt.Errorf("plugin lifecycle: %s", state.LastError)
		}
		if stage := devcontract.FailedReadinessStage(string(state.BuildStatus), string(state.ViteStatus), string(state.RPCStatus), string(state.ControllerStatus)); stage != "" || state.GoStatus == DevProcessStatusError {
			return state, fmt.Errorf("managed lifecycle stage failed: Vite=%s build=%s RPC=%s controllers=%s", state.ViteStatus, state.BuildStatus, state.RPCStatus, state.ControllerStatus)
		}
		if state.Ready {
			return state, nil
		}
		select {
		case <-ctx.Done():
			return state, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (m *DevServerManager) RebuildPluginGeneration(ctx context.Context, id, generation string) error {
	m.mu.RLock()
	inst := m.instances[id]
	m.mu.RUnlock()
	if inst == nil || inst.generation != generation {
		return devcontract.Fail(4, "stale_target", "managed plugin generation changed")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return inst.TriggerRebuild()
}

func (m *DevServerManager) WatchedGoDirectories(id string) []string {
	m.mu.RLock()
	inst := m.instances[id]
	m.mu.RUnlock()
	if inst == nil || inst.goWatcher == nil {
		return nil
	}
	return inst.goWatcher.WatchedDirectories()
}

// SetDependencyWatching hands dependency invalidation to A15 without creating a
// second owner. Plugin source/root watching remains in this canonical watcher.
func (m *DevServerManager) SetDependencyWatching(id, generation string, enabled bool) error {
	m.mu.RLock()
	inst := m.instances[id]
	m.mu.RUnlock()
	if inst == nil || inst.generation != generation || generation == "" || inst.goWatcher == nil {
		return devcontract.Fail(4, "stale_target", "managed backend watcher source/generation changed")
	}
	return inst.goWatcher.SetDependencyWatching(enabled)
}

// ConfigureDependencyWatching is startup configuration for the single watch graph.
func (m *DevServerManager) ConfigureDependencyWatching(enabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.instances) != 0 {
		return fmt.Errorf("configure dependency watching before starting managed plugins")
	}
	m.disableDependencyWatching = !enabled
	return nil
}

func (m *DevServerManager) operationLock(id string) *sync.Mutex {
	lock, _ := m.operations.LoadOrStore(id, &sync.Mutex{})
	return lock.(*sync.Mutex)
}
