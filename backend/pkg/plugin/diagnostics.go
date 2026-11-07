package plugin

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/internal/telemetry"
)

// State observers are installed only after successful activation. Failed startup
// records therefore never contribute an active plugin or a matching decrement.
func recordPluginActivation(pluginID string) {
	telemetry.RecordPluginActive(telemetry.WithPlugin(context.Background(), pluginID), 1)
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

func recordPluginTransition(pluginID string, t lifecycle.Transition) {
	delta, crashed := pluginTransitionMeasurements(t)
	ctx := telemetry.WithPlugin(context.Background(), pluginID)
	if delta != 0 {
		telemetry.RecordPluginActive(ctx, delta)
	}
	if crashed {
		telemetry.RecordPluginCrash(ctx)
	}
}
