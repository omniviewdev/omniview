package metric

import (
	"context"
	"sync"

	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	"github.com/omniviewdev/omniview/internal/telemetry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

type metricStreamKey struct{ plugin, connection string }

// Every lane owns one trusted connection profile and one SDK stream generation.
// Input channels are never closed underneath concurrent senders.
type metricStream struct {
	key               metricStreamKey
	input             chan metric.StreamInput
	ready             chan struct{}
	done              chan struct{}
	drained           chan struct{}
	cancel            context.CancelFunc
	once              sync.Once
	wireSubscriptions map[string]string
}

func (s *metricStream) stop() { s.once.Do(func() { close(s.done); s.cancel() }) }

func (c *controller) awaitStream(key metricStreamKey, state *metricStream) (*metricStream, error) {
	select {
	case <-state.ready:
	case <-state.done:
	}
	c.mux.RLock()
	blocked, failure, current := c.streamBlocked[key], c.streamErrors[key], c.streams[key]
	c.mux.RUnlock()
	if blocked > 0 {
		return nil, profileChangingError()
	}
	if failure != nil {
		return nil, failure
	}
	if current != state {
		return nil, closedStreamError()
	}
	select {
	case <-state.done:
		return nil, closedStreamError()
	default:
		return state, nil
	}
}

// ensureStream coalesces concurrent first subscriptions. No lane is ready until
// its actual host profile is resolved and the SDK's bounded handshake completes.
//
//nolint:gocognit,funlen,nonamedreturns // Stream setup coordinates admission, state and handshake.
func (c *controller) ensureStream(
	requestCtx context.Context, pluginID, connectionID string,
) (_ *metricStream, retErr error) {
	requestCtx, end := startOp(requestCtx, "metric.StreamOpen",
		attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	defer end(&retErr)
	if !c.HasPlugin(pluginID) {
		return nil, apperror.PluginNotFound(pluginID)
	}
	// Every caller must pass connection admission, even when sharing a ready lane.
	// Resolve before reserving shared state so denial cannot affect other owners.
	connection, err := c.resourceClient.GetConnection(requestCtx, pluginID, connectionID)
	if err != nil {
		return nil, err
	}
	if connection.ID != connectionID {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Metric connection profile does not match its selected route.")
	}
	key := metricStreamKey{pluginID, connectionID}
	c.mux.Lock()
	if c.streamBlocked[key] > 0 {
		c.mux.Unlock()
		return nil, profileChangingError()
	}
	if failure := c.streamErrors[key]; failure != nil {
		c.mux.Unlock()
		return nil, failure
	}
	if state := c.streams[key]; state != nil {
		c.mux.Unlock()
		return c.awaitStream(key, state)
	}
	provider := c.clients[pluginID]
	if provider == nil {
		c.mux.Unlock()
		return nil, apperror.PluginNotFound(pluginID)
	}
	ctx, cancel := context.WithCancel(c.ctx)
	state := &metricStream{key: key, input: make(chan metric.StreamInput), ready: make(chan struct{}), done: make(chan struct{}), drained: make(chan struct{}), cancel: cancel, wireSubscriptions: make(map[string]string)}
	c.streams[key] = state
	c.mux.Unlock()
	defer close(state.ready)
	workerStarted := false
	defer func() {
		if !workerStarted {
			close(state.drained)
		}
	}()
	fail := func(err error) (*metricStream, error) {
		c.logger.Warnw(requestCtx, "metric stream open failed", "pluginID", pluginID,
			"connectionID", connectionID, "errorClass", telemetryutil.ErrorClass(err))
		c.mux.Lock()
		if c.streams[key] == state {
			delete(c.streams, key)
			c.streamErrors[key] = err
		}
		c.mux.Unlock()
		state.stop()
		return nil, err
	}
	pc := types.NewPluginContextWithConnection(ctx, "metric", nil, nil, &connection)
	streamCtx := types.WithPluginContext(ctx, pc)
	output, err := streamLegacyProvider(provider, streamCtx, state.input)
	if err != nil {
		return fail(err)
	}
	if output == nil {
		return fail(resourcev2.NewError("INVALID_REQUEST", "Metric provider returned no ready stream."))
	}
	c.mux.RLock()
	current, blocked := c.streams[key] == state, c.streamBlocked[key] > 0
	c.mux.RUnlock()
	if !current || blocked {
		return fail(profileChangingError())
	}
	select {
	case <-ctx.Done():
		return fail(closedStreamError())
	default:
	}
	workerStarted = true
	go func() {
		defer close(state.drained)
		closeReason := "normal"
		defer func() {
			c.logger.Debugw(ctx, "metric stream closed", "pluginID", pluginID,
				"connectionID", connectionID, "close_reason", closeReason)
		}()
		first := true
		defer c.endStream(state, closedStreamError())
		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-output:
				if !ok {
					if ctx.Err() == nil {
						closeReason = "error"
						telemetry.RecordPluginStreamEvent(ctx, pluginID, "metric", "closed_error")
						c.logger.Warnw(ctx, "metric stream closed unexpectedly", "pluginID", pluginID, "connectionID", connectionID)
					}
					return
				}
				if first {
					first = false
					c.logger.Debugw(ctx, "metric stream first event", "pluginID", pluginID, "connectionID", connectionID)
				}
				if event.OperationError != nil && event.OperationError.Code == "RESET_REQUIRED" {
					telemetry.RecordPluginStreamEvent(ctx, pluginID, "metric", "reset")
					c.logger.Warnw(ctx, "metric stream reset required", "pluginID", pluginID,
						"connectionID", connectionID, "errorClass", "RESET_REQUIRED")
				}
				if event.SubscriptionID == "" && (event.OperationError != nil || event.Error != "") {
					closeReason = "error"
					failure := event.OperationError
					if failure == nil {
						failure = &resourcev2.ResourceOperationError{Code: "PROVIDER_ERROR", Message: "The metric stream failed."}
					}
					telemetry.RecordPluginStreamEvent(ctx, pluginID, "metric", "closed_error")
					c.logger.Warnw(ctx, "metric stream reported failure", "pluginID", pluginID,
						"connectionID", connectionID, "errorClass", telemetryutil.ErrorClass(failure))
					c.endStream(state, failure)
					return
				}
				if translated, owned := c.translateStreamOutput(state, event); owned {
					c.handleStreamOutput(translated)
				} else {
					telemetry.RecordPluginStreamEvent(ctx, pluginID, "metric", "dropped")
					c.logger.Debugw(ctx, "metric stream output dropped", "pluginID", pluginID, "connectionID", connectionID)
				}
			}
		}
	}()
	return state, nil
}

// A wire ID is immutable and never rebound, even if a public interest is reused.
// Check both directions and the exact lane before exposing its external event ID.
func (c *controller) translateStreamOutput(state *metricStream, output metric.StreamOutput) (metric.StreamOutput, bool) {
	c.mux.RLock()
	defer c.mux.RUnlock()
	wireID := output.SubscriptionID
	publicID, exists := state.wireSubscriptions[wireID]
	interest, current := c.subscriptions[publicID]
	if !exists || !current || interest.stream != state || interest.wireID != wireID || c.streams[state.key] != state {
		return metric.StreamOutput{}, false
	}
	// Operation errors may be recoverable polling failures. Retain ownership
	// until explicit unsubscribe or actual lane termination cancels native work.
	output.SubscriptionID = publicID
	return output, true
}

func (c *controller) forgetInterest(publicID, wireID string, state *metricStream) {
	c.mux.Lock()
	defer c.mux.Unlock()
	if interest, ok := c.subscriptions[publicID]; ok && interest.stream == state && interest.wireID == wireID {
		delete(c.subscriptions, publicID)
	}
	delete(state.wireSubscriptions, wireID)
}

func (c *controller) retireStream(stream *metricStream, failure *resourcev2.ResourceOperationError) []metric.StreamOutput {
	stream.stop()
	c.mux.Lock()
	defer c.mux.Unlock()
	if c.streams[stream.key] == stream {
		delete(c.streams, stream.key)
		c.streamErrors[stream.key] = failure
	}
	var terminal []metric.StreamOutput
	for id, subscription := range c.subscriptions {
		if subscription.stream != stream {
			continue
		}
		delete(c.subscriptions, id)
		terminal = append(terminal, metric.StreamOutput{SubscriptionID: id, Error: failure.Message, OperationError: failure})
	}
	clear(stream.wireSubscriptions)
	return terminal
}
func (c *controller) endStream(stream *metricStream, failure *resourcev2.ResourceOperationError) {
	for _, output := range c.retireStream(stream, failure) {
		c.handleStreamOutput(output)
	}
}
func closedStreamError() *resourcev2.ResourceOperationError {
	return &resourcev2.ResourceOperationError{Code: "UNAVAILABLE", Message: "The metric stream is no longer available."}
}
func profileChangingError() *resourcev2.ResourceOperationError {
	return &resourcev2.ResourceOperationError{Code: "RESET_REQUIRED", Message: "The metric connection profile changed."}
}

// BeginConnectionChange is a native host hook, not a Wails method. Its release
// must run after the authoritative profile transaction (including failure).
func (c *controller) BeginConnectionChange(pluginID, connectionID string) func() {
	key := metricStreamKey{pluginID, connectionID}
	c.mux.Lock()
	c.streamBlocked[key]++
	finite := c.finite.Load()
	state := c.streams[key]
	delete(c.streams, key)
	delete(c.streamErrors, key)
	c.mux.Unlock()
	if finite != nil {
		finite.retire(pluginID, connectionID, true)
	}
	if state != nil {
		ctx := c.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		telemetry.RecordPluginStreamEvent(ctx, pluginID, "metric", "reset")
		c.logger.Warnw(ctx, "metric stream reset required", "pluginID", pluginID,
			"connectionID", connectionID, "errorClass", "RESET_REQUIRED")
		c.endStream(state, profileChangingError())
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			c.mux.Lock()
			if finite := c.finite.Load(); finite != nil {
				finite.mu.Lock()
				finite.blocked[key]--
				if finite.blocked[key] == 0 {
					delete(finite.blocked, key)
				}
				finite.mu.Unlock()
			}
			defer c.mux.Unlock()
			c.streamBlocked[key]--
			if c.streamBlocked[key] == 0 {
				delete(c.streamBlocked, key)
			}
		})
	}
}
