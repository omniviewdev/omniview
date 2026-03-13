package telemetry

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestZapBackendLevelMapping(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	zapLogger := zap.New(core)
	backend := NewZapBackend(zapLogger)

	tests := []struct {
		sdkLevel logging.Level
		zapLevel zapcore.Level
	}{
		{logging.LevelTrace, zapcore.DebugLevel},
		{logging.LevelDebug, zapcore.DebugLevel},
		{logging.LevelInfo, zapcore.InfoLevel},
		{logging.LevelWarn, zapcore.WarnLevel},
		{logging.LevelError, zapcore.ErrorLevel},
		{logging.LevelFatal, zapcore.ErrorLevel},
	}

	ctx := context.Background()
	for _, tt := range tests {
		t.Run(tt.sdkLevel.String(), func(t *testing.T) {
			before := logs.Len()
			record := logging.Record{
				Timestamp: time.Now(),
				Level:     tt.sdkLevel,
				Message:   "test message",
			}
			err := backend.Write(ctx, record)
			require.NoError(t, err)
			require.Equal(t, before+1, logs.Len())
			assert.Equal(t, tt.zapLevel, logs.All()[logs.Len()-1].Level)
		})
	}
}

func TestZapBackendFieldConversion(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	zapLogger := zap.New(core)
	backend := NewZapBackend(zapLogger)

	record := logging.Record{
		Timestamp: time.Now(),
		Level:     logging.LevelInfo,
		Message:   "loaded plugin",
		Fields: []logging.Field{
			logging.String("plugin", "kubernetes"),
			logging.Int("count", 42),
			logging.Bool("cached", true),
		},
	}

	err := backend.Write(context.Background(), record)
	require.NoError(t, err)

	entry := logs.All()[0]
	assert.Equal(t, "loaded plugin", entry.Message)

	fieldMap := entry.ContextMap()
	assert.Equal(t, "kubernetes", fieldMap["plugin"])
	assert.Equal(t, int64(42), fieldMap["count"])
	assert.Equal(t, true, fieldMap["cached"])
}

func TestZapBackendSync(t *testing.T) {
	core, _ := observer.New(zapcore.DebugLevel)
	zapLogger := zap.New(core)
	backend := NewZapBackend(zapLogger)

	err := backend.Sync(context.Background())
	assert.NoError(t, err)
}

func TestZapBackendContextInjected(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	zapLogger := zap.New(core)
	backend := NewZapBackend(zapLogger)

	traceID, _ := trace.TraceIDFromHex("0af7651916cd43dd8448eb211c80319c")
	spanID, _ := trace.SpanIDFromHex("00f067aa0ba902b7")
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
	})
	ctx := trace.ContextWithSpanContext(context.Background(), sc)

	record := logging.Record{
		Timestamp: time.Now(),
		Level:     logging.LevelInfo,
		Message:   "traced operation",
	}
	err := backend.Write(ctx, record)
	require.NoError(t, err)

	entry := logs.All()[0]
	fieldMap := entry.ContextMap()
	assert.Equal(t, "0af7651916cd43dd8448eb211c80319c", fieldMap["trace_id"])
	assert.Equal(t, "00f067aa0ba902b7", fieldMap["span_id"])
}

func TestZapBackendNilContext(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	zapLogger := zap.New(core)
	backend := NewZapBackend(zapLogger)

	record := logging.Record{
		Timestamp: time.Now(),
		Level:     logging.LevelInfo,
		Message:   "no context",
	}
	//nolint:staticcheck // intentionally passing nil
	err := backend.Write(nil, record)
	require.NoError(t, err)

	// Should not have trace_id or span_id fields.
	fieldMap := logs.All()[0].ContextMap()
	assert.NotContains(t, fieldMap, "trace_id")
	assert.NotContains(t, fieldMap, "span_id")
}

// Compile-time interface assertion.
var _ logging.Backend = (*ZapBackend)(nil)
