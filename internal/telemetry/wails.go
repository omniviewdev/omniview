package telemetry

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
)

// TelemetryBinding exposes telemetry operations to the Wails frontend.
type TelemetryBinding struct {
	svc *Service
}

// NewTelemetryBinding creates a binding backed by the given telemetry Service.
func NewTelemetryBinding(svc *Service) *TelemetryBinding {
	return &TelemetryBinding{svc: svc}
}

// IngestFrontendSignals accepts a JSON payload from the frontend containing
// logs, errors, and measurements, and converts them into backend telemetry
// signals (Zap logs, OTel trace span events).
func (b *TelemetryBinding) IngestFrontendSignals(payload string) error {
	signals, err := parseFrontendSignals(payload)
	if err != nil {
		return err
	}

	// Convert frontend logs to Zap entries.
	if b.svc.zapLogger != nil {
		for _, l := range signals.Logs {
			fields := make([]zap.Field, 0, len(l.Context)+1)
			fields = append(fields, zap.String("source", "frontend"))
			for k, v := range l.Context {
				fields = append(fields, zap.String(k, v))
			}
			switch l.Level {
			case "error":
				b.svc.zapLogger.Error(l.Message, fields...)
			case "warn":
				b.svc.zapLogger.Warn(l.Message, fields...)
			case "info":
				b.svc.zapLogger.Info(l.Message, fields...)
			default:
				b.svc.zapLogger.Debug(l.Message, fields...)
			}
		}
	}

	// Convert frontend errors to trace span events.
	if b.svc.tracerProvider != nil {
		tracer := b.svc.tracerProvider.Tracer("omniview.frontend")
		for _, e := range signals.Errors {
			_, span := tracer.Start(context.Background(), "frontend.error")
			span.RecordError(fmt.Errorf("%s: %s", e.Type, e.Message))
			if e.Stacktrace != "" {
				span.SetAttributes(attribute.String("exception.stacktrace", e.Stacktrace))
			}
			span.End()
		}
	}

	// Measurement conversion deferred to Task 21 (needs Metrics struct).
	return nil
}
