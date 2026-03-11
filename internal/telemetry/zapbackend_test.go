package telemetry

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
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

// Compile-time interface assertion.
var _ logging.Backend = (*ZapBackend)(nil)
