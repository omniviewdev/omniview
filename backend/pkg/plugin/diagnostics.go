package plugin

import (
	"context"
	"errors"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	"github.com/omniviewdev/omniview/internal/telemetry"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// State observers are installed only after successful activation. Failed startup
// records therefore never contribute an active plugin or a matching decrement.
func (pm *pluginManager) recordPluginActivation(pluginID string) {
	telemetry.RecordPluginActive(telemetry.WithPlugin(pm.metricContext(), pluginID), 1)
}

// metricContext is the manager context for metric records, which no lifecycle
// observer receives a caller context for.
func (pm *pluginManager) metricContext() context.Context {
	if pm.ctx != nil {
		return pm.ctx
	}
	return context.Background()
}

func pluginTransitionMeasurements(t lifecycle.Transition) (activeDelta int64, crashed bool) {
	if t.From == t.To {
		return 0, false
	}
	if t.From == lifecycle.PhaseRunning {
		activeDelta--
	}
	if t.To == lifecycle.PhaseRunning {
		activeDelta++
	}
	return activeDelta, t.From == lifecycle.PhaseRunning && t.To == lifecycle.PhaseRecovering
}

func (pm *pluginManager) recordPluginTransition(pluginID string, t lifecycle.Transition) {
	delta, crashed := pluginTransitionMeasurements(t)
	ctx := telemetry.WithPlugin(pm.metricContext(), pluginID)
	if delta != 0 {
		telemetry.RecordPluginActive(ctx, delta)
	}
	if crashed {
		telemetry.RecordPluginCrash(ctx)
	}
}

// DiagnosticsTargets lists running backends for the diagnostics poller. It
// holds the inventory lock only while copying; calls happen in the poller.
// Generation is the backend value itself, so a replaced backend is a new
// generation and its cached capability probe is discarded.
func (pm *pluginManager) DiagnosticsTargets() []telemetry.PluginDiagnosticsTarget {
	pm.recordsMu.RLock()
	defer pm.recordsMu.RUnlock()
	targets := make([]telemetry.PluginDiagnosticsTarget, 0, len(pm.records))
	for id, record := range pm.records {
		if record.Phase != lifecycle.PhaseRunning || record.Backend == nil {
			continue
		}
		backend := record.Backend
		targets = append(targets, telemetry.PluginDiagnosticsTarget{
			PluginID: id, Generation: backend,
			Fetch: func(ctx context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) {
				if backend.Exited() {
					return nil, errors.New("plugin backend is not running")
				}
				raw, err := backend.Dispense("lifecycle")
				if err != nil {
					// Builtin in-process backends serve no lifecycle RPC; a stopped
					// external backend ends its generation. Neither is retried.
					if pm.logger != nil {
						pm.logger.Debugw(ctx, "plugin lifecycle capability unavailable for diagnostics",
							"pluginID", id, "errorClass", telemetryutil.ErrorClass(err))
					}
					return nil, status.Error(codes.Unimplemented, "plugin serves no lifecycle capability")
				}
				client, ok := raw.(*lc.Client)
				if !ok {
					return nil, status.Error(codes.Unimplemented, "plugin lifecycle client lacks diagnostics")
				}
				return client.GetDiagnostics(ctx, 1)
			},
		})
	}
	return targets
}
