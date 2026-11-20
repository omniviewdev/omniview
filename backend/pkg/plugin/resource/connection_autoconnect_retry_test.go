package resource

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// autoConnectRetryWindow bounds the wait for a retry that the host should make
// after the external cause of a failed auto-connect has gone away. Everything
// is in-process, so a retry made on the triggering event follows within
// milliseconds.
const autoConnectRetryWindow = 500 * time.Millisecond

// autoConnectScenario drives the real plugin-start path: discovery, the
// PLUGIN_START auto-connect, and the provider's connection watch. The provider's
// start fails until healed is set, which stands for an external, transient cause
// such as a plugin or credential source that is not available yet.
type autoConnectScenario struct {
	ctrl     *controller
	emitter  *recordingEmitter
	provider *mockProvider
	retry    types.ConnectionAutoConnectRetry
	endpoint atomic.Value
	starts   atomic.Int32
	healed   atomic.Bool
	attempts chan int
	frames   chan struct{}
}

func (s *autoConnectScenario) connection(endpoint string) types.Connection {
	return types.Connection{
		ID: "conn", Name: "conn", Data: map[string]any{"endpoint": endpoint},
		Lifecycle: types.ConnectionLifecycle{AutoConnect: &types.ConnectionAutoConnect{
			Enabled: true, Retry: s.retry,
			Triggers: []types.ConnectionAutoConnectTrigger{
				types.ConnectionAutoConnectTriggerPluginStart,
				types.ConnectionAutoConnectTriggerConnectionDiscovered,
			},
		}},
	}
}

func newAutoConnectScenario(t *testing.T, retry types.ConnectionAutoConnectRetry) *autoConnectScenario {
	t.Helper()
	ctrl, emitter := newTestControllerWithEmitter(t)
	s := &autoConnectScenario{
		ctrl: ctrl, emitter: emitter, retry: retry,
		attempts: make(chan int, 16), frames: make(chan struct{}, 4),
	}
	s.endpoint.Store("endpoint-1")
	provider := connectionOverlayTestProvider()
	provider.NativeConnectionsFunc = func(context.Context) ([]types.Connection, error) {
		return []types.Connection{s.connection(s.endpoint.Load().(string))}, nil
	}
	provider.StartConnectionFunc = func(_ context.Context, id string) (types.ConnectionStatus, error) {
		healed := s.healed.Load()
		attempt := int(s.starts.Add(1))
		select {
		case s.attempts <- attempt:
		default:
		}
		if !healed {
			return types.ConnectionStatus{}, errors.New("upstream unavailable")
		}
		return types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &types.Connection{ID: id, Name: id}}, nil
	}
	// A frame is only a notification: the host re-fetches the current inventory.
	provider.WatchConnectionsFunc = func(ctx context.Context, stream chan<- []types.Connection) error {
		for {
			select {
			case <-s.frames:
				select {
				case stream <- []types.Connection{}:
				case <-ctx.Done():
					return ctx.Err()
				}
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
	s.provider = provider
	return s
}

func (s *autoConnectScenario) startPlugin(t *testing.T, pluginID string, provider *mockProvider) {
	t.Helper()
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"resource": provider}})
	require.NoError(t, s.ctrl.OnPluginStart(pluginID, defaultMeta(), backend))
	t.Cleanup(func() { require.NoError(t, s.ctrl.OnPluginStop(pluginID, defaultMeta())) })
}

// awaitAttempt reports whether provider start number n begins within the limit.
func (s *autoConnectScenario) awaitAttempt(n int, within time.Duration) bool {
	timer := time.NewTimer(within)
	defer timer.Stop()
	for {
		select {
		case got := <-s.attempts:
			if got >= n {
				return true
			}
		case <-timer.C:
			return false
		}
	}
}

// failFirstAttempt starts the consumer and waits for its PLUGIN_START
// auto-connect to fail once.
func (s *autoConnectScenario) failFirstAttempt(t *testing.T) {
	t.Helper()
	s.startPlugin(t, "consumer", s.provider)
	require.True(t, s.awaitAttempt(1, 2*time.Second), "the PLUGIN_START auto-connect never attempted the connection")
}

// Defect (credential-broker plan item H4, part a, retry): a failed auto-connect
// is never attempted again unless one of the narrow triggers below happens. The
// host records "attempted" in autoConnectAttempts before it knows the outcome
// and never looks at the outcome (controller.go shouldAttemptAutoConnect). Under
// retry NONE any later attempt is refused; under ON_CHANGE it is refused unless
// the public configuration hash differs. A connection whose first start failed
// for an external, transient reason therefore stays failed after the cause is
// gone. Today only these retry: a restart of the same plugin (the record is
// cleared in onPluginStart), and, for ON_CHANGE, a PLUGIN_START or
// CONNECTION_DISCOVERED event that carries a different public configuration.
//
// This test covers the connection watch republishing the inventory with the
// same configuration (CONNECTION_DISCOVERED, for example a source file touched
// without a content change).
//
// Fixed looks like: once the cause is gone, the next discovery event for the
// failed connection gives it another attempt, whatever the retry policy and
// even though the configuration is unchanged (the exact policy for retry NONE is
// a product decision; the retry=NONE row documents that NONE cannot recover
// today). The control must keep passing: ON_CHANGE retries after a changed
// configuration.
func TestAutoConnectFailureIsRetriedWhenConnectionWatchRepublishesUnchangedConfiguration(t *testing.T) {
	for _, retry := range []types.ConnectionAutoConnectRetry{types.ConnectionAutoConnectRetryNone, types.ConnectionAutoConnectRetryOnChange} {
		t.Run("retry="+string(retry), func(t *testing.T) {
			s := newAutoConnectScenario(t, retry)
			s.failFirstAttempt(t)
			s.healed.Store(true)
			s.frames <- struct{}{}
			// The refresh published the inventory and offered the connection to
			// the CONNECTION_DISCOVERED trigger.
			s.emitter.WaitForNEvents(t, "consumer/connection/sync", 2, 2*time.Second)
			if !s.awaitAttempt(2, autoConnectRetryWindow) {
				t.Fatalf("auto-connect of consumer/conn failed once for an external, transient reason and the cause then cleared; "+
					"the connection watch republished the unchanged configuration (CONNECTION_DISCOVERED) and the host made no further attempt within %s "+
					"(retry=%s): a failed auto-connect is never retried", autoConnectRetryWindow, retry)
			}
		})
	}
	t.Run("control retry=ON_CHANGE with a changed configuration", func(t *testing.T) {
		s := newAutoConnectScenario(t, types.ConnectionAutoConnectRetryOnChange)
		s.failFirstAttempt(t)
		s.healed.Store(true)
		s.endpoint.Store("endpoint-2")
		s.frames <- struct{}{}
		require.True(t, s.awaitAttempt(2, 2*time.Second), "ON_CHANGE must retry after the public configuration changed")
	})
}

// Defect (credential-broker plan item H4, part a, retry): see the watch test
// above for the mechanism. This test covers the other external event named in
// the plan: a different plugin becomes available. Nothing in the resource
// controller connects the start of plugin B to the failed auto-connect of a
// connection of plugin A; onPluginStart clears only B's own attempt records.
//
// Fixed looks like: after the plugin that the connection needed has started, the
// failed connection gets another attempt (by an availability event or by a
// bounded timed retry; the window assumes the retry follows within half a
// second, so adjust it to the chosen backoff), for ON_CHANGE and, per the
// product decision on NONE, for NONE. The control documents today's only
// recovery: restarting the plugin that owns the connection.
func TestAutoConnectFailureIsRetriedWhenAnotherPluginBecomesAvailable(t *testing.T) {
	for _, retry := range []types.ConnectionAutoConnectRetry{types.ConnectionAutoConnectRetryNone, types.ConnectionAutoConnectRetryOnChange} {
		t.Run("retry="+string(retry), func(t *testing.T) {
			s := newAutoConnectScenario(t, retry)
			s.failFirstAttempt(t)
			// The connection needed the other plugin, which was not running yet.
			s.healed.Store(true)
			s.startPlugin(t, "dependency", connectionOverlayTestProvider())
			if !s.awaitAttempt(2, autoConnectRetryWindow) {
				t.Fatalf("auto-connect of consumer/conn failed once because the plugin it needs was not running; "+
					"that plugin then started and the host made no further attempt within %s (retry=%s): "+
					"a failed auto-connect is never retried", autoConnectRetryWindow, retry)
			}
		})
	}
	t.Run("control restart of the plugin that owns the connection", func(t *testing.T) {
		s := newAutoConnectScenario(t, types.ConnectionAutoConnectRetryNone)
		s.failFirstAttempt(t)
		s.healed.Store(true)
		s.startPlugin(t, "consumer", s.provider)
		require.True(t, s.awaitAttempt(2, 2*time.Second), "onPluginStart clears the attempt record, so a restart retries")
	})
}

// Defect (credential-broker plan item H4, part a, retry): ON_CHANGE is documented
// as permitting a retry after connection configuration changes
// (plugin-sdk types.ConnectionAutoConnectRetryOnChange), but the host only
// compares configuration when a trigger event offers the connection; saving the
// profile publishes the new configuration without offering it to
// scheduleAutoConnect. A user who corrects the failing endpoint therefore gets
// no retry until the plugin restarts or the provider's watch happens to fire.
//
// Fixed looks like: publishing a changed public configuration for a failed
// ON_CHANGE connection gives it another attempt.
func TestAutoConnectOnChangeIsRetriedAfterProfileSaveChangesConfiguration(t *testing.T) {
	s := newAutoConnectScenario(t, types.ConnectionAutoConnectRetryOnChange)
	s.failFirstAttempt(t)
	// The user corrects the endpoint, which was the cause of the failure.
	s.healed.Store(true)
	_, err := s.ctrl.SaveConnectionProfile(testInvocationContext(), "consumer", s.connection("endpoint-2"), nil)
	require.NoError(t, err)
	listed, err := s.ctrl.ListConnections(testInvocationContext(), "consumer")
	require.NoError(t, err)
	require.Len(t, listed, 1)
	require.Equal(t, "endpoint-2", listed[0].Data["endpoint"], "the corrected configuration is published")
	require.NotEqual(t, autoConnectConnectionSignature(s.connection("endpoint-1")), autoConnectConnectionSignature(listed[0]),
		"the public configuration signature changed, which is what ON_CHANGE compares")
	if !s.awaitAttempt(2, autoConnectRetryWindow) {
		t.Fatalf("auto-connect of consumer/conn (ON_CHANGE) failed; the profile was then saved with a changed public configuration "+
			"and the host made no further attempt within %s: saving a profile is not a retry trigger", autoConnectRetryWindow)
	}
}
