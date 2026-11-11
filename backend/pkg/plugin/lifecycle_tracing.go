package plugin

import (
	"context"
	"sort"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	lifecycleSuccess  = "success"
	lifecycleFailure  = "failure"
	lifecycleCanceled = "canceled"
)

// lifecycleOutcome maps an operation error to the closed outcome vocabulary.
func lifecycleOutcome(err error) string {
	switch telemetryutil.ErrorClass(err) {
	case "none":
		return lifecycleSuccess
	case lifecycleCanceled:
		return lifecycleCanceled
	default:
		return lifecycleFailure
	}
}

// lifecycleCtx returns the context of the lifecycle operation currently
// running for pluginID, or a background context when none is bound.
func (pm *pluginManager) lifecycleCtx(pluginID string) context.Context {
	if v, ok := pm.lifecycleCtxs.Load(pluginID); ok {
		if ctx, valid := v.(context.Context); valid {
			return ctx
		}
	}
	return context.Background()
}

// lifecycleBind makes ctx the parent of nested lifecycle spans for pluginID
// until the returned function restores the previous binding.
func (pm *pluginManager) lifecycleBind(ctx context.Context, pluginID string) func() {
	prev, had := pm.lifecycleCtxs.Load(pluginID)
	pm.lifecycleCtxs.Store(pluginID, ctx)
	return func() {
		if had {
			pm.lifecycleCtxs.Store(pluginID, prev)
		} else {
			pm.lifecycleCtxs.Delete(pluginID)
		}
	}
}

// lifecycleStart starts a lifecycle span as a child of the bound operation.
func (pm *pluginManager) lifecycleStart(
	name, pluginID string, attrs ...attribute.KeyValue,
) (context.Context, trace.Span) {
	ctx, span := tracer.Start(pm.lifecycleCtx(pluginID), name,
		trace.WithAttributes(append([]attribute.KeyValue{attribute.String("plugin_id", pluginID)}, attrs...)...))
	return ctx, span
}

// lifecycleEnd records outcome and error class on span and ends it. The raw
// error text is never exported.
func lifecycleEnd(span trace.Span, err error) {
	outcome := lifecycleOutcome(err)
	span.SetAttributes(attribute.String("outcome", outcome))
	if err != nil {
		telemetryutil.RecordError(span, err)
	}
	span.End()
}

// lifecycleScope starts a child lifecycle span and binds its context for
// nested steps. The returned function takes the final error, unbinds and ends
// the span.
func (pm *pluginManager) lifecycleScope(
	name, pluginID string, attrs ...attribute.KeyValue,
) (trace.Span, func(err error)) {
	ctx, span := pm.lifecycleStart(name, pluginID, attrs...)
	unbind := pm.lifecycleBind(ctx, pluginID)
	return span, func(err error) {
		unbind()
		lifecycleEnd(span, err)
	}
}

// lifecycleOp opens the span of a public lifecycle entry point, takes the
// per-plugin operations lock, records how long the lock wait took, and binds
// the span context for nested steps. The returned function ends the operation:
// it takes the final error, unbinds, releases the lock and ends the span.
func (pm *pluginManager) lifecycleOp(
	name, pluginID string, attrs ...attribute.KeyValue,
) func(err error) {
	ctx, span := tracer.Start(context.Background(), name,
		trace.WithAttributes(append([]attribute.KeyValue{attribute.String("plugin_id", pluginID)}, attrs...)...))
	started := time.Now()
	mu := pm.pluginOpsLock(pluginID)
	mu.Lock()
	span.AddEvent("plugin.ops_lock.acquired",
		trace.WithAttributes(attribute.Int64("wait_ms", time.Since(started).Milliseconds())))
	unbind := pm.lifecycleBind(ctx, pluginID)
	return func(err error) {
		unbind()
		mu.Unlock()
		lifecycleEnd(span, err)
	}
}

// lifecycleCapabilityList renders capabilities as a sorted comma list.
func lifecycleCapabilityList(caps []sdktypes.Capability) string {
	names := make([]string, 0, len(caps))
	for _, c := range caps {
		names = append(names, c.String())
	}
	sort.Strings(names)
	return strings.Join(names, ",")
}
