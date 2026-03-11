package telemetry

import (
	"context"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// ZapBackend implements the plugin-sdk logging.Backend interface, bridging
// plugin log records into a structured Zap logger.
type ZapBackend struct {
	logger *zap.Logger
}

// NewZapBackend creates a ZapBackend that writes plugin-sdk log records to the
// given Zap logger.
func NewZapBackend(logger *zap.Logger) *ZapBackend {
	return &ZapBackend{logger: logger}
}

// Write converts a plugin-sdk Record into a Zap log entry and writes it.
func (b *ZapBackend) Write(_ context.Context, r logging.Record) error {
	fields := make([]zap.Field, 0, len(r.Fields))
	for _, f := range r.Fields {
		fields = append(fields, convertField(f))
	}
	if ce := b.logger.Check(toZapLevel(r.Level), r.Message); ce != nil {
		ce.Write(fields...)
	}
	return nil
}

// Sync flushes the underlying Zap logger buffers.
func (b *ZapBackend) Sync(_ context.Context) error {
	return b.logger.Sync()
}

// toZapLevel maps a plugin-sdk log level to a Zap level.
func toZapLevel(l logging.Level) zapcore.Level {
	switch l {
	case logging.LevelTrace, logging.LevelDebug:
		return zapcore.DebugLevel
	case logging.LevelInfo:
		return zapcore.InfoLevel
	case logging.LevelWarn:
		return zapcore.WarnLevel
	case logging.LevelError, logging.LevelFatal:
		return zapcore.ErrorLevel
	default:
		return zapcore.InfoLevel
	}
}

// convertField maps a plugin-sdk Field to a Zap Field.
func convertField(f logging.Field) zap.Field {
	switch v := f.Value.(type) {
	case string:
		return zap.String(f.Key, v)
	case int:
		return zap.Int(f.Key, v)
	case int64:
		return zap.Int64(f.Key, v)
	case bool:
		return zap.Bool(f.Key, v)
	case error:
		return zap.NamedError(f.Key, v)
	default:
		return zap.Any(f.Key, v)
	}
}
