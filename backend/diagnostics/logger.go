package diagnostics

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"os"
	"path"
	"regexp"
	"strings"
	"sync"

	"github.com/nxadm/tail"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
)

const (
	LOG_UPDATE_FMT = "internal/log/update:%s"
)

type BackendLogger struct {
	Sugared   *zap.SugaredLogger
	logDir    string
	watchers  map[string]*tail.Tail
	watchLock sync.Mutex
}

// NewBackendLogger creates (and binds) a Zap SugaredLogger writing to `<name>.log`.
func NewBackendLogger(name string, dev bool) (*BackendLogger, error) {
	// determine level
	lvl := zapcore.ErrorLevel
	if dev {
		lvl = zapcore.DebugLevel
	}

	// prepare log directory
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.TempDir()
	}
	baseDir := path.Join(home, ".omniview", "logs")
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, err
	}

	// file rotate
	logFile := path.Join(baseDir, name+".log")
	log.Println(("set logger to app.log"))

	lj := &lumberjack.Logger{
		Filename:   logFile,
		MaxSize:    1024,
		MaxBackups: 30,
		MaxAge:     90,
		Compress:   true,
	}

	writer := zapcore.AddSync(lj)

	encCfg := zapcore.EncoderConfig{
		TimeKey:       "ts",
		LevelKey:      "level",
		CallerKey:     "caller",
		MessageKey:    "msg",
		StacktraceKey: "stacktrace",
		EncodeLevel:   zapcore.LowercaseLevelEncoder,
		EncodeTime:    zapcore.ISO8601TimeEncoder,
		EncodeCaller:  zapcore.ShortCallerEncoder,
	}

	// cfg := zap.Config{
	// 	Level:         zap.NewAtomicLevelAt(lvl),
	// 	Development:   dev,
	// 	Encoding:      "json",
	// 	EncoderConfig: encCfg,
	// 	OutputPaths:   []string{fmt.Sprintf("lumberjack:%s", logFile)},
	// }

	core := zapcore.NewCore(
		zapcore.NewJSONEncoder(encCfg),
		writer,
		lvl,
	)

	logger := zap.New(core, zap.AddCaller(), zap.Development())

	return &BackendLogger{
		Sugared:  logger.Sugar(),
		logDir:   baseDir,
		watchers: make(map[string]*tail.Tail),
	}, nil
}

// zapFields converts a map into a slice of alternating key, value
func zapFields(fields map[string]any) []any {
	kv := make([]any, 0, len(fields)*2)
	for k, v := range fields {
		kv = append(kv, k, v)
	}
	return kv
}

// Convenience methods

func (b *BackendLogger) Debug(ctx context.Context, msg string, fields map[string]any) {
	if len(fields) > 0 {
		b.Sugared.With(zapFields(fields)...).Debug(msg)
	} else {
		b.Sugared.Debug(msg)
	}
}

func (b *BackendLogger) Info(ctx context.Context, msg string, fields map[string]any) {
	if len(fields) > 0 {
		b.Sugared.With(zapFields(fields)...).Info(msg)
	} else {
		b.Sugared.Info(msg)
	}
}

func (b *BackendLogger) Warn(ctx context.Context, msg string, fields map[string]any) {
	if len(fields) > 0 {
		b.Sugared.With(zapFields(fields)...).Warn(msg)
	} else {
		b.Sugared.Warn(msg)
	}
}

func (b *BackendLogger) Error(ctx context.Context, msg string, fields map[string]any) {
	if len(fields) > 0 {
		b.Sugared.With(zapFields(fields)...).Error(msg)
	} else {
		b.Sugared.Error(msg)
	}
}

func (b *BackendLogger) Log(ctx context.Context, level, msg string, fields map[string]any) {
	switch strings.ToLower(level) {
	case "debug":
		b.Debug(ctx, msg, fields)
	case "info":
		b.Info(ctx, msg, fields)
	case "warn", "warning":
		b.Warn(ctx, msg, fields)
	case "error":
		b.Error(ctx, msg, fields)
	default:
		b.Info(ctx, msg, fields)
	}
}

// Listing & searching

func (b *BackendLogger) ListLogFiles(ctx context.Context) ([]string, error) {
	entries, err := os.ReadDir(b.logDir)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".log") {
			out = append(out, strings.TrimSuffix(e.Name(), ".log"))
		}
	}
	return out, nil
}

func (b *BackendLogger) ReadLog(ctx context.Context, name string) (string, error) {
	data, err := os.ReadFile(path.Join(b.logDir, name+".log"))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (b *BackendLogger) SearchLog(ctx context.Context, name, pattern string) ([]string, error) {
	f, err := os.Open(path.Join(b.logDir, name+".log"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	re := regexp.MustCompile(pattern)
	scanner := bufio.NewScanner(f)
	var matches []string
	for scanner.Scan() {
		line := scanner.Text()
		if re.MatchString(line) {
			matches = append(matches, line)
		}
	}
	return matches, scanner.Err()
}

// Tail / stream

func (b *BackendLogger) StartTail(ctx context.Context, name string) error {
	b.watchLock.Lock()
	defer b.watchLock.Unlock()

	if _, ok := b.watchers[name]; ok {
		return nil // already tailing
	}
	t, err := tail.TailFile(path.Join(b.logDir, name+".log"), tail.Config{
		Follow: true, ReOpen: true, MustExist: true,
	})
	if err != nil {
		return err
	}
	b.watchers[name] = t

	go func() {
		for line := range t.Lines {
			runtime.EventsEmit(ctx, fmt.Sprintf(LOG_UPDATE_FMT, name), line.Text)
		}
	}()
	return nil
}

func (b *BackendLogger) StopTail(ctx context.Context, name string) error {
	b.watchLock.Lock()
	defer b.watchLock.Unlock()
	if t, ok := b.watchers[name]; ok {
		t.Cleanup()
		delete(b.watchers, name)
	}
	return nil
}
