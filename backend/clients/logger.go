package clients

import (
	"fmt"
	"net/url"
	"os"
	"path"

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

func CreateLogger(dev bool) *zap.SugaredLogger {
	var level zapcore.Level
	if dev {
		level = zap.DebugLevel
	} else {
		level = zap.ErrorLevel
	}

	// store the logs in the dot directory
	baseDir, err := os.UserHomeDir()
	if err != nil {
		baseDir = os.TempDir()
	} else {
		baseDir = path.Join(baseDir, ".omniview", "logs")
	}

	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return zap.L().Sugar()
	}

	logFile := path.Join(baseDir, "app.log")

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
	loggerConfig := zap.Config{
		Level:         zap.NewAtomicLevelAt(level),
		Development:   dev,
		Encoding:      "console",
		EncoderConfig: encoderConfig,
		OutputPaths:   []string{fmt.Sprintf("lumberjack:%s", logFile)},
	}
	_globalLogger, err := loggerConfig.Build()
	if err != nil {
		panic(fmt.Sprintf("build zap logger from config error: %v", err))
	}
	zap.ReplaceGlobals(_globalLogger)
	return _globalLogger.Sugar()
}
