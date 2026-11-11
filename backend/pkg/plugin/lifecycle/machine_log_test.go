package lifecycle

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
)

func newRecordingTransitionLogger(t *testing.T) *logtest.RecordingSink {
	t.Helper()
	sink := &logtest.RecordingSink{}
	SetLogger(logging.New(logging.Config{
		Backend: logging.NewSinkBackend(sink),
		Level:   logging.NewLevelController(logging.LevelDebug),
	}))
	t.Cleanup(func() { SetLogger(nil) })
	return sink
}

func TestTransitionLogsDebugAndOmitsFailureReason(t *testing.T) {
	sink := newRecordingTransitionLogger(t)
	sm := NewPluginStateMachine("p1", PhaseStopped)

	require.NoError(t, sm.TransitionTo(PhaseStarting, "user requested"))
	sm.ForcePhase(PhaseFailed, "token=abc123 secret")

	records := sink.Records()
	require.Len(t, records, 2)
	require.Equal(t, logging.LevelDebug, records[0].Level)
	require.Equal(t, "plugin lifecycle transition", records[0].Message)
	require.Contains(t, fmt.Sprint(records[0].Fields), "user requested")
	require.Equal(t, logging.LevelDebug, records[1].Level)
	require.Contains(t, fmt.Sprint(records[1].Fields), string(PhaseFailed))
	require.NotContains(
		t, fmt.Sprint(records[1].Fields), "abc123", "failure reasons carry error text and must not be logged",
	)
}

func TestRejectedTransitionLogsWarn(t *testing.T) {
	sink := newRecordingTransitionLogger(t)
	sm := NewPluginStateMachine("p1", PhaseStopped)

	require.Error(t, sm.TransitionTo(PhaseRunning, "invalid"))

	records := sink.Records()
	require.Len(t, records, 1)
	require.Equal(t, logging.LevelWarn, records[0].Level)
	require.Equal(t, "plugin lifecycle transition rejected", records[0].Message)
}
