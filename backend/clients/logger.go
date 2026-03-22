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
		TimeKey:        "ts",
		LevelKey:       "level",
		NameKey:        "logger",
		CallerKey:      "caller",
		MessageKey:     "msg",
		StacktraceKey:  "stacktrace",
		LineEnding:     zapcore.DefaultLineEnding,
		EncodeLevel:    zapcore.LowercaseLevelEncoder,
		EncodeTime:     zapcore.ISO8601TimeEncoder,
		EncodeDuration: zapcore.SecondsDurationEncoder,
		EncodeCaller:   zapcore.ShortCallerEncoder,
	}
	ll := lumberjack.Logger{
		Filename:   logFile,
		MaxSize:    1024, // MB
		MaxBackups: 30,
		MaxAge:     90, // days
		Compress:   true,
	}
	zap.RegisterSink("lumberjack", func(*url.URL) (zap.Sink, error) {
		return lumberjackSink{
			Logger: &ll,
		}, nil
	})
	outputPaths := []string{fmt.Sprintf("lumberjack:%s", logFile)}
	if dev {
		outputPaths = append(outputPaths, "stderr")
	}
	loggerConfig := zap.Config{
		Level:         zap.NewAtomicLevelAt(level),
		Development:   dev,
		Encoding:      "console",
		EncoderConfig: encoderConfig,
		OutputPaths:   outputPaths,
	}
	logger, err := loggerConfig.Build()
	if err != nil {
		panic(fmt.Sprintf("build zap logger from config error: %v", err))
	}

	return logger.Sugar()
}
