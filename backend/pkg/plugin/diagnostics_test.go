package plugin

import (
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
)

func TestPluginLifecycleMeasurements(t *testing.T) {
	tests := []struct {
		name        string
		phases      []lifecycle.PluginPhase
		wantCrashes int
	}{
		{"unload", []lifecycle.PluginPhase{lifecycle.PhaseStopped, lifecycle.PhaseStopped}, 0},
		{"failed unload", []lifecycle.PluginPhase{lifecycle.PhaseFailed, lifecycle.PhaseFailed, lifecycle.PhaseStopped}, 0},
		{"crash then unload", []lifecycle.PluginPhase{lifecycle.PhaseRecovering, lifecycle.PhaseStopped, lifecycle.PhaseFailed}, 1},
		{"recovery then crash", []lifecycle.PluginPhase{lifecycle.PhaseRecovering, lifecycle.PhaseStopped, lifecycle.PhaseRunning, lifecycle.PhaseRecovering, lifecycle.PhaseFailed}, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			machine := lifecycle.NewPluginStateMachine("test", lifecycle.PhaseRunning)
			active, crashes := int64(1), 0
			machine.AddObserver(func(_ string, transition lifecycle.Transition) {
				delta, crashed := pluginTransitionMeasurements(transition)
				active += delta
				if crashed {
					crashes++
				}
				if active < 0 || active > 1 {
					t.Fatalf("active count escaped lifecycle bounds: %d", active)
				}
			})
			for _, phase := range tt.phases {
				machine.ForcePhase(phase, "test lifecycle")
			}
			if active != 0 || crashes != tt.wantCrashes {
				t.Fatalf("active=%d crashes=%d; want active=0 crashes=%d", active, crashes, tt.wantCrashes)
			}
		})
	}
}
