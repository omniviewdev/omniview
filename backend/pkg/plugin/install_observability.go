package plugin

import (
	"context"
	"time"

	"go.opentelemetry.io/otel/attribute"
	otelcodes "go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	"github.com/omniviewdev/omniview/internal/telemetry"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// installBaseContext returns the manager context, or Background before Initialize.
func (pm *pluginManager) installBaseContext() context.Context {
	if pm.ctx != nil {
		return pm.ctx
	}
	return context.Background()
}

// installLogger never returns nil so install paths can log unconditionally.
func (pm *pluginManager) installLogger() logging.Logger {
	if pm.logger != nil {
		return pm.logger
	}
	return logging.Default()
}

const (
	installOutcomeSuccess  = "success"
	installOutcomeCanceled = "canceled"
	installOutcomeFailure  = "failure"
)

// installOutcome maps an error to the closed span/metric outcome vocabulary.
func installOutcome(err error) string {
	switch telemetryutil.ErrorClass(err) {
	case "none":
		return installOutcomeSuccess
	case installOutcomeCanceled, "CANCELLED":
		return installOutcomeCanceled
	default:
		return installOutcomeFailure
	}
}

// installSpanEnd records outcome and classification (never raw error text) and ends the span.
func installSpanEnd(span trace.Span, err error) {
	span.SetAttributes(attribute.String("outcome", installOutcome(err)))
	if err != nil {
		telemetryutil.RecordError(span, err)
	} else {
		span.SetStatus(otelcodes.Ok, "")
	}
	span.End()
}

// installSpanChild starts a child span under ctx with the shared plugin attributes.
func installSpanChild(
	ctx context.Context, name, pluginID string, attrs ...attribute.KeyValue,
) (context.Context, trace.Span) {
	base := []attribute.KeyValue{}
	if pluginID != "" {
		base = append(base, attribute.String("plugin_id", pluginID))
	}
	return tracer.Start(ctx, name, trace.WithAttributes(append(base, attrs...)...))
}

// installSpanPhase marks a sub-step of an archive transaction on the active span.
func installSpanPhase(ctx context.Context, phase string) {
	trace.SpanFromContext(ctx).AddEvent("phase", trace.WithAttributes(attribute.String("phase", phase)))
}

type installOperationKey struct{}

// installSpanSetPlugin lets deep install steps publish the manifest identity to the
// root span and metric once it is known.
func installSpanSetPlugin(ctx context.Context, pluginID, version string) {
	if op, ok := ctx.Value(installOperationKey{}).(*installOperation); ok {
		op.setPlugin(pluginID, version)
	}
}

// installOperation is the root `plugin.Install` span plus its per-attempt metric.
type installOperation struct {
	pm       *pluginManager
	ctx      context.Context
	span     trace.Span
	started  time.Time
	source   string
	version  string
	pluginID string
}

func (pm *pluginManager) beginInstall(source, pluginID, version string) (context.Context, *installOperation) {
	attrs := []attribute.KeyValue{attribute.String("source", source)}
	if pluginID != "" {
		attrs = append(attrs, attribute.String("plugin_id", pluginID))
	}
	if version != "" {
		attrs = append(attrs, attribute.String("version", version))
	}
	ctx, span := tracer.Start(pm.installBaseContext(), "plugin.Install", trace.WithAttributes(attrs...))
	op := &installOperation{
		pm: pm, ctx: ctx, span: span, started: time.Now(), source: source, version: version, pluginID: pluginID,
	}
	ctx = context.WithValue(ctx, installOperationKey{}, op)
	op.ctx = ctx
	pm.installLogger().Infow(ctx, "plugin install started", "pluginID", pluginID, "version", version, "source", source)
	return ctx, op
}

// setPlugin records the identity once it is known (path installs learn it from the manifest).
func (op *installOperation) setPlugin(pluginID, version string) {
	if pluginID != "" {
		op.pluginID = pluginID
		op.span.SetAttributes(attribute.String("plugin_id", pluginID))
	}
	if version != "" {
		op.version = version
		op.span.SetAttributes(attribute.String("version", version))
	}
}

func (op *installOperation) finish(err error) {
	elapsed := time.Since(op.started)
	outcome := installOutcome(err)
	log := op.pm.installLogger()
	switch outcome {
	case installOutcomeSuccess:
		log.Infow(op.ctx, "plugin install committed", "pluginID", op.pluginID, "version", op.version,
			"source", op.source, "durationMs", elapsed.Milliseconds())
	case installOutcomeCanceled:
		log.Infow(op.ctx, "plugin install canceled", "pluginID", op.pluginID, "version", op.version,
			"source", op.source, "durationMs", elapsed.Milliseconds(), "outcome", outcome)
	default:
		log.Errorw(op.ctx, "plugin install failed", "pluginID", op.pluginID, "version", op.version, "source", op.source,
			"durationMs", elapsed.Milliseconds(), "outcome", outcome, "errorClass", telemetryutil.ErrorClass(err))
	}
	installSpanEnd(op.span, err)
	telemetry.RecordPluginInstall(op.ctx, op.pluginID, op.source, outcome, elapsed)
}
