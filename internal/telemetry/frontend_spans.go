package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"time"

	"go.opentelemetry.io/otel/trace"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"

	_ "embed"
)

const (
	maxFrontendPayload    = 64 * 1024
	maxFrontendSpans      = 32
	frontendExportTimeout = 5 * time.Second
	frontendClockSkew     = 5 * time.Minute
	frontendEarliestUnix  = 946684800 // 2000-01-01 UTC.
)

//go:embed frontend_span_schema.json
var frontendSchemaJSON []byte

type frontendAttributeRule struct {
	Kind   string   `json:"kind"`
	Values []string `json:"values"`
	Max    int64    `json:"max"`
}

//nolint:gochecknoglobals // Schema is decoded once from the embedded, immutable definition.
var frontendSchema = func() map[string]map[string]frontendAttributeRule {
	var schema map[string]map[string]frontendAttributeRule
	if err := json.Unmarshal(frontendSchemaJSON, &schema); err != nil {
		panic(err)
	}
	return schema
}()
var frontendIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
var frontendResourceTypePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9:/._-]{0,127}$`)

//nolint:gocognit // Validation keeps all schema kinds and their rejection rules together.
func frontendAttributes(name string, raw map[string]json.RawMessage) ([]*commonpb.KeyValue, error) {
	rules, ok := frontendSchema[name]
	if !ok {
		return nil, errors.New("invalid frontend span attribute")
	}
	attrs := make([]*commonpb.KeyValue, 0, len(raw))
	for key, value := range raw {
		rule, exists := rules[key]
		if !exists {
			return nil, errors.New("invalid frontend span attribute")
		}
		var result commonpb.AnyValue
		switch rule.Kind {
		case "id", "resource_type", "enum":
			var text string
			if json.Unmarshal(value, &text) != nil {
				return nil, errors.New("invalid frontend span attribute")
			}
			valid := false
			switch rule.Kind {
			case "id":
				valid = frontendIDPattern.MatchString(text)
			case "resource_type":
				valid = frontendResourceTypePattern.MatchString(text)
			case "enum":
				for _, allowed := range rule.Values {
					if text == allowed {
						valid = true
						break
					}
				}
			}
			if !valid {
				return nil, errors.New("invalid frontend span attribute")
			}
			result.Value = &commonpb.AnyValue_StringValue{StringValue: text}
		case "bool":
			var v bool
			if string(value) != "true" && string(value) != "false" {
				return nil, errors.New("invalid frontend span attribute")
			}
			if json.Unmarshal(value, &v) != nil {
				return nil, errors.New("invalid frontend span attribute")
			}
			result.Value = &commonpb.AnyValue_BoolValue{BoolValue: v}
		case "int":
			var v int64
			if json.Unmarshal(value, &v) != nil || string(value) == "null" || v < 0 || v > rule.Max {
				return nil, errors.New("invalid frontend span attribute")
			}
			result.Value = &commonpb.AnyValue_IntValue{IntValue: v}
		default:
			return nil, errors.New("invalid frontend span attribute")
		}
		attrs = append(attrs, &commonpb.KeyValue{Key: key, Value: &result}) //nolint:exhaustruct // KeyStrindex is unused.
	}
	return attrs, nil
}

type frontendSpan struct {
	Name         string                     `json:"name"`
	TraceID      string                     `json:"traceId"`
	SpanID       string                     `json:"spanId"`
	ParentSpanID string                     `json:"parentSpanId,omitempty"`
	Start        [2]int64                   `json:"start"`
	End          [2]int64                   `json:"end"`
	Error        bool                       `json:"error"`
	Attributes   map[string]json.RawMessage `json:"attributes,omitempty"`
}

func (b *TelemetryBinding) ingestFrontendSpans(raw json.RawMessage) error {
	var spans []frontendSpan
	if err := json.Unmarshal(raw, &spans); err != nil {
		return errors.New("invalid frontend spans")
	}
	if len(spans) == 0 || len(spans) > maxFrontendSpans {
		return errors.New("invalid frontend span count")
	}
	select {
	case b.frontendExports <- struct{}{}:
		defer func() { <-b.frontendExports }()
	default:
		return errors.New("frontend trace bridge busy")
	}
	b.svc.mu.RLock()
	defer b.svc.mu.RUnlock()
	cfg := b.svc.cfg
	if !cfg.Enabled || !cfg.Traces || cfg.OTLPEndpoint == "" {
		return nil
	}
	out := make([]*tracepb.Span, 0, len(spans))
	for _, s := range spans {
		span, err := convertFrontendSpan(s)
		if err != nil {
			return err
		}
		out = append(out, span)
	}
	return b.exportFrontendSpans(cfg, out)
}

func convertFrontendSpan(s frontendSpan) (*tracepb.Span, error) {
	attrs, err := frontendAttributes(s.Name, s.Attributes)
	if err != nil {
		return nil, err
	}
	tid, err := trace.TraceIDFromHex(s.TraceID)
	if err != nil || !tid.IsValid() {
		return nil, errors.New("invalid frontend trace ID")
	}
	sid, err := trace.SpanIDFromHex(s.SpanID)
	if err != nil || !sid.IsValid() {
		return nil, errors.New("invalid frontend span ID")
	}
	var parent []byte
	if s.ParentSpanID != "" {
		parentID, parseErr := trace.SpanIDFromHex(s.ParentSpanID)
		if parseErr != nil || !parentID.IsValid() {
			return nil, errors.New("invalid frontend parent span ID")
		}
		parent = parentID[:]
	}
	if s.Start[0] <= 0 || s.End[0] <= 0 || s.Start[1] < 0 || s.Start[1] >= 1e9 || s.End[1] < 0 || s.End[1] >= 1e9 {
		return nil, errors.New("invalid frontend span time")
	}
	start, end := time.Unix(s.Start[0], s.Start[1]), time.Unix(s.End[0], s.End[1])
	if end.Before(start) || end.Sub(start) > 24*time.Hour || start.Unix() < frontendEarliestUnix ||
		end.After(time.Now().Add(frontendClockSkew)) {
		return nil, errors.New("invalid frontend span duration")
	}
	span := new(tracepb.Span)
	span.Name, span.TraceId, span.SpanId, span.ParentSpanId = s.Name, tid[:], sid[:], parent
	span.Kind = tracepb.Span_SPAN_KIND_INTERNAL
	span.Attributes = attrs
	span.StartTimeUnixNano, span.EndTimeUnixNano = uint64(start.UnixNano()), uint64(end.UnixNano())
	if s.Error {
		span.Status = new(tracepb.Status)
		span.Status.Code = tracepb.Status_STATUS_CODE_ERROR
	}
	return span, nil
}

func (b *TelemetryBinding) exportFrontendSpans(cfg Config, spans []*tracepb.Span) error {
	str := func(value string) *commonpb.AnyValue {
		return &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: value}}
	}
	res := new(resourcepb.Resource)
	res.Attributes = []*commonpb.KeyValue{
		{Key: "service.name", Value: str("omniview-frontend")},
		{Key: "service.version", Value: str(b.svc.version)},
	}
	setTraceClientID(res, clientIDFromResource(b.svc.resource))
	scope := new(commonpb.InstrumentationScope)
	scope.Name = "omniview.frontend"
	request := &collectortrace.ExportTraceServiceRequest{ResourceSpans: []*tracepb.ResourceSpans{{
		Resource:   res,
		ScopeSpans: []*tracepb.ScopeSpans{{Scope: scope, Spans: spans}},
	}}}
	body, err := proto.Marshal(request)
	if err != nil {
		return errors.New("cannot encode frontend spans")
	}
	ctx, cancel := context.WithTimeout(context.Background(), frontendExportTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost, otlpSignalURL(cfg.OTLPEndpoint, "traces"), bytes.NewReader(body),
	)
	if err != nil {
		return errors.New("invalid trace endpoint")
	}
	req.Header.Set("Content-Type", "application/x-protobuf")
	if cfg.AuthHeader != "" && cfg.AuthValue != "" {
		req.Header.Set(cfg.AuthHeader, cfg.AuthValue)
	}
	resp, err := b.frontendHTTP.Do(req)
	if err != nil {
		return errors.New("frontend trace export failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return errors.New("frontend trace collector rejected request")
	}
	return nil
}

// setTraceClientID replaces untrusted client identity with the host identity.
func setTraceClientID(res *resourcepb.Resource, clientID string) {
	attributes := res.GetAttributes()[:0]
	for _, attr := range res.GetAttributes() {
		if attr.GetKey() != "omniview.client.id" {
			attributes = append(attributes, attr)
		}
	}
	if clientID != "" {
		attr := new(commonpb.KeyValue)
		attr.Key = "omniview.client.id"
		attr.Value = &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: clientID}}
		attributes = append(attributes, attr)
	}
	res.Attributes = attributes
}
