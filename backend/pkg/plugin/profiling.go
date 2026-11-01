package plugin

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const pluginProfilingTimeout = 2 * time.Second

// PluginProfilingStatus reports the active backend's own profiling listener.
// Supported is false only when the backend cannot expose the profiling RPC.
type PluginProfilingStatus struct {
	PluginID  string `json:"pluginID"`
	Running   bool   `json:"running"`
	URL       string `json:"url"`
	Error     string `json:"error"`
	Supported bool   `json:"supported"`
	PID       int    `json:"pid"`
}

// pluginProfilingEnvironment overrides ambient opt-in and removes the host's
// profiling port. Each opted-in child chooses its own loopback listener port.
func (pm *pluginManager) pluginProfilingEnvironment(environment []string) []string {
	clean := environment[:0]
	for _, entry := range environment {
		key, _, _ := strings.Cut(entry, "=")
		if key != "OMNIVIEW_PLUGIN_PPROF_ENABLED" && key != "OMNIVIEW_PPROF_PORT" {
			clean = append(clean, entry)
		}
	}
	return append(clean, "OMNIVIEW_PLUGIN_PPROF_ENABLED="+strconv.FormatBool(pm.pluginPprofEnabled))
}

type profilingBackendSnapshot struct {
	id      string
	record  *plugintypes.PluginRecord
	backend plugintypes.PluginBackend
}

// GetPluginProfilingStatuses queries actual lifecycle RPCs without retaining the
// inventory lock. One shared deadline bounds the entire poll, not each plugin.
func (pm *pluginManager) GetPluginProfilingStatuses() []PluginProfilingStatus {
	pm.recordsMu.RLock()
	snapshots := make([]profilingBackendSnapshot, 0, len(pm.records))
	for id, record := range pm.records {
		if record.Phase != lifecycle.PhaseRunning || record.Backend == nil {
			continue
		}
		snapshots = append(snapshots, profilingBackendSnapshot{
			id: id, record: record, backend: record.Backend,
		})
	}
	pm.recordsMu.RUnlock()
	sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].id < snapshots[j].id })

	ctx, cancel := context.WithTimeout(context.Background(), pluginProfilingTimeout)
	defer cancel()
	statuses := make([]PluginProfilingStatus, len(snapshots))
	var queries sync.WaitGroup
	queries.Add(len(snapshots))
	for i, snapshot := range snapshots {
		go func(i int, snapshot profilingBackendSnapshot) {
			defer queries.Done()
			statuses[i] = queryPluginProfiling(ctx, snapshot)
		}(i, snapshot)
	}
	queries.Wait()

	// Recheck every result after all RPCs: a backend can exit or be displaced
	// while another plugin is queried. Never publish its former endpoint.
	for i, snapshot := range snapshots {
		pm.recordsMu.RLock()
		current := pm.records[snapshot.id]
		unchanged := current == snapshot.record && current != nil &&
			current.Backend == snapshot.backend && current.Phase == lifecycle.PhaseRunning
		pm.recordsMu.RUnlock()
		if !unchanged || snapshot.backend == nil || snapshot.backend.Exited() {
			statuses[i] = PluginProfilingStatus{
				PluginID: snapshot.id, Supported: true, Error: "Plugin backend is not running or has changed",
			}
		}
	}
	return statuses
}

func queryPluginProfiling(ctx context.Context, snapshot profilingBackendSnapshot) PluginProfilingStatus {
	result := PluginProfilingStatus{PluginID: snapshot.id, Supported: true}
	if snapshot.backend.Exited() {
		result.Error = "Plugin backend is not running"
		return result
	}
	if err := ctx.Err(); err != nil {
		result.Error = fmt.Sprintf("Plugin profiling status: %v", err)
		return result
	}
	raw, err := snapshot.backend.Dispense("lifecycle")
	if err != nil {
		result.Supported = status.Code(err) != codes.Unimplemented
		result.Error = fmt.Sprintf("Plugin lifecycle RPC unavailable: %v", err)
		return result
	}
	client, ok := raw.(*lc.Client)
	if !ok {
		result.Supported = false
		result.Error = "Plugin SDK does not support profiling status"
		return result
	}
	response, err := client.GetProfilingStatus(ctx)
	if err != nil {
		if status.Code(err) == codes.Unimplemented {
			result.Supported = false
			result.Error = "Plugin SDK does not support profiling status"
		} else {
			result.Error = fmt.Sprintf("Plugin profiling status: %v", err)
		}
		return result
	}
	if response == nil {
		result.Error = "Plugin returned an empty profiling status"
		return result
	}
	result.Running = response.GetRunning()
	if result.Running {
		result.URL = response.GetUrl()
	}
	result.Error = response.GetError()
	result.PID = int(response.GetPid())
	return result
}
