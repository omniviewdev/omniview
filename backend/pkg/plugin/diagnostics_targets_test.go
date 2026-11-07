package plugin

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
)

type diagnosticsRPCClient struct {
	lifecyclepb.PluginLifecycleClient
	reply *lifecyclepb.GetDiagnosticsResponse
	err   error
	max   uint32
}

func (c *diagnosticsRPCClient) GetDiagnostics(_ context.Context, in *lifecyclepb.GetDiagnosticsRequest, _ ...grpc.CallOption) (*lifecyclepb.GetDiagnosticsResponse, error) {
	c.max = in.GetMaxSchemaVersion()
	return c.reply, c.err
}

func TestDiagnosticsTargetsOnlyRunningBackendsAndPullThroughLifecycle(t *testing.T) {
	rpc := &diagnosticsRPCClient{reply: &lifecyclepb.GetDiagnosticsResponse{SchemaVersion: 1, PluginId: "ok"}}
	running := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"lifecycle": lc.NewClient(rpc)}})
	builtin := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	pm := &pluginManager{records: map[string]*plugintypes.PluginRecord{
		"ok":      {ID: "ok", Phase: lifecycle.PhaseRunning, Backend: running},
		"loading": {ID: "loading", Phase: lifecycle.PhaseStarting, Backend: running},
		"builtin": {ID: "builtin", Phase: lifecycle.PhaseRunning, Backend: builtin},
		"none":    {ID: "none", Phase: lifecycle.PhaseRunning},
	}}
	targets := map[string]func(context.Context) (*lifecyclepb.GetDiagnosticsResponse, error){}
	for _, target := range pm.DiagnosticsTargets() {
		require.Same(t, pm.records[target.PluginID].Backend, target.Generation)
		targets[target.PluginID] = target.Fetch
	}
	require.Len(t, targets, 2)
	reply, err := targets["ok"](context.Background())
	require.NoError(t, err)
	require.Equal(t, "ok", reply.GetPluginId())
	require.EqualValues(t, 1, rpc.max)
	_, err = targets["builtin"](context.Background())
	require.Equal(t, codes.Unimplemented, status.Code(err))
}
