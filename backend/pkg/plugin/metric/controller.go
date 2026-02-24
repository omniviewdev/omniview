package metric

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hashicorp/go-plugin"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/metric"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/settings"
)

// MetricProviderSummary is a lightweight summary of a metric provider,
// exposed to the frontend.
type MetricProviderSummary struct {
	PluginID    string              `json:"plugin_id"`
	ProviderID  string              `json:"provider_id"`
	Name        string              `json:"name"`
	Icon        string              `json:"icon"`
	Description string              `json:"description"`
	Handlers    []metric.Handler    `json:"handlers"`
}

// Controller manages metric providers across all plugins.
type Controller interface {
	internaltypes.Controller
	Run(ctx context.Context)

	// Discovery
	GetProviders() []MetricProviderSummary
	GetProvidersForResource(resourceKey string) []MetricProviderSummary

	// Querying
	Query(pluginID, connectionID string, req metric.QueryRequest) (*metric.QueryResponse, error)
	QueryAll(connectionID, resourceKey, resourceID, namespace string,
		resourceData map[string]interface{}, metricIDs []string,
		shape metric.MetricShape, startTime, endTime time.Time, step time.Duration,
	) (map[string]*metric.QueryResponse, error)

	// Streaming
	Subscribe(pluginID, connectionID string, req SubscribeRequest) (string, error)
	Unsubscribe(subscriptionID string) error
}

// SubscribeRequest contains parameters for subscribing to a metric stream.
type SubscribeRequest struct {
	ResourceKey       string                 `json:"resource_key"`
	ResourceID        string                 `json:"resource_id"`
	ResourceNamespace string                 `json:"resource_namespace"`
	ResourceData      map[string]interface{} `json:"resource_data"`
	MetricIDs         []string               `json:"metric_ids"`
	Interval          time.Duration          `json:"interval"`
}

type subscriptionIndex struct {
	pluginID       string
	connectionID   string
	subscriptionID string
}

var _ Controller = (*controller)(nil)

type controller struct {
	ctx              context.Context
	logger           *zap.SugaredLogger
	settingsProvider pkgsettings.Provider
	clients          map[string]metric.Provider
	providerInfos    map[string]*metric.ProviderInfo // pluginID -> provider info
	handlerMap       map[string][]metric.Handler     // pluginID -> handlers
	resourceIndex    map[string][]string             // resource key -> []pluginID
	subscriptions    map[string]subscriptionIndex    // subscriptionID -> index
	inChans          map[string]chan metric.StreamInput
	resourceClient   resource.IClient
	mux              sync.RWMutex
}

func NewController(
	logger *zap.SugaredLogger,
	sp pkgsettings.Provider,
	resourceClient resource.IClient,
) Controller {
	return &controller{
		logger:           logger.Named("MetricController"),
		settingsProvider: sp,
		clients:          make(map[string]metric.Provider),
		providerInfos:    make(map[string]*metric.ProviderInfo),
		handlerMap:       make(map[string][]metric.Handler),
		resourceIndex:    make(map[string][]string),
		subscriptions:    make(map[string]subscriptionIndex),
		inChans:          make(map[string]chan metric.StreamInput),
		resourceClient:   resourceClient,
	}
}

func (c *controller) Run(ctx context.Context) {
	c.ctx = ctx
}

// ================================ Controller Lifecycle ================================ //

func (c *controller) OnPluginInit(meta config.PluginMeta) {
	c.logger.With("pluginID", meta.ID).Debug("OnPluginInit")
}

func (c *controller) OnPluginStart(meta config.PluginMeta, client plugin.ClientProtocol) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginStart")

	raw, err := client.Dispense("metric")
	if err != nil {
		return err
	}

	provider, ok := raw.(metric.Provider)
	if !ok {
		typeof := reflect.TypeOf(raw).String()
		err = fmt.Errorf("could not start metric plugin: expected metric.Provider, got %s", typeof)
		logger.Error(err)
		return err
	}

	c.clients[meta.ID] = provider

	// Get supported resources
	info, handlers := provider.GetSupportedResources(c.getUnconnectedCtx(context.Background()))

	c.mux.Lock()
	c.providerInfos[meta.ID] = info
	c.handlerMap[meta.ID] = handlers
	for _, h := range handlers {
		c.resourceIndex[h.Resource] = append(c.resourceIndex[h.Resource], meta.ID)
	}
	c.mux.Unlock()

	// Start the stream for this plugin
	inchan := make(chan metric.StreamInput)
	c.inChans[meta.ID] = inchan

	go func() {
		stream, err := provider.StreamMetrics(c.ctx, inchan)
		if err != nil {
			logger.Errorw("error starting metric stream", "error", err)
			return
		}

		for {
			select {
			case <-c.ctx.Done():
				return
			case output := <-stream:
				c.handleStreamOutput(output)
			}
		}
	}()

	return nil
}

func (c *controller) OnPluginStop(meta config.PluginMeta) error {
	c.logger.With("pluginID", meta.ID).Debug("OnPluginStop")
	c.removePlugin(meta.ID)
	return nil
}

func (c *controller) OnPluginShutdown(meta config.PluginMeta) error {
	c.logger.With("pluginID", meta.ID).Debug("OnPluginShutdown")
	c.removePlugin(meta.ID)
	return nil
}

func (c *controller) OnPluginDestroy(meta config.PluginMeta) error {
	c.logger.With("pluginID", meta.ID).Debug("OnPluginDestroy")
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
	plugins := make([]string, 0, len(c.clients))
	for k := range c.clients {
		plugins = append(plugins, k)
	}
	return plugins, nil
}

func (c *controller) HasPlugin(pluginID string) bool {
	_, ok := c.clients[pluginID]
	return ok
}

// ================================ Internal Helpers ================================ //

func (c *controller) removePlugin(pluginID string) {
	c.mux.Lock()
	defer c.mux.Unlock()

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

	if ch, ok := c.inChans[pluginID]; ok {
		close(ch)
		delete(c.inChans, pluginID)
	}
}

func (c *controller) handleStreamOutput(output metric.StreamOutput) {
	data, err := json.Marshal(output)
	if err != nil {
		c.logger.Errorw("failed to marshal metric stream output", "error", err)
		return
	}

	if output.Error != "" {
		eventKey := "core/metrics/error/" + output.SubscriptionID
		runtime.EventsEmit(c.ctx, eventKey, string(data))
	} else {
		eventKey := "core/metrics/data/" + output.SubscriptionID
		runtime.EventsEmit(c.ctx, eventKey, string(data))
	}
}

func (c *controller) getConnectedCtx(
	ctx context.Context,
	pluginID string,
	connectionID string,
) *sdktypes.PluginContext {
	connection, err := c.resourceClient.GetConnection(pluginID, connectionID)
	if err != nil {
		c.logger.Errorw("error getting connection", "error", err)
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
	client, ok := c.clients[pluginID]
	if !ok {
		return nil, fmt.Errorf("metric plugin %s not found", pluginID)
	}

	return client.Query(
		c.getConnectedCtx(context.Background(), pluginID, connectionID),
		req,
	)
}

func (c *controller) QueryAll(
	connectionID, resourceKey, resourceID, namespace string,
	resourceData map[string]interface{},
	metricIDs []string,
	shape metric.MetricShape,
	startTime, endTime time.Time,
	step time.Duration,
) (map[string]*metric.QueryResponse, error) {
	c.mux.RLock()
	pluginIDs, ok := c.resourceIndex[resourceKey]
	c.mux.RUnlock()

	if !ok || len(pluginIDs) == 0 {
		return nil, nil
	}

	req := metric.QueryRequest{
		ResourceKey:       resourceKey,
		ResourceID:        resourceID,
		ResourceNamespace: namespace,
		ResourceData:      resourceData,
		MetricIDs:         metricIDs,
		Shape:             shape,
		StartTime:         startTime,
		EndTime:           endTime,
		Step:              step,
	}

	results := make(map[string]*metric.QueryResponse)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, pluginID := range pluginIDs {
		wg.Add(1)
		go func(pid string) {
			defer wg.Done()
			resp, err := c.Query(pid, connectionID, req)
			if err != nil {
				c.logger.Warnw("error querying metric provider", "pluginID", pid, "error", err)
				return
			}
			mu.Lock()
			results[pid] = resp
			mu.Unlock()
		}(pluginID)
	}

	wg.Wait()
	return results, nil
}

// ================================ Streaming ================================ //

func (c *controller) Subscribe(
	pluginID, connectionID string,
	req SubscribeRequest,
) (string, error) {
	inchan, ok := c.inChans[pluginID]
	if !ok {
		return "", fmt.Errorf("metric plugin %s not found", pluginID)
	}

	subscriptionID := uuid.NewString()

	c.mux.Lock()
	c.subscriptions[subscriptionID] = subscriptionIndex{
		pluginID:       pluginID,
		connectionID:   connectionID,
		subscriptionID: subscriptionID,
	}
	c.mux.Unlock()

	inchan <- metric.StreamInput{
		SubscriptionID:    subscriptionID,
		Command:           metric.StreamCommandSubscribe,
		ResourceKey:       req.ResourceKey,
		ResourceID:        req.ResourceID,
		ResourceNamespace: req.ResourceNamespace,
		ResourceData:      req.ResourceData,
		MetricIDs:         req.MetricIDs,
		Interval:          req.Interval,
	}

	return subscriptionID, nil
}

func (c *controller) Unsubscribe(subscriptionID string) error {
	c.mux.Lock()
	sub, ok := c.subscriptions[subscriptionID]
	if !ok {
		c.mux.Unlock()
		return fmt.Errorf("subscription %s not found", subscriptionID)
	}
	delete(c.subscriptions, subscriptionID)
	c.mux.Unlock()

	inchan, ok := c.inChans[sub.pluginID]
	if !ok {
		return fmt.Errorf("metric plugin %s not found", sub.pluginID)
	}

	inchan <- metric.StreamInput{
		SubscriptionID: subscriptionID,
		Command:        metric.StreamCommandUnsubscribe,
	}
	return nil
}
