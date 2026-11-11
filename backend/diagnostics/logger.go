package diagnostics

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/nxadm/tail"
	"github.com/wailsapp/wails/v3/pkg/application"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

const (
	// LogUpdateFmt is the event name format used to stream new lines of a tailed log.
	LogUpdateFmt = "internal/log/update:%s"

	logMaxSizeMB   = 1024
	logMaxBackups  = 30
	logMaxAgeDays  = 90
	zapFieldsPerKV = 2

	// maxReadLogBytes caps the bytes ReadLog returns (from the end of the file).
	maxReadLogBytes = 8 << 20

	// maxTails is how many files a BackendLogger follows at once. Every tail costs
	// two goroutines and a file handle, and the UI log is the only log served.
	maxTails = 1
)

type BackendLogger struct {
	Sugared   *zap.SugaredLogger
	app       *application.App
	logDir    string
	watchers  map[string]*runningTail
	watchLock sync.Mutex
	// emitLine, when set, receives every tailed line instead of the Wails event
	// bus. Tests use it to observe what StartTail emits.
	emitLine func(event, line string)
}

// runningTail is a followed log file together with the goroutine that emits its lines.
type runningTail struct {
	tail *tail.Tail
	// done is closed when the goroutine that emits the tail's lines has returned.
	done chan struct{}
}

func (b *BackendLogger) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	b.app = application.Get()
	return nil
}

func (b *BackendLogger) ServiceShutdown() error {
	return nil
}

// NewBackendLogger creates (and binds) a Zap SugaredLogger writing to `<name>.log`.
// logDir is the directory where log files are stored (e.g. from appstate.Service.Logs().ResolvePath("")).
func NewBackendLogger(name string, dev bool, logDir string) (*BackendLogger, error) {
	// determine level
	lvl := zapcore.ErrorLevel
	if dev {
		lvl = zapcore.DebugLevel
	}

	baseDir := logDir
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, err
	}

	// file rotate
	logFile := filepath.Join(baseDir, name+".log")
	lj := &lumberjack.Logger{
		Filename:   logFile,
		MaxSize:    logMaxSizeMB,
		MaxBackups: logMaxBackups,
		MaxAge:     logMaxAgeDays,
		Compress:   true,
		LocalTime:  false,
	}

	writer := zapcore.AddSync(lj)

	encCfg := zapcore.EncoderConfig{
		TimeKey:             "ts",
		LevelKey:            "level",
		CallerKey:           "caller",
		MessageKey:          "msg",
		StacktraceKey:       "stacktrace",
		EncodeLevel:         zapcore.LowercaseLevelEncoder,
		EncodeTime:          zapcore.ISO8601TimeEncoder,
		EncodeCaller:        zapcore.ShortCallerEncoder,
		NameKey:             "",
		FunctionKey:         "",
		SkipLineEnding:      false,
		LineEnding:          "",
		EncodeDuration:      nil,
		EncodeName:          nil,
		NewReflectedEncoder: nil,
		ConsoleSeparator:    "",
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
	logger.Debug("backend logger file configured", zap.String("name", name), zap.String("level", lvl.String()))

	return &BackendLogger{
		Sugared:   logger.Sugar(),
		logDir:    baseDir,
		watchers:  make(map[string]*runningTail),
		app:       nil,
		watchLock: sync.Mutex{},
		emitLine:  nil,
	}, nil
}

// zapFields converts a map into a slice of alternating key, value.
func zapFields(fields map[string]any) []any {
	kv := make([]any, 0, len(fields)*zapFieldsPerKV)
	for k, v := range fields {
		kv = append(kv, k, v)
	}
	return kv
}

// Convenience methods

func (b *BackendLogger) Debug(_ context.Context, msg string, fields map[string]any) {
	if len(fields) > 0 {
		b.Sugared.With(zapFields(fields)...).Debug(msg)
	} else {
		b.Sugared.Debug(msg)
	}
}

func (b *BackendLogger) Info(_ context.Context, msg string, fields map[string]any) {
	if len(fields) > 0 {
		b.Sugared.With(zapFields(fields)...).Info(msg)
	} else {
		b.Sugared.Info(msg)
	}
}

func (b *BackendLogger) Warn(_ context.Context, msg string, fields map[string]any) {
	if len(fields) > 0 {
		b.Sugared.With(zapFields(fields)...).Warn(msg)
	} else {
		b.Sugared.Warn(msg)
	}
}

func (b *BackendLogger) Error(_ context.Context, msg string, fields map[string]any) {
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

func (b *BackendLogger) ListLogFiles(_ context.Context) ([]string, error) {
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

// ReadLog returns the contents of `<name>.log`. Files larger than maxReadLogBytes
// are truncated: only the last bytes are returned, starting at a line boundary.
func (b *BackendLogger) ReadLog(_ context.Context, name string) (string, error) {
	f, err := os.Open(filepath.Join(b.logDir, name+".log"))
	if err != nil {
		return "", err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	size := info.Size()
	if size <= maxReadLogBytes {
		data, readErr := io.ReadAll(f)
		if readErr != nil {
			return "", readErr
		}
		return string(data), nil
	}
	return readTailWindow(f, size)
}

// readTailWindow returns the last maxReadLogBytes bytes of a log that measured
// size bytes (more than maxReadLogBytes) when it was last statted, starting at a
// line boundary. The log may have shrunk since (a truncated or rotated file), in
// which case less is read, possibly nothing.
func readTailWindow(r io.ReaderAt, size int64) (string, error) {
	// Read one byte before the window so we can tell whether the window starts on a line boundary.
	buf := make([]byte, maxReadLogBytes+1)
	n, err := r.ReadAt(buf, size-maxReadLogBytes-1)
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	if n == 0 {
		return "", nil
	}
	buf = buf[:n]
	if buf[0] == '\n' {
		return string(buf[1:]), nil
	}
	if i := bytes.IndexByte(buf, '\n'); i >= 0 {
		return string(buf[i+1:]), nil
	}
	return "", nil
}

func (b *BackendLogger) SearchLog(_ context.Context, name, pattern string) ([]string, error) {
	f, err := os.Open(filepath.Join(b.logDir, name+".log"))
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

func (b *BackendLogger) StartTail(_ context.Context, name string) error {
	b.watchLock.Lock()
	defer b.watchLock.Unlock()

	if _, ok := b.watchers[name]; ok {
		return nil // already tailing
	}
	if len(b.watchers) >= maxTails {
		return apperror.New(
			apperror.TypeResourceLimit,
			http.StatusTooManyRequests,
			"Too many log tails",
			"Only one log can be followed at a time; stop the running tail first.",
		)
	}
	t, err := tail.TailFile(filepath.Join(b.logDir, name+".log"), tail.Config{
		Follow:    true,
		ReOpen:    true,
		MustExist: true,
		// Start at the current end of the file. The viewer loads the history with
		// ReadLog, which is capped at maxReadLogBytes; replaying the whole file as
		// events would hand a remote viewer far more than that cap.
		Location: &tail.SeekInfo{Offset: 0, Whence: io.SeekEnd},
		// Poll the file instead of using inotify. The library's inotify tracker is
		// process-wide and keyed by file name, so a tail stopped and restarted on
		// the same file races with the old watcher's removal of that shared watch
		// and can be left deaf. A polling tail keeps all of its state to itself
		// and stops cleanly, at the price of up to one poll interval of latency.
		Poll:          true,
		Pipe:          false,
		MaxLineSize:   0,
		CompleteLines: false,
		RateLimiter:   nil,
		Logger:        nil,
	})
	if err != nil {
		return err
	}
	running := &runningTail{tail: t, done: make(chan struct{})}
	b.watchers[name] = running

	go b.emitTailedLines(name, running)
	return nil
}

// emitTailedLines hands each line of the tail to the event bus, or to emitLine
// when set, until the tail ends.
func (b *BackendLogger) emitTailedLines(name string, running *runningTail) {
	defer close(running.done)
	event := fmt.Sprintf(LogUpdateFmt, name)
	for line := range running.tail.Lines {
		switch {
		case b.emitLine != nil:
			b.emitLine(event, line.Text)
		case b.app != nil:
			b.app.Event.Emit(event, line.Text)
		}
	}
}

// stop ends the tail and waits until nothing of it is left: its goroutine has
// exited and its file is closed (Stop returns after both), and so has the
// goroutine that emitted its lines, so no line is emitted once stop returns.
//
// tail.Cleanup is deliberately not called. It removes the library's
// process-wide inotify watch of the file, which a polling tail never
// registers; calling it anyway unbalances that shared bookkeeping and starts
// the shared watcher for nothing.
func (r *runningTail) stop() {
	_ = r.tail.Stop() // the error is the tail's own death reason, such as a failed seek
	<-r.done
}

func (b *BackendLogger) StopTail(_ context.Context, name string) error {
	b.watchLock.Lock()
	defer b.watchLock.Unlock()
	if running, ok := b.watchers[name]; ok {
		running.stop()
		delete(b.watchers, name)
	}
	return nil
}
