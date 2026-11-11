package registry

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

//nolint:gochecknoglobals // Shared tracer is replaceable by in-memory exporters in tests.
var tracer = otel.Tracer("omniview.registry")

// WithLogger attaches a structured logger. A nil logger keeps the client logging
// through span events only. It returns the client for chaining.
func (c *Client) WithLogger(l logging.Logger) *Client {
	c.mu.Lock()
	c.logger = l
	c.mu.Unlock()
	return c
}

func (c *Client) loggerSnapshot() logging.Logger {
	if c == nil {
		return nil
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.logger
}

// startSpan opens a registry span; plugin ID is the only identifier attached.
func startSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	return tracer.Start(ctx, name, trace.WithAttributes(attrs...))
}

// endSpan records outcome and the bounded error class, never the error text.
func endSpan(span trace.Span, err error) {
	if err != nil {
		outcome := "failure"
		if class := telemetryutil.ErrorClass(err); class == "canceled" || class == "CANCELLED" {
			outcome = "canceled"
		}
		span.SetAttributes(attribute.String("outcome", outcome))
		telemetryutil.RecordError(span, err)
	} else {
		span.SetAttributes(attribute.String("outcome", "success"))
	}
	span.End()
}

func (c *Client) debug(ctx context.Context, msg string, kv ...any) {
	if l := c.loggerSnapshot(); l != nil {
		l.Debugw(ctx, msg, kv...)
		return
	}
	trace.SpanFromContext(ctx).AddEvent(msg, trace.WithAttributes(kvAttributes("debug", kv)...))
}

func (c *Client) warn(ctx context.Context, msg string, kv ...any) {
	if l := c.loggerSnapshot(); l != nil {
		l.Warnw(ctx, msg, kv...)
		return
	}
	trace.SpanFromContext(ctx).AddEvent(msg, trace.WithAttributes(kvAttributes("warn", kv)...))
}

// kvAttributes converts alternating key/value pairs; only scalar values are kept.
func kvAttributes(level string, kv []any) []attribute.KeyValue {
	attrs := make([]attribute.KeyValue, 0, len(kv)/2+1)
	attrs = append(attrs, attribute.String("level", level))
	for i := 0; i+1 < len(kv); i += 2 {
		key, ok := kv[i].(string)
		if !ok {
			continue
		}
		switch v := kv[i+1].(type) {
		case string:
			attrs = append(attrs, attribute.String(key, v))
		case int:
			attrs = append(attrs, attribute.Int(key, v))
		case int64:
			attrs = append(attrs, attribute.Int64(key, v))
		case bool:
			attrs = append(attrs, attribute.Bool(key, v))
		default:
			attrs = append(attrs, attribute.String(key, fmt.Sprintf("%T", v)))
		}
	}
	return attrs
}
