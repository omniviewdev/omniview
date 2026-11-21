package telemetry

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

// A core decides in Check whether it writes an entry (its level, a sampler, a hook, a
// filter on the name of the logger) and registers itself, and whatever else is to write,
// with the CheckedEntry. NewRedactingCore has to leave that decision to the core it wraps
// and still be the place the entry is written through: a wrapper whose Check only asks
// whether the level is enabled lets a sampler under it be bypassed, a hook under it
// replace the write, and every core of a tee under it write what it never agreed to.

// countingCore counts the calls to Check that it gets.
type countingCore struct {
	zapcore.Core
	checks *int
}

func (c countingCore) Check(ent zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	*c.checks++
	return c.Core.Check(ent, ce)
}

// nameFilterCore refuses the entries of one logger, as the OTel bridge does for a logger
// its provider has switched off.
type nameFilterCore struct {
	zapcore.Core
	refuse string
}

func (c nameFilterCore) Check(ent zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	if ent.LoggerName == c.refuse {
		return ce
	}
	return c.Core.Check(ent, ce)
}

func (c nameFilterCore) With(fields []zapcore.Field) zapcore.Core {
	return nameFilterCore{Core: c.Core.With(fields), refuse: c.refuse}
}

// failingCore writes nothing and says so.
type failingCore struct{ zapcore.Core }

func (c failingCore) Check(ent zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	if c.Enabled(ent.Level) {
		return ce.AddCore(ent, c)
	}
	return ce
}

func (failingCore) Write(zapcore.Entry, []zapcore.Field) error { return errors.New("disk full") }

// fixedClock gives every entry the same time, so that two loggers write the same text and
// a sampler never starts a new second.
type fixedClock struct{}

func (fixedClock) Now() time.Time                         { return time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC) }
func (fixedClock) NewTicker(d time.Duration) *time.Ticker { return time.NewTicker(d) }

func TestRedactingCoreLeavesTheSamplingOfTheCoreItWrapsToIt(t *testing.T) {
	var out bytes.Buffer
	sampler := zapcore.NewSamplerWithOptions(jsonCore(&out, zapcore.DebugLevel), time.Hour, 100, 100)
	logger := zap.New(NewRedactingCore(sampler))
	for range 1000 {
		logger.Info("RPC failed", zap.String("detail", credentialText))
	}
	assert.Equal(t, 109, strings.Count(out.String(), "\n"), "the first 100 entries, then every 100th of the other 900")
	requireRedacted(t, "the sampled entries", out.String())
}

func TestRedactingCoreLeavesTheHooksOfTheCoreItWrapsToIt(t *testing.T) {
	var out bytes.Buffer
	var hooked []string
	core := zapcore.RegisterHooks(jsonCore(&out, zapcore.DebugLevel), func(ent zapcore.Entry) error {
		hooked = append(hooked, ent.Message)
		return nil
	})
	zap.New(NewRedactingCore(core)).Info("sent "+credentialText, zap.Int("count", 1))

	assert.Equal(t, 1, strings.Count(out.String(), "\n"), "the core under the hook wrote the entry")
	requireRedacted(t, "the line", out.String())
	require.Len(t, hooked, 1, "the hook ran")
	requireRedacted(t, "what the hook was given", hooked[0])
}

func TestRedactingCoreLeavesTheLevelOfEachCoreOfATeeItWrapsToThatCore(t *testing.T) {
	var debugOut, errorOut bytes.Buffer
	tee := zapcore.NewTee(jsonCore(&debugOut, zapcore.DebugLevel), jsonCore(&errorOut, zapcore.ErrorLevel))
	logger := zap.New(NewRedactingCore(tee))

	logger.Info("info", zap.String("detail", credentialText))
	logger.Error("error", zap.String("detail", credentialText))

	assert.Equal(t, 2, strings.Count(debugOut.String(), "\n"))
	assert.Equal(t, 1, strings.Count(errorOut.String(), "\n"), "the error-level core is given the error and not the info")
	assert.NotContains(t, errorOut.String(), `"msg":"info"`)
	requireRedacted(t, "the debug-level core", debugOut.String())
	requireRedacted(t, "the error-level core", errorOut.String())
}

func TestRedactingCoreLeavesTheFilterOnTheNameOfALoggerToTheCoreItWraps(t *testing.T) {
	var out bytes.Buffer
	logger := zap.New(NewRedactingCore(nameFilterCore{Core: jsonCore(&out, zapcore.DebugLevel), refuse: "noisy"}))

	logger.Named("noisy").Info("dropped", zap.String("detail", credentialText))
	logger.Named("quiet").Info("kept", zap.String("detail", credentialText))
	logger.With(zap.String("bound", credentialText)).Named("noisy").Info("dropped again")

	assert.NotContains(t, out.String(), "dropped")
	assert.Equal(t, 1, strings.Count(out.String(), "\n"))
	assert.Contains(t, out.String(), `"msg":"kept"`)
	requireRedacted(t, "the kept entry", out.String())
}

func TestRedactingCoreAsksTheCoreItWrapsOncePerEntry(t *testing.T) {
	var checks int
	core := NewRedactingCore(countingCore{Core: jsonCore(io.Discard, zapcore.WarnLevel), checks: &checks})
	logger := zap.New(core)

	logger.Debug("below the level of the core")
	assert.Zero(t, checks, "zap does not ask a core whose level is not enabled")
	logger.Warn("at the level")
	assert.Equal(t, 1, checks)
	logger.Error("above it", zap.String("detail", credentialText))
	assert.Equal(t, 2, checks, "once for each entry, not twice")
}

// What the core that was agreed to write is given is the whole entry as zap completes it
// after Check: the caller and the stack.
func TestRedactingCoreWritesTheEntryZapCompletesAfterTheCheck(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	logger := zap.New(NewRedactingCore(core), zap.AddCaller(), zap.AddStacktrace(zapcore.WarnLevel))

	logger.Warn("fetching "+credentialText, zap.String("detail", credentialText))

	require.Equal(t, 1, logs.Len())
	entry := logs.All()[0]
	assert.True(t, entry.Caller.Defined, "the caller was lost")
	assert.Contains(t, entry.Caller.File, "redactcore_check_test.go")
	assert.NotEmpty(t, entry.Stack, "the stack was lost")
	requireRedacted(t, "the message", entry.Message)
	assert.NotContains(t, entry.Stack, "hunter2")
}

func TestRedactingCoreStillPanicsAfterWritingAFatalEntryRedacted(t *testing.T) {
	var out bytes.Buffer
	logger := zap.New(NewRedactingCore(jsonCore(&out, zapcore.DebugLevel)), zap.WithFatalHook(zapcore.WriteThenPanic))

	assert.Panics(t, func() { logger.Fatal("giving up: " + credentialText) })
	requireRedacted(t, "the fatal entry", out.String())
}

// zap reports a core that fails to write to the logger's error output; the wrapper does
// not make that go quiet, and the report is the same.
func TestRedactingCoreReportsWhatTheCoreItWrapsFailsToWrite(t *testing.T) {
	report := func(wrap bool) string {
		var reported bytes.Buffer
		var core zapcore.Core = failingCore{Core: jsonCore(io.Discard, zapcore.DebugLevel)}
		if wrap {
			core = NewRedactingCore(core)
		}
		zap.New(core, zap.ErrorOutput(zapcore.AddSync(&reported)), zap.WithClock(fixedClock{})).Info("m", zap.String("detail", credentialText))
		return reported.String()
	}
	bare := report(false)
	require.Contains(t, bare, "disk full")
	assert.Equal(t, bare, report(true))
}

// The way to the core costs nothing that the bare core does not: the pools that zap
// keeps its entries in are what is used, and the number of allocations of a log call does not
// change. The 0 allocs of the benchmark are held here.
func TestRedactingCoreAddsNoAllocationToALogCall(t *testing.T) {
	skipAllocationCountsUnderTheRaceDetector(t)
	fields := []zap.Field{zap.String("pluginID", "kubernetes"), zap.Int("count", 3), zap.Error(errors.New("connection refused"))}
	allocations := func(logger *zap.Logger) float64 {
		return testing.AllocsPerRun(2000, func() { logger.Info("plugin loaded", fields...) })
	}
	bare := allocations(zap.New(jsonCore(io.Discard, zapcore.DebugLevel)))
	wrapped := allocations(zap.New(NewRedactingCore(jsonCore(io.Discard, zapcore.DebugLevel))))
	assert.LessOrEqual(t, wrapped, bare+0.1, "the wrapper allocates (%v against %v)", wrapped, bare)
}
