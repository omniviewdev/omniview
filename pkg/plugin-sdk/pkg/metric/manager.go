package metric

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hashicorp/go-hclog"
	"github.com/omniviewdev/settings"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Manager manages metric queries and streams within a plugin process.
type Manager struct {
	log              hclog.Logger
	settingsProvider settings.Provider
	providerInfo     ProviderInfo
	handlers         map[string]Handler
	queryFunc        QueryFunc
	streamFunc       StreamFunc
	out              chan StreamOutput
	subscriptions    map[string]*managedSubscription
	mux              sync.Mutex
}

type managedSubscription struct {
	id             string
	resourceKey    string
	resourceID     string
	resourceNS     string
	resourceData   map[string]interface{}
	metricIDs      []string
	interval       time.Duration
	ctx            context.Context
	cancel         context.CancelFunc
}

var _ Provider = (*Manager)(nil)

func NewManager(
	log hclog.Logger,
	sp settings.Provider,
	providerInfo ProviderInfo,
	handlers map[string]Handler,
	queryFunc QueryFunc,
	streamFunc StreamFunc,
) *Manager {
	return &Manager{
		log:              log.Named("MetricManager"),
		settingsProvider: sp,
		providerInfo:     providerInfo,
		handlers:         handlers,
		queryFunc:        queryFunc,
		streamFunc:       streamFunc,
		out:              make(chan StreamOutput, 256),
		subscriptions:    make(map[string]*managedSubscription),
	}
}

func (m *Manager) GetSupportedResources(_ *types.PluginContext) (*ProviderInfo, []Handler) {
	handlers := make([]Handler, 0, len(m.handlers))
	for _, h := range m.handlers {
		handlers = append(handlers, h)
	}
	return &m.providerInfo, handlers
}

func (m *Manager) Query(ctx *types.PluginContext, req QueryRequest) (*QueryResponse, error) {
	if m.queryFunc == nil {
		return &QueryResponse{
			Success: false,
			Error:   "query not supported by this provider",
		}, nil
	}

	qctx := &QueryContext{
		PluginID:     m.providerInfo.ID,
		ConnectionID: "",
	}
	if ctx != nil && ctx.Connection != nil {
		qctx.ConnectionID = ctx.Connection.ID
		qctx.Connection = ctx.Connection
	}

	return m.queryFunc(qctx, req)
}

func (m *Manager) StreamMetrics(ctx context.Context, in chan StreamInput) (chan StreamOutput, error) {
	// If the plugin provides a native stream function, delegate to it
	if m.streamFunc != nil {
		return m.streamFunc(&StreamContext{PluginID: m.providerInfo.ID}, in)
	}

	// Otherwise, implement polling-based streaming using QueryFunc
	go func() {
		for {
			select {
			case <-ctx.Done():
				m.mux.Lock()
				for _, sub := range m.subscriptions {
					sub.cancel()
				}
				m.mux.Unlock()
				return

			case input := <-in:
				m.handleStreamCommand(ctx, input)
			}
		}
	}()

	return m.out, nil
}

func (m *Manager) handleStreamCommand(parentCtx context.Context, input StreamInput) {
	switch input.Command {
	case StreamCommandSubscribe:
		m.subscribe(parentCtx, input)
	case StreamCommandUnsubscribe:
		m.unsubscribe(input.SubscriptionID)
	case StreamCommandClose:
		m.unsubscribe(input.SubscriptionID)
	}
}

func (m *Manager) subscribe(parentCtx context.Context, input StreamInput) {
	subID := input.SubscriptionID
	if subID == "" {
		subID = uuid.NewString()
	}

	interval := input.Interval
	if interval <= 0 {
		interval = 10 * time.Second
	}

	ctx, cancel := context.WithCancel(parentCtx)
	sub := &managedSubscription{
		id:           subID,
		resourceKey:  input.ResourceKey,
		resourceID:   input.ResourceID,
		resourceNS:   input.ResourceNamespace,
		resourceData: input.ResourceData,
		metricIDs:    input.MetricIDs,
		interval:     interval,
		ctx:          ctx,
		cancel:       cancel,
	}

	m.mux.Lock()
	m.subscriptions[subID] = sub
	m.mux.Unlock()

	go m.pollSubscription(sub)
}

func (m *Manager) unsubscribe(subscriptionID string) {
	m.mux.Lock()
	sub, ok := m.subscriptions[subscriptionID]
	if ok {
		sub.cancel()
		delete(m.subscriptions, subscriptionID)
	}
	m.mux.Unlock()
}

func (m *Manager) pollSubscription(sub *managedSubscription) {
	ticker := time.NewTicker(sub.interval)
	defer ticker.Stop()

	// Immediately poll once
	m.pollOnce(sub)

	for {
		select {
		case <-sub.ctx.Done():
			return
		case <-ticker.C:
			m.pollOnce(sub)
		}
	}
}

func (m *Manager) pollOnce(sub *managedSubscription) {
	if m.queryFunc == nil {
		return
	}

	req := QueryRequest{
		ResourceKey:       sub.resourceKey,
		ResourceID:        sub.resourceID,
		ResourceNamespace: sub.resourceNS,
		ResourceData:      sub.resourceData,
		MetricIDs:         sub.metricIDs,
		Shape:             ShapeCurrent,
	}

	qctx := &QueryContext{
		PluginID: m.providerInfo.ID,
	}

	resp, err := m.queryFunc(qctx, req)
	if err != nil {
		m.out <- StreamOutput{
			SubscriptionID: sub.id,
			Timestamp:      time.Now(),
			Error:          err.Error(),
		}
		return
	}

	m.out <- StreamOutput{
		SubscriptionID: sub.id,
		Results:        resp.Results,
		Timestamp:      time.Now(),
	}
}
