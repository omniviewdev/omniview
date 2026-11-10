package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel/attribute"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"golang.org/x/net/http/httpguts"
)

type lokiLogExporter struct {
	endpoint   string
	tenant     string
	authHeader string
	authValue  string
	client     *http.Client
	shutdown   atomic.Bool
}

// NewLokiLogExporter creates an exporter for a complete Loki push URL.
func NewLokiLogExporter(endpoint, tenant, authHeader, authValue string) (sdklog.Exporter, error) {
	if err := ValidateLokiConfig(endpoint, tenant, authHeader, authValue); err != nil {
		return nil, err
	}
	return &lokiLogExporter{endpoint: endpoint, tenant: tenant, authHeader: authHeader, authValue: authValue, client: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

// ValidateLokiConfig validates the destination and headers for a Loki exporter.
func ValidateLokiConfig(endpoint, tenant, authHeader, authValue string) error {
	u, err := url.Parse(endpoint)
	if err != nil || u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Fragment != "" {
		return fmt.Errorf("invalid Loki push URL")
	}
	if !httpguts.ValidHeaderFieldValue(tenant) || (authHeader != "" && (!httpguts.ValidHeaderFieldName(authHeader) || !httpguts.ValidHeaderFieldValue(authValue))) || (authHeader == "" && authValue != "") {
		return fmt.Errorf("invalid Loki request headers")
	}
	if authHeader != "" && (http.CanonicalHeaderKey(authHeader) == "Content-Type" || http.CanonicalHeaderKey(authHeader) == "X-Scope-Orgid") {
		return fmt.Errorf("Loki auth header conflicts with a required header")
	}
	return nil
}

type lokiPush struct {
	Streams []lokiStream `json:"streams"`
}

type lokiStream struct {
	Stream map[string]string `json:"stream"`
	Values [][2]string       `json:"values"`
}

type lokiLine struct {
	Timestamp         time.Time      `json:"timestamp"`
	ObservedTimestamp time.Time      `json:"observed_timestamp"`
	Severity          string         `json:"severity"`
	SeverityNumber    int            `json:"severity_number"`
	Body              any            `json:"body"`
	Attributes        map[string]any `json:"attributes"`
	Resource          map[string]any `json:"resource"`
	EventName         string         `json:"event_name,omitempty"`
	TraceID           string         `json:"trace_id,omitempty"`
	SpanID            string         `json:"span_id,omitempty"`
	ScopeName         string         `json:"scope_name,omitempty"`
	ScopeVersion      string         `json:"scope_version,omitempty"`
	DroppedAttributes int            `json:"dropped_attributes,omitempty"`
}

// Export sends each batch as a Loki JSON push request.
func (e *lokiLogExporter) Export(ctx context.Context, records []sdklog.Record) error {
	if e.shutdown.Load() {
		return sdklog.ErrExporterShutdown
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(records) == 0 {
		return nil
	}
	streams := make([]lokiStream, 0, 1)
	streamIndex := make(map[string]int)
	for i := range records {
		r := &records[i]
		clientID := clientIDFromResource(r.Resource())
		index, ok := streamIndex[clientID]
		if !ok {
			index = len(streams)
			streamIndex[clientID] = index
			labels := map[string]string{"job": "omniview"}
			if clientID != "" {
				labels["omniview_client_id"] = clientID
			}
			streams = append(streams, lokiStream{Stream: labels, Values: nil})
		}
		timestamp := r.Timestamp()
		if timestamp.IsZero() {
			timestamp = r.ObservedTimestamp()
		}
		if timestamp.IsZero() {
			timestamp = time.Now()
		}
		line := lokiLine{Timestamp: r.Timestamp(), ObservedTimestamp: r.ObservedTimestamp(), Severity: r.SeverityText(), SeverityNumber: int(r.Severity()), Body: lokiValue(r.Body()), Attributes: make(map[string]any, r.AttributesLen()), Resource: make(map[string]any), EventName: r.EventName(), DroppedAttributes: r.DroppedAttributes()}
		r.WalkAttributes(func(kv attribute.KeyValue) bool { line.Attributes[string(kv.Key)] = lokiValue(kv.Value); return true })
		if res := r.Resource(); res != nil {
			for _, kv := range res.Attributes() {
				line.Resource[string(kv.Key)] = lokiValue(kv.Value)
			}
		}
		if id := r.TraceID(); id.IsValid() {
			line.TraceID = id.String()
		}
		if id := r.SpanID(); id.IsValid() {
			line.SpanID = id.String()
		}
		scope := r.InstrumentationScope()
		line.ScopeName, line.ScopeVersion = scope.Name, scope.Version
		encoded, err := json.Marshal(line)
		if err != nil {
			return fmt.Errorf("encode Loki log line: %w", err)
		}
		streams[index].Values = append(streams[index].Values,
			[2]string{strconv.FormatInt(timestamp.UnixNano(), 10), string(encoded)})
	}
	payload, err := json.Marshal(lokiPush{Streams: streams})
	if err != nil {
		return fmt.Errorf("encode Loki push: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create Loki request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if e.tenant != "" {
		req.Header.Set("X-Scope-OrgID", e.tenant)
	}
	if e.authHeader != "" {
		req.Header.Set(e.authHeader, e.authValue)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return fmt.Errorf("push logs to Loki: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Loki push failed: %s", resp.Status)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

// lokiValue converts OpenTelemetry values to JSON-native values.
func lokiValue(v attribute.Value) any {
	switch v.Type() {
	case attribute.MAP:
		result := make(map[string]any)
		for _, kv := range v.AsMap() {
			result[string(kv.Key)] = lokiValue(kv.Value)
		}
		return result
	case attribute.SLICE:
		values := v.AsSlice()
		result := make([]any, len(values))
		for i, value := range values {
			result[i] = lokiValue(value)
		}
		return result
	case attribute.FLOAT64:
		n := v.AsFloat64()
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return v.String()
		}
	case attribute.FLOAT64SLICE:
		values := v.AsFloat64Slice()
		result := make([]any, len(values))
		for i, value := range values {
			result[i] = lokiValue(attribute.Float64Value(value))
		}
		return result
	}
	return v.AsInterface()
}

// Shutdown prevents new exports and releases idle HTTP connections.
func (e *lokiLogExporter) Shutdown(ctx context.Context) error {
	if e.shutdown.Swap(true) {
		return nil
	}
	e.client.CloseIdleConnections()
	return ctx.Err()
}

// ForceFlush reports cancellation; the exporter does not buffer records.
func (e *lokiLogExporter) ForceFlush(ctx context.Context) error {
	if e.shutdown.Load() {
		return nil
	}
	return ctx.Err()
}
