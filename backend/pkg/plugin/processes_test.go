package plugin

import (
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

type inventoryBackend struct {
	plugintypes.PluginBackend
	identity devsession.ProcessObservation
	err      error
	exited   bool
	query    func()
}

func (b *inventoryBackend) ProcessObservation() (devsession.ProcessObservation, error) {
	if b.query != nil {
		b.query()
	}
	return b.identity, b.err
}

func (b *inventoryBackend) Exited() bool { return b.exited }

func inventoryFixture() (*pluginManager, *inventoryBackend) {
	backend := &inventoryBackend{identity: devsession.ProcessObservation{PID: 123, StartIdentity: "start-1", Executable: "/plugin"}}
	return &pluginManager{records: map[string]*plugintypes.PluginRecord{
		"a": {ID: "a", Phase: lifecycle.PhaseRunning, Backend: backend},
	}}, backend
}

func TestPluginProcessesIndependentOfProfilingAndRPC(t *testing.T) {
	pm, backend := inventoryFixture()
	// The embedded backend is nil: any RPC would panic. Profiling stays disabled.
	results := pm.getPluginProcesses(func(int) (devsession.ProcessObservation, error) { return backend.identity, nil })
	require.Equal(t, []PluginProcessInfo{{PluginID: "a", Ownership: "verified", Identity: &backend.identity}}, results)
}

func TestPluginProcessesFinalFenceDisplacementDuringBatch(t *testing.T) {
	for _, replaceRecord := range []bool{false, true} {
		pm, first := inventoryFixture()
		later := &inventoryBackend{identity: devsession.ProcessObservation{PID: 456, StartIdentity: "start-2", Executable: "/later"}}
		later.query = func() {
			pm.recordsMu.Lock()
			defer pm.recordsMu.Unlock()
			if replaceRecord {
				pm.records["a"] = &plugintypes.PluginRecord{ID: "a", Phase: lifecycle.PhaseRunning, Backend: first}
			} else {
				pm.records["a"].Backend = &inventoryBackend{identity: first.identity}
			}
		}
		pm.records["b"] = &plugintypes.PluginRecord{ID: "b", Phase: lifecycle.PhaseRunning, Backend: later}
		results := pm.getPluginProcesses(func(pid int) (devsession.ProcessObservation, error) {
			if pid == first.identity.PID {
				return first.identity, nil
			}
			return later.identity, nil
		})
		require.Nil(t, results[0].Identity)
		require.Equal(t, "unverified", results[0].Ownership)
		require.Contains(t, results[0].Error, "changed")
		require.NotNil(t, results[1].Identity)
	}
}

func TestPluginProcessesFinalFenceExitAndPIDReuse(t *testing.T) {
	for _, change := range []string{"exit", "start", "executable", "permission"} {
		t.Run(change, func(t *testing.T) {
			pm, first := inventoryFixture()
			current := first.identity
			var observationErr error
			later := &inventoryBackend{identity: devsession.ProcessObservation{PID: 456, StartIdentity: "later", Executable: "/later"}}
			later.query = func() {
				switch change {
				case "exit":
					first.exited = true
				case "start":
					current.StartIdentity = "new-start"
				case "executable":
					current.Executable = "/replacement"
				case "permission":
					observationErr = errors.New("permission denied")
				}
			}
			pm.records["b"] = &plugintypes.PluginRecord{ID: "b", Phase: lifecycle.PhaseRunning, Backend: later}
			results := pm.getPluginProcesses(func(pid int) (devsession.ProcessObservation, error) {
				if pid == first.identity.PID {
					return current, observationErr
				}
				return later.identity, nil
			})
			require.Nil(t, results[0].Identity)
			require.Equal(t, "unverified", results[0].Ownership)
			require.NotEmpty(t, results[0].Error)
			if change == "permission" {
				require.False(t, first.exited)
				require.Contains(t, results[0].Error, "permission denied")
				require.Equal(t, lifecycle.PhaseRunning, pm.records["a"].Phase)
			}
		})
	}
}

func TestPluginProcessesUnavailableAndExited(t *testing.T) {
	for _, exited := range []bool{false, true} {
		pm, backend := inventoryFixture()
		backend.exited = exited
		backend.err = errors.New("identity permission denied")
		results := pm.getPluginProcesses(func(int) (devsession.ProcessObservation, error) {
			t.Fatal("unavailable launch identity must not be recovered by observing a PID")
			return devsession.ProcessObservation{}, nil
		})
		require.Nil(t, results[0].Identity)
		require.Equal(t, "unverified", results[0].Ownership)
		require.NotEmpty(t, results[0].Error)
	}
}

func TestPluginProcessesSharedInProcess(t *testing.T) {
	pm := &pluginManager{records: map[string]*plugintypes.PluginRecord{
		"builtin": {ID: "builtin", Phase: lifecycle.PhaseRunning, Backend: plugintypes.NewInProcessBackend(nil)},
	}}
	results := pm.getPluginProcesses(func(int) (devsession.ProcessObservation, error) {
		t.Fatal("in-process plugin identity belongs to the host collector")
		return devsession.ProcessObservation{}, nil
	})
	require.Equal(t, []PluginProcessInfo{{PluginID: "builtin", Ownership: "shared"}}, results)
}
