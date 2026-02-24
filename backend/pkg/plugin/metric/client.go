package metric

import (
	"time"

	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/metric"
)

// Client is the Wails-bound client exposing metric methods to the frontend.
type Client struct {
	controller Controller
}

func NewClient(controller Controller) *Client {
	return &Client{
		controller: controller,
	}
}

func (c *Client) GetProviders() []MetricProviderSummary {
	return c.controller.GetProviders()
}

func (c *Client) GetProvidersForResource(resourceKey string) []MetricProviderSummary {
	return c.controller.GetProvidersForResource(resourceKey)
}

func (c *Client) Query(
	pluginID, connectionID string,
	req sdkmetric.QueryRequest,
) (*sdkmetric.QueryResponse, error) {
	return c.controller.Query(pluginID, connectionID, req)
}

func (c *Client) QueryAll(
	connectionID, resourceKey, resourceID, namespace string,
	resourceData map[string]interface{},
	metricIDs []string,
	shape sdkmetric.MetricShape,
	startTime, endTime time.Time,
	step time.Duration,
) (map[string]*sdkmetric.QueryResponse, error) {
	return c.controller.QueryAll(
		connectionID, resourceKey, resourceID, namespace,
		resourceData, metricIDs, shape, startTime, endTime, step,
	)
}

func (c *Client) Subscribe(
	pluginID, connectionID string,
	req SubscribeRequest,
) (string, error) {
	return c.controller.Subscribe(pluginID, connectionID, req)
}

func (c *Client) Unsubscribe(subscriptionID string) error {
	return c.controller.Unsubscribe(subscriptionID)
}
