package metric

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

var tracer = otel.Tracer("omniview.metric")

// MetricProviderSummary is a lightweight summary of a metric provider,
// exposed to the frontend.
type MetricProviderSummary struct {
	PluginID    string           `json:"plugin_id"`
	ProviderID  string           `json:"provider_id"`
	Name        string           `json:"name"`
	Icon        string           `json:"icon"`
	Description string           `json:"description"`
	Handlers    []metric.Handler `json:"handlers"`
}

// Controller manages metric providers across all plugins.
type Controller interface {
	internaltypes.Controller
	ServiceStartup(ctx context.Context, options application.ServiceOptions) error
	ServiceShutdown() error
	SetReferenceAdmitter(resource.ReferenceAdmitter)

	// Discovery
	GetProviders() []MetricProviderSummary
	GetProvidersForResource(resourceKey string) []MetricProviderSummary

	// Querying
	Query(pluginID, connectionID string, req metric.QueryRequest) (*metric.QueryResponse, error)
	QueryAll(connectionID string, req metric.QueryRequest) (map[string]*metric.QueryResponse, error)

	// Streaming
	Subscribe(pluginID, connectionID string, req SubscribeRequest) (string, error)
	Unsubscribe(subscriptionID string) error
	BeginConnectionChange(pluginID, connectionID string) func()
}

// SubscribeRequest contains parameters for subscribing to a metric stream.
type SubscribeRequest struct {
	ResourceKey       string                        `json:"resource_key"`
	ResourceID        string                        `json:"resource_id"`
	ResourceNamespace string                        `json:"resource_namespace"`
	ResourceData      *resourcev2.Value             `json:"resource_data,omitempty"`
	Reference         *resourcev2.ResourceReference `json:"reference,omitempty"`
	Route             *resourcev2.AccessRoute       `json:"route,omitempty"`
	MetricIDs         []string                      `json:"metric_ids"`
	Interval          time.Duration                 `json:"interval"`
	Params            map[string]string             `json:"params,omitempty"`
}

type subscriptionIndex struct {
	stream *metricStream
	wireID string
}

var _ Controller = (*controller)(nil)

type controller struct {
	emitter           resource.EventEmitter
	ctx               context.Context
	logger            logging.Logger
	settingsProvider  pkgsettings.Provider
	clients           map[string]Provider
	providerInfos     map[string]*metric.ProviderInfo // pluginID -> provider info
	handlerMap        map[string][]metric.Handler     // pluginID -> handlers
	resourceIndex     map[string][]string             // resource key -> []pluginID
	subscriptions     map[string]subscriptionIndex    // subscriptionID -> index
	streams           map[metricStreamKey]*metricStream
	streamErrors      map[metricStreamKey]error
	streamBlocked     map[metricStreamKey]int
	resourceClient    resource.ConnectionReader
	referenceAdmitter resource.ReferenceAdmitter
	mux               sync.RWMutex
}

// SetReferenceAdmitter is configured by native composition before startup.
func (c *controller) SetReferenceAdmitter(admit resource.ReferenceAdmitter) {
	c.referenceAdmitter = admit
}

func NewController(
	logger logging.Logger,
	sp pkgsettings.Provider,
	resourceClient resource.ConnectionReader,
) Controller {
	return &controller{
		ctx:              nil,
		logger:           logger.Named("MetricController"),
		settingsProvider: sp,
		clients:          make(map[string]Provider),
		providerInfos:    make(map[string]*metric.ProviderInfo),
		handlerMap:       make(map[string][]metric.Handler),
		resourceIndex:    make(map[string][]string),
		subscriptions:    make(map[string]subscriptionIndex),
		streams:          make(map[metricStreamKey]*metricStream),
		streamErrors:     make(map[metricStreamKey]error),
		streamBlocked:    make(map[metricStreamKey]int),
		resourceClient:   resourceClient,
		mux:              sync.RWMutex{},
	}
}

func (c *controller) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	c.emitter = resource.NewAppEmitter(application.Get())
	c.ctx = ctx
	return nil
}

func (c *controller) ServiceShutdown() error {
	return nil
}

// ================================ Controller Lifecycle ================================ //

func (c *controller) OnPluginInit(pluginID string, _ config.PluginMeta) {
	c.logger.With(logging.Any("pluginID", pluginID)).Debugw(context.Background(), "OnPluginInit")
}

// dispenseProvider extracts the metric provider from the backend,
// wrapping it in the version-appropriate adapter.
func dispenseProvider(pluginID string, backend internaltypes.PluginBackend) (Provider, error) {
	raw, err := backend.Dispense("metric")
	if err != nil {
		return nil, err
	}

	version := backend.NegotiatedVersion()
	switch version {
	case 1:
		v1, ok := raw.(metric.Provider)
		if !ok {
			return nil, apperror.New(
				apperror.TypePluginLoadFailed, http.StatusInternalServerError,
				"Plugin type mismatch",
				fmt.Sprintf("Expected metric.Provider for v1, got %T", raw),
			)
		}
		return NewAdapterV1(v1), nil
	default:
		return nil, apperror.New(
			apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			"Unsupported SDK protocol version",
			fmt.Sprintf("Plugin '%s' negotiated v%d for metric, engine supports v1", pluginID, version),
		)
	}
}

func (c *controller) OnPluginStart(pluginID string, _ config.PluginMeta, backend internaltypes.PluginBackend) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginStart")

	provider, err := dispenseProvider(pluginID, backend)
	if err != nil {
		logger.Errorw(context.Background(), "error", "error", err)
		return err
	}

	// Get supported resources before acquiring the lock (this makes an RPC call).
	info, handlers := provider.GetSupportedResources(c.getUnconnectedCtx(context.Background()))

	// Query discovery is independent of stream capability. A trusted connection
	// profile and canonical readiness are resolved lazily at first subscription.
	c.removePlugin(pluginID)
	c.mux.Lock()
	c.clients[pluginID] = provider
	c.providerInfos[pluginID] = info
	c.handlerMap[pluginID] = handlers
	for _, h := range handlers {
		c.resourceIndex[h.Resource] = append(c.resourceIndex[h.Resource], pluginID)
	}
	c.mux.Unlock()

	return nil
}

func (c *controller) OnPluginStop(pluginID string, _ config.PluginMeta) error {
	c.logger.With(logging.Any("pluginID", pluginID)).Debugw(context.Background(), "OnPluginStop")
	c.removePlugin(pluginID)
	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, _ config.PluginMeta) error {
	c.logger.With(logging.Any("pluginID", pluginID)).Debugw(context.Background(), "OnPluginShutdown")
	c.removePlugin(pluginID)
	return nil
}

func (c *controller) OnPluginDestroy(pluginID string, _ config.PluginMeta) error {
	c.logger.With(logging.Any("pluginID", pluginID)).Debugw(context.Background(), "OnPluginDestroy")
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
	c.mux.RLock()
	defer c.mux.RUnlock()
	plugins := make([]string, 0, len(c.clients))
	for k := range c.clients {
		plugins = append(plugins, k)
	}
	return plugins, nil
}

func (c *controller) HasPlugin(pluginID string) bool {
	c.mux.RLock()
	defer c.mux.RUnlock()
	_, ok := c.clients[pluginID]
	return ok
}

// ================================ Internal Helpers ================================ //

func (c *controller) removePlugin(pluginID string) {
	c.mux.Lock()
	var retired []*metricStream
	for key, state := range c.streams {
		if key.plugin == pluginID {
			retired = append(retired, state)
			delete(c.streams, key)
		}
	}
	for key := range c.streamErrors {
		if key.plugin == pluginID {
			delete(c.streamErrors, key)
		}
	}

	delete(c.clients, pluginID)
	delete(c.providerInfos, pluginID)
	delete(c.handlerMap, pluginID)

	// Clean resource index
	for key, pluginIDs := range c.resourceIndex {
		filtered := make([]string, 0)
		for _, id := range pluginIDs {
			if id != pluginID {
				filtered = append(filtered, id)
			}
		}
		if len(filtered) == 0 {
			delete(c.resourceIndex, key)
		} else {
			c.resourceIndex[key] = filtered
		}
	}

	c.mux.Unlock()
	for _, state := range retired {
		c.endStream(state, closedStreamError())
	}
}

func (c *controller) handleStreamOutput(output metric.StreamOutput) {
	data, err := json.Marshal(output)
	if err != nil {
		c.logger.Errorw(context.Background(), "failed to marshal metric stream output", "error", err)
		return
	}

	if output.Error != "" || output.OperationError != nil {
		eventKey := "core/metrics/error/" + output.SubscriptionID
		c.emitter.Emit(eventKey, string(data))
	} else {
		eventKey := "core/metrics/data/" + output.SubscriptionID
		c.emitter.Emit(eventKey, string(data))
	}
}

func (c *controller) getConnectedCtx(
	ctx context.Context,
	pluginID string,
	connectionID string,
) *sdktypes.PluginContext {
	connection, err := c.resourceClient.GetConnection(invocation.HostContext(ctx), pluginID, connectionID)
	if err != nil {
		c.logger.Errorw(ctx, "error getting connection", "error", err)
		return nil
	}

	return sdktypes.NewPluginContextWithConnection(
		ctx,
		"metric",
		nil,
		nil,
		&connection,
	)
}

func (c *controller) getUnconnectedCtx(ctx context.Context) *sdktypes.PluginContext {
	return sdktypes.NewPluginContext(
		ctx,
		"metric",
		nil,
		nil,
		nil,
	)
}

// ================================ Discovery ================================ //

func (c *controller) GetProviders() []MetricProviderSummary {
	c.mux.RLock()
	defer c.mux.RUnlock()

	result := make([]MetricProviderSummary, 0)
	for pluginID, info := range c.providerInfos {
		result = append(result, MetricProviderSummary{
			PluginID:    pluginID,
			ProviderID:  info.ID,
			Name:        info.Name,
			Icon:        info.Icon,
			Description: info.Description,
			Handlers:    c.handlerMap[pluginID],
		})
	}
	return result
}

func (c *controller) GetProvidersForResource(resourceKey string) []MetricProviderSummary {
	c.mux.RLock()
	defer c.mux.RUnlock()

	pluginIDs, ok := c.resourceIndex[resourceKey]
	if !ok {
		return nil
	}

	result := make([]MetricProviderSummary, 0, len(pluginIDs))
	for _, pluginID := range pluginIDs {
		info := c.providerInfos[pluginID]
		if info == nil {
			continue
		}
		result = append(result, MetricProviderSummary{
			PluginID:    pluginID,
			ProviderID:  info.ID,
			Name:        info.Name,
			Icon:        info.Icon,
			Description: info.Description,
			Handlers:    c.handlerMap[pluginID],
		})
	}
	return result
}

// ================================ Querying ================================ //

func (c *controller) Query(
	pluginID, connectionID string,
	req metric.QueryRequest,
) (*metric.QueryResponse, error) {
	ctx, span := tracer.Start(context.Background(), "metric.Query")
	defer span.End()
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
		attribute.String("resource_key", req.ResourceKey),
	)
	if req.Reference != nil {
		if c.referenceAdmitter == nil {
			return nil, resourcev2.NewError("UNSUPPORTED", "Resource reference admission is unavailable.")
		}
		if req.Route == nil || req.Route.Connection != connectionID {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Resource route does not match the selected connection.")
		}
		admitted, err := c.referenceAdmitter(ctx, "metric.Query", pluginID, *req.Route, *req.Reference)
		if err != nil {
			return nil, err
		}
		ctx = admitted
	}

	c.mux.RLock()
	client, ok := c.clients[pluginID]
	c.mux.RUnlock()
	if !ok {
		err := apperror.PluginNotFound(pluginID)
		telemetryutil.RecordError(span, err)
		return nil, err
	}

	resp, err := client.Query(
		c.getConnectedCtx(ctx, pluginID, connectionID),
		req,
	)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return resp, nil
}

func (c *controller) QueryAll(
	connectionID string, req metric.QueryRequest,
) (map[string]*metric.QueryResponse, error) {
	ctx, span := tracer.Start(context.Background(), "metric.QueryAll")
	defer span.End()
	span.SetAttributes(
		attribute.String("connection_id", connectionID),
		attribute.String("resource_key", req.ResourceKey),
		attribute.String("resource_id", req.ResourceID),
		attribute.String("namespace", req.ResourceNamespace),
	)

	c.mux.RLock()
	pluginIDs, ok := c.resourceIndex[req.ResourceKey]
	c.mux.RUnlock()

	if !ok || len(pluginIDs) == 0 {
		return nil, nil
	}

	results := make(map[string]*metric.QueryResponse)
	var mu sync.Mutex
	var wg sync.WaitGroup
	var referenceErr error

	for _, pluginID := range pluginIDs {
		wg.Add(1)
		go func(pid string) {
			defer wg.Done()
			resp, err := c.Query(pid, connectionID, req)
			if err != nil {
				if req.Reference != nil {
					mu.Lock()
					if referenceErr == nil {
						referenceErr = err
					}
					mu.Unlock()
				}
				c.logger.Warnw(ctx, "error querying metric provider", "pluginID", pid, "error", err)
				return
			}
			mu.Lock()
			results[pid] = resp
			mu.Unlock()
		}(pluginID)
	}

	wg.Wait()
	// A denied or failed reference-bearing operation is not successful partial
	// metric availability. Preserve ordinary nonresource aggregation behavior.
	if referenceErr != nil {
		return nil, referenceErr
	}
	return results, nil
}

// ================================ Streaming ================================ //

func (c *controller) Subscribe(pluginID, connectionID string, req SubscribeRequest) (string, error) {
	ctx, span := tracer.Start(context.Background(), "metric.Subscribe")
	defer span.End()
	subscriptionID := uuid.NewString()
	wireID := uuid.NewString()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID),
		attribute.String("resource_key", req.ResourceKey), attribute.String("resource_id", req.ResourceID),
		attribute.String("subscription_id", subscriptionID))
	input := metric.StreamInput{
		SubscriptionID: wireID, Command: metric.StreamCommandSubscribe,
		ResourceKey: req.ResourceKey, ResourceID: req.ResourceID, ResourceNamespace: req.ResourceNamespace,
		ResourceData: req.ResourceData, Reference: req.Reference, Route: req.Route,
		MetricIDs: req.MetricIDs, Interval: req.Interval, Params: req.Params,
	}
	if req.Reference != nil {
		if c.referenceAdmitter == nil {
			return "", apperror.ForResource(resourcev2.NewError("UNSUPPORTED", "Resource reference admission is unavailable."), subscriptionID)
		}
		if req.Route == nil || req.Route.Connection != connectionID {
			return "", apperror.ForResource(resourcev2.NewError("INVALID_REQUEST", "Resource route does not match the selected connection."), subscriptionID)
		}
		admitted, err := c.referenceAdmitter(ctx, "metric.Subscribe", pluginID, *req.Route, *req.Reference)
		if err != nil {
			return "", err
		}
		revision, ok := resourcev2.CatalogRevisionFromContext(admitted)
		if !ok || revision == "" {
			return "", apperror.ForResource(resourcev2.NewError("UNSUPPORTED", "Resource catalog admission is unavailable."), subscriptionID)
		}
		input.CatalogRevision = revision
	}
	// Admit the complete canonical frame before it can affect the shared lane.
	if err := metric.ValidateStreamInput(input); err != nil {
		return "", apperror.ForResource(err, subscriptionID)
	}
	if req.Route != nil && req.Route.Connection != connectionID {
		return "", apperror.ForResource(resourcev2.NewError("INVALID_REQUEST", "Metric route does not match the selected connection."), subscriptionID)
	}
	state, err := c.ensureStream(pluginID, connectionID)
	if err != nil {
		var missing *apperror.AppError
		if errors.As(err, &missing) && missing != nil && missing.Type == apperror.TypePluginNotFound {
			classified := *missing
			classified.RequestID = subscriptionID
			return "", &classified
		}
		return "", apperror.ForResource(err, subscriptionID)
	}
	c.mux.Lock()
	if c.streams[state.key] != state || c.streamBlocked[state.key] > 0 {
		c.mux.Unlock()
		return "", apperror.ForResource(profileChangingError(), subscriptionID)
	}
	c.subscriptions[subscriptionID] = subscriptionIndex{stream: state, wireID: wireID}
	state.wireSubscriptions[wireID] = subscriptionID
	c.mux.Unlock()
	select {
	case state.input <- input:
		select {
		case <-state.done:
			c.forgetInterest(subscriptionID, wireID, state)
			return "", apperror.ForResource(closedStreamError(), subscriptionID)
		default:
			return subscriptionID, nil
		}
	case <-state.done:
		c.forgetInterest(subscriptionID, wireID, state)
		return "", apperror.ForResource(closedStreamError(), subscriptionID)
	}
}

func (c *controller) Unsubscribe(subscriptionID string) error {
	c.mux.Lock()
	sub, ok := c.subscriptions[subscriptionID]
	if ok {
		delete(c.subscriptions, subscriptionID)
		delete(sub.stream.wireSubscriptions, sub.wireID)
	}
	c.mux.Unlock()
	if !ok {
		missing := apperror.SessionNotFound(subscriptionID)
		missing.RequestID = uuid.NewString()
		return missing
	}
	// No blocking send holds the controller lock and no input channel is closed
	// beneath senders. Retirement always releases this wait.
	select {
	case <-sub.stream.done:
		return apperror.ForResource(closedStreamError(), uuid.NewString())
	default:
	}
	select {
	case sub.stream.input <- metric.StreamInput{SubscriptionID: sub.wireID, Command: metric.StreamCommandUnsubscribe}:
		return nil
	case <-sub.stream.done:
		return apperror.ForResource(closedStreamError(), uuid.NewString())
	}
}
