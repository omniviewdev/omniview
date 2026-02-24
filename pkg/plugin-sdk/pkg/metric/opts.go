package metric

import (
	"time"

	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/omniviewdev/plugin-sdk/proto"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// PluginOpts contains the options for the metric plugin.
type PluginOpts struct {
	// ProviderInfo describes this metric provider.
	ProviderInfo ProviderInfo `json:"provider_info"`

	// Handlers maps resource keys to their metric handlers.
	// For example: "core::v1::Pod" -> Handler
	Handlers map[string]Handler `json:"handlers"`

	// QueryFunc is the function that queries metrics from the provider.
	QueryFunc QueryFunc `json:"-"`

	// StreamFunc is the optional function that streams metrics. If nil,
	// the SDK will poll QueryFunc at the requested interval.
	StreamFunc StreamFunc `json:"-"`
}

// QueryFunc queries metrics for a resource.
type QueryFunc func(ctx *QueryContext, req QueryRequest) (*QueryResponse, error)

// StreamFunc streams metrics for subscriptions. If nil, the SDK polls QueryFunc.
type StreamFunc func(ctx *StreamContext, in chan StreamInput) (chan StreamOutput, error)

// ===================== Provider Types ===================== //

// ProviderInfo describes a metric provider.
type ProviderInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
}

func (p *ProviderInfo) ToProto() *proto.MetricProviderInfo {
	return &proto.MetricProviderInfo{
		Id:          p.ID,
		Name:        p.Name,
		Icon:        p.Icon,
		Description: p.Description,
	}
}

func ProviderInfoFromProto(p *proto.MetricProviderInfo) ProviderInfo {
	if p == nil {
		return ProviderInfo{}
	}
	return ProviderInfo{
		ID:          p.GetId(),
		Name:        p.GetName(),
		Icon:        p.GetIcon(),
		Description: p.GetDescription(),
	}
}

// ===================== Enums ===================== //

// MetricUnit represents the unit of a metric value.
type MetricUnit int

const (
	UnitNone        MetricUnit = 0
	UnitBytes       MetricUnit = 1
	UnitKB          MetricUnit = 2
	UnitMB          MetricUnit = 3
	UnitGB          MetricUnit = 4
	UnitPercentage  MetricUnit = 5
	UnitMillis      MetricUnit = 6
	UnitSeconds     MetricUnit = 7
	UnitCount       MetricUnit = 8
	UnitOpsPerSec   MetricUnit = 9
	UnitBytesPerSec MetricUnit = 10
	UnitMillicores  MetricUnit = 11
	UnitCores       MetricUnit = 12
)

func (u MetricUnit) ToProto() proto.MetricUnit {
	return proto.MetricUnit(u)
}

func MetricUnitFromProto(p proto.MetricUnit) MetricUnit {
	return MetricUnit(p)
}

// MetricShape indicates the type of metric data.
type MetricShape int

const (
	ShapeCurrent    MetricShape = 0
	ShapeTimeseries MetricShape = 1
	ShapeAggregate  MetricShape = 2
)

func (s MetricShape) ToProto() proto.MetricShape {
	return proto.MetricShape(s)
}

func MetricShapeFromProto(p proto.MetricShape) MetricShape {
	return MetricShape(p)
}

// MetricStreamCommand represents a command for the metric stream.
type MetricStreamCommand int

const (
	StreamCommandSubscribe   MetricStreamCommand = 0
	StreamCommandUnsubscribe MetricStreamCommand = 1
	StreamCommandClose       MetricStreamCommand = 2
)

func (c MetricStreamCommand) ToProto() proto.MetricStreamCommand {
	return proto.MetricStreamCommand(c)
}

func MetricStreamCommandFromProto(p proto.MetricStreamCommand) MetricStreamCommand {
	return MetricStreamCommand(p)
}

// ===================== Descriptor Types ===================== //

// ColorRange defines a color to use for a range of metric values.
type ColorRange struct {
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
	Color string  `json:"color"`
}

func (c *ColorRange) ToProto() *proto.MetricColorRange {
	return &proto.MetricColorRange{
		Min:   c.Min,
		Max:   c.Max,
		Color: c.Color,
	}
}

func ColorRangeFromProto(p *proto.MetricColorRange) ColorRange {
	return ColorRange{
		Min:   p.GetMin(),
		Max:   p.GetMax(),
		Color: p.GetColor(),
	}
}

// MetricDescriptor describes a single metric.
type MetricDescriptor struct {
	ID              string        `json:"id"`
	Name            string        `json:"name"`
	Unit            MetricUnit    `json:"unit"`
	Icon            string        `json:"icon"`
	ColorRanges     []ColorRange  `json:"color_ranges"`
	FormatString    string        `json:"format_string"`
	SupportedShapes []MetricShape `json:"supported_shapes"`
	ChartGroup      string        `json:"chart_group"`
}

func (d *MetricDescriptor) ToProto() *proto.MetricDescriptor {
	colorRanges := make([]*proto.MetricColorRange, 0, len(d.ColorRanges))
	for i := range d.ColorRanges {
		colorRanges = append(colorRanges, d.ColorRanges[i].ToProto())
	}
	shapes := make([]proto.MetricShape, 0, len(d.SupportedShapes))
	for _, s := range d.SupportedShapes {
		shapes = append(shapes, s.ToProto())
	}
	return &proto.MetricDescriptor{
		Id:              d.ID,
		Name:            d.Name,
		Unit:            d.Unit.ToProto(),
		Icon:            d.Icon,
		ColorRanges:     colorRanges,
		FormatString:    d.FormatString,
		SupportedShapes: shapes,
		ChartGroup:      d.ChartGroup,
	}
}

func MetricDescriptorFromProto(p *proto.MetricDescriptor) MetricDescriptor {
	colorRanges := make([]ColorRange, 0, len(p.GetColorRanges()))
	for _, cr := range p.GetColorRanges() {
		colorRanges = append(colorRanges, ColorRangeFromProto(cr))
	}
	shapes := make([]MetricShape, 0, len(p.GetSupportedShapes()))
	for _, s := range p.GetSupportedShapes() {
		shapes = append(shapes, MetricShapeFromProto(s))
	}
	return MetricDescriptor{
		ID:              p.GetId(),
		Name:            p.GetName(),
		Unit:            MetricUnitFromProto(p.GetUnit()),
		Icon:            p.GetIcon(),
		ColorRanges:     colorRanges,
		FormatString:    p.GetFormatString(),
		SupportedShapes: shapes,
		ChartGroup:      p.GetChartGroup(),
	}
}

// Handler maps a resource key to its available metrics.
type Handler struct {
	Resource string             `json:"resource"`
	Metrics  []MetricDescriptor `json:"metrics"`
}

func (h *Handler) ToProto() *proto.MetricHandler {
	metrics := make([]*proto.MetricDescriptor, 0, len(h.Metrics))
	for i := range h.Metrics {
		metrics = append(metrics, h.Metrics[i].ToProto())
	}
	return &proto.MetricHandler{
		Resource: h.Resource,
		Metrics:  metrics,
	}
}

func HandlerFromProto(p *proto.MetricHandler) Handler {
	metrics := make([]MetricDescriptor, 0, len(p.GetMetrics()))
	for _, m := range p.GetMetrics() {
		metrics = append(metrics, MetricDescriptorFromProto(m))
	}
	return Handler{
		Resource: p.GetResource(),
		Metrics:  metrics,
	}
}

// ===================== Data Types ===================== //

// DataPoint represents a single data point in a time series.
type DataPoint struct {
	Timestamp time.Time         `json:"timestamp"`
	Value     float64           `json:"value"`
	Labels    map[string]string `json:"labels"`
}

func (d *DataPoint) ToProto() *proto.DataPoint {
	return &proto.DataPoint{
		Timestamp: timestamppb.New(d.Timestamp),
		Value:     d.Value,
		Labels:    d.Labels,
	}
}

func DataPointFromProto(p *proto.DataPoint) DataPoint {
	var ts time.Time
	if p.GetTimestamp() != nil {
		ts = p.GetTimestamp().AsTime()
	}
	return DataPoint{
		Timestamp: ts,
		Value:     p.GetValue(),
		Labels:    p.GetLabels(),
	}
}

// TimeSeries represents a series of data points for a metric.
type TimeSeries struct {
	MetricID   string            `json:"metric_id"`
	DataPoints []DataPoint       `json:"data_points"`
	Labels     map[string]string `json:"labels"`
}

func (t *TimeSeries) ToProto() *proto.TimeSeries {
	points := make([]*proto.DataPoint, 0, len(t.DataPoints))
	for i := range t.DataPoints {
		points = append(points, t.DataPoints[i].ToProto())
	}
	return &proto.TimeSeries{
		MetricId:   t.MetricID,
		DataPoints: points,
		Labels:     t.Labels,
	}
}

func TimeSeriesFromProto(p *proto.TimeSeries) TimeSeries {
	points := make([]DataPoint, 0, len(p.GetDataPoints()))
	for _, dp := range p.GetDataPoints() {
		points = append(points, DataPointFromProto(dp))
	}
	return TimeSeries{
		MetricID:   p.GetMetricId(),
		DataPoints: points,
		Labels:     p.GetLabels(),
	}
}

// CurrentValue represents the current value of a metric.
type CurrentValue struct {
	MetricID  string            `json:"metric_id"`
	Value     float64           `json:"value"`
	Timestamp time.Time         `json:"timestamp"`
	Labels    map[string]string `json:"labels"`
}

func (c *CurrentValue) ToProto() *proto.CurrentValue {
	return &proto.CurrentValue{
		MetricId:  c.MetricID,
		Value:     c.Value,
		Timestamp: timestamppb.New(c.Timestamp),
		Labels:    c.Labels,
	}
}

func CurrentValueFromProto(p *proto.CurrentValue) CurrentValue {
	var ts time.Time
	if p.GetTimestamp() != nil {
		ts = p.GetTimestamp().AsTime()
	}
	return CurrentValue{
		MetricID:  p.GetMetricId(),
		Value:     p.GetValue(),
		Timestamp: ts,
		Labels:    p.GetLabels(),
	}
}

// AggregateValue represents aggregated metric data over a window.
type AggregateValue struct {
	MetricID string            `json:"metric_id"`
	Min      float64           `json:"min"`
	Max      float64           `json:"max"`
	Avg      float64           `json:"avg"`
	Sum      float64           `json:"sum"`
	P50      float64           `json:"p50"`
	P90      float64           `json:"p90"`
	P99      float64           `json:"p99"`
	Count    int64             `json:"count"`
	Window   time.Duration     `json:"window"`
	Labels   map[string]string `json:"labels"`
}

func (a *AggregateValue) ToProto() *proto.AggregateValue {
	return &proto.AggregateValue{
		MetricId: a.MetricID,
		Min:      a.Min,
		Max:      a.Max,
		Avg:      a.Avg,
		Sum:      a.Sum,
		P50:      a.P50,
		P90:      a.P90,
		P99:      a.P99,
		Count:    a.Count,
		Window:   durationpb.New(a.Window),
		Labels:   a.Labels,
	}
}

func AggregateValueFromProto(p *proto.AggregateValue) AggregateValue {
	var window time.Duration
	if p.GetWindow() != nil {
		window = p.GetWindow().AsDuration()
	}
	return AggregateValue{
		MetricID: p.GetMetricId(),
		Min:      p.GetMin(),
		Max:      p.GetMax(),
		Avg:      p.GetAvg(),
		Sum:      p.GetSum(),
		P50:      p.GetP50(),
		P90:      p.GetP90(),
		P99:      p.GetP99(),
		Count:    p.GetCount(),
		Window:   window,
		Labels:   p.GetLabels(),
	}
}

// MetricResult wraps one of the possible metric result types.
type MetricResult struct {
	TimeSeries     *TimeSeries     `json:"time_series,omitempty"`
	CurrentValue   *CurrentValue   `json:"current_value,omitempty"`
	AggregateValue *AggregateValue `json:"aggregate_value,omitempty"`
}

func (r *MetricResult) ToProto() *proto.MetricResult {
	result := &proto.MetricResult{}
	if r.TimeSeries != nil {
		result.Result = &proto.MetricResult_TimeSeries{TimeSeries: r.TimeSeries.ToProto()}
	} else if r.CurrentValue != nil {
		result.Result = &proto.MetricResult_CurrentValue{CurrentValue: r.CurrentValue.ToProto()}
	} else if r.AggregateValue != nil {
		result.Result = &proto.MetricResult_AggregateValue{AggregateValue: r.AggregateValue.ToProto()}
	}
	return result
}

func MetricResultFromProto(p *proto.MetricResult) MetricResult {
	r := MetricResult{}
	switch v := p.GetResult().(type) {
	case *proto.MetricResult_TimeSeries:
		ts := TimeSeriesFromProto(v.TimeSeries)
		r.TimeSeries = &ts
	case *proto.MetricResult_CurrentValue:
		cv := CurrentValueFromProto(v.CurrentValue)
		r.CurrentValue = &cv
	case *proto.MetricResult_AggregateValue:
		av := AggregateValueFromProto(v.AggregateValue)
		r.AggregateValue = &av
	}
	return r
}

// ===================== Request/Response Types ===================== //

// QueryRequest is the Go-side representation of a metric query.
type QueryRequest struct {
	ResourceKey       string                 `json:"resource_key"`
	ResourceID        string                 `json:"resource_id"`
	ResourceNamespace string                 `json:"resource_namespace"`
	ResourceData      map[string]interface{} `json:"resource_data"`
	MetricIDs         []string               `json:"metric_ids"`
	Shape             MetricShape            `json:"shape"`
	StartTime         time.Time              `json:"start_time"`
	EndTime           time.Time              `json:"end_time"`
	Step              time.Duration          `json:"step"`
	Params            map[string]string      `json:"params"`
}

// QueryResponse is the Go-side representation of a metric query response.
type QueryResponse struct {
	Success bool           `json:"success"`
	Results []MetricResult `json:"results"`
	Error   string         `json:"error"`
}

func QueryResponseFromProto(p *proto.QueryMetricsResponse) *QueryResponse {
	results := make([]MetricResult, 0, len(p.GetResults()))
	for _, r := range p.GetResults() {
		results = append(results, MetricResultFromProto(r))
	}
	return &QueryResponse{
		Success: p.GetSuccess(),
		Results: results,
		Error:   p.GetError(),
	}
}

func (r *QueryResponse) ToProto() *proto.QueryMetricsResponse {
	results := make([]*proto.MetricResult, 0, len(r.Results))
	for i := range r.Results {
		results = append(results, r.Results[i].ToProto())
	}
	return &proto.QueryMetricsResponse{
		Success: r.Success,
		Results: results,
		Error:   r.Error,
	}
}

// ===================== Stream Types ===================== //

// StreamInput is a control message for the metric stream.
type StreamInput struct {
	SubscriptionID    string                 `json:"subscription_id"`
	Command           MetricStreamCommand    `json:"command"`
	ResourceKey       string                 `json:"resource_key"`
	ResourceID        string                 `json:"resource_id"`
	ResourceNamespace string                 `json:"resource_namespace"`
	ResourceData      map[string]interface{} `json:"resource_data"`
	MetricIDs         []string               `json:"metric_ids"`
	Interval          time.Duration          `json:"interval"`
}

// StreamOutput is a metric data push from the stream.
type StreamOutput struct {
	SubscriptionID string         `json:"subscription_id"`
	Results        []MetricResult `json:"results"`
	Timestamp      time.Time      `json:"timestamp"`
	Error          string         `json:"error"`
}

// ===================== Context Types ===================== //

// QueryContext provides context for metric queries. Wraps the plugin context
// plus connection information passed via gRPC metadata.
type QueryContext struct {
	PluginID     string
	ConnectionID string
	Connection   *types.Connection
}

// StreamContext provides context for metric streams.
type StreamContext struct {
	PluginID string
}
