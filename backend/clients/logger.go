package clients

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
)

const (
	logMaxSizeMB  = 1024
	logMaxBackups = 30
	logMaxAgeDays = 90
)

type lumberjackSink struct {
	*lumberjack.Logger
}

func (lumberjackSink) Sync() error {
	return nil
}

// CreateLogger creates a zap SugaredLogger that writes to a log file in logDir.
func CreateLogger(dev bool, logDir string) *zap.SugaredLogger {
	var level zapcore.Level
	if dev {
		level = zap.DebugLevel
	} else {
		level = zap.ErrorLevel
	}

	if err := os.MkdirAll(logDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "failed to create log directory %s: %v\n", logDir, err)
		return zap.L().Sugar()
	}

	logFile := filepath.Join(logDir, "app.log")

	encoderConfig := zapcore.EncoderConfig{
		TimeKey:             "ts",
		LevelKey:            "level",
		NameKey:             "logger",
		CallerKey:           "caller",
		MessageKey:          "msg",
		StacktraceKey:       "stacktrace",
		LineEnding:          zapcore.DefaultLineEnding,
		EncodeLevel:         zapcore.LowercaseLevelEncoder,
		EncodeTime:          zapcore.ISO8601TimeEncoder,
		EncodeDuration:      zapcore.SecondsDurationEncoder,
		EncodeCaller:        zapcore.ShortCallerEncoder,
		FunctionKey:         "",
		SkipLineEnding:      false,
		EncodeName:          nil,
		NewReflectedEncoder: nil,
		ConsoleSeparator:    "",
	}
	ll := lumberjack.Logger{
		Filename:   logFile,
		MaxSize:    logMaxSizeMB,
		MaxBackups: logMaxBackups,
		MaxAge:     logMaxAgeDays,
		Compress:   true,
		LocalTime:  false,
	}
	// RegisterSink fails if the scheme is already registered; the existing sink is kept in that case.
	_ = zap.RegisterSink("lumberjack", func(*url.URL) (zap.Sink, error) {
		return lumberjackSink{
			Logger: &ll,
		}, nil
	})
	outputPaths := []string{"lumberjack:" + logFile}
	if dev {
		outputPaths = append(outputPaths, "stderr")
	}
	loggerConfig := zap.Config{
		Level:             zap.NewAtomicLevelAt(level),
		Development:       dev,
		Encoding:          "console",
		EncoderConfig:     encoderConfig,
		OutputPaths:       outputPaths,
		DisableCaller:     false,
		DisableStacktrace: false,
		Sampling:          nil,
		ErrorOutputPaths:  nil,
		InitialFields:     nil,
	}
	logger, err := loggerConfig.Build()
	if err != nil {
		panic(fmt.Sprintf("build zap logger from config error: %v", err))
	}

	return logger.Sugar()
}
