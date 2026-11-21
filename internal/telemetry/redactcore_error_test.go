package telemetry

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/contrib/bridges/otelzap"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// zap writes some text of its own, around what a field holds, that no encoder of the
// redacting core sees: the verbose form of an error and the causes of a group of errors
// (what it derives from the error), and, for a marshaler or a value that fails, a
// field named for the key and Error with the text of the failure. A credential in any
// of them is written as it was unless the core reads them too.

// verboseSecretError says nothing in Error and a credential in its verbose form: the
// shape of an error from github.com/pkg/errors that carries the request that failed.
type verboseSecretError struct{}

func (verboseSecretError) Error() string { return "request failed" }
func (verboseSecretError) Format(f fmt.State, _ rune) {
	_, _ = fmt.Fprint(f, "request failed [headers: "+credentialText+"]")
}

// causeGroupError is a group of errors in the form of go.uber.org/multierr, whose Error
// does not repeat the errors in it.
type causeGroupError struct{ causes []error }

func (g causeGroupError) Error() string   { return "2 errors occurred" }
func (g causeGroupError) Errors() []error { return g.causes }

// failingObject writes a field and then fails with an error that carries a credential.
type failingObject struct{}

func (failingObject) MarshalLogObject(enc zapcore.ObjectEncoder) error {
	enc.AddString("ok", "fine")
	return errors.New("marshal failed: " + credentialText)
}

type failingArray struct{}

func (failingArray) MarshalLogArray(enc zapcore.ArrayEncoder) error {
	enc.AppendString("fine")
	return errors.New("marshal failed: " + credentialText)
}

type nestingObject struct{}

func (nestingObject) MarshalLogObject(enc zapcore.ObjectEncoder) error {
	return enc.AddObject("inner", failingObject{})
}

// panickingSecretError and panickingSecretStringer panic with a message that carries a
// credential, which zap recovers from and writes, as PANIC=<message>, in a field named
// for the key and Error.
type panickingSecretError struct{}

func (panickingSecretError) Error() string { panic("bad credentials: " + credentialText) }

type panickingSecretStringer struct{}

func (panickingSecretStringer) String() string { panic("bad credentials: " + credentialText) }

func requireNoCredential(t *testing.T, where, out string) {
	t.Helper()
	for _, value := range credentialValues() {
		assert.NotContains(t, out, value, "%s carries a credential", where)
	}
}

func TestRedactingCoreRedactsTheVerboseFormOfAnError(t *testing.T) {
	logs := map[string]func(*zap.Logger){
		"an error":       func(l *zap.Logger) { l.Error("m", zap.Error(verboseSecretError{})) },
		"a named error":  func(l *zap.Logger) { l.Error("m", zap.NamedError("cause", verboseSecretError{})) },
		"a bound error":  func(l *zap.Logger) { l.With(zap.Error(verboseSecretError{})).Error("m") },
		"errors in list": func(l *zap.Logger) { l.Error("m", zap.Errors("errs", []error{verboseSecretError{}})) },
		"a field in an object": func(l *zap.Logger) {
			l.Error("m", zap.Object("o", zapcore.ObjectMarshalerFunc(func(enc zapcore.ObjectEncoder) error {
				zap.Error(verboseSecretError{}).AddTo(enc)
				return nil
			})))
		},
	}
	for name, log := range logs {
		t.Run(name, func(t *testing.T) {
			var bare, wrapped bytes.Buffer
			log(jsonLogger(&bare, zapcore.DebugLevel, false))
			log(jsonLogger(&wrapped, zapcore.DebugLevel, true))

			require.Contains(t, bare.String(), "Bearer abc123def456ghi789", "the sample must reproduce what zap writes")
			requireNoCredential(t, "the core", wrapped.String())
			assert.Contains(t, wrapped.String(), `request failed`)
		})
	}
}

func TestRedactingCoreRedactsTheCausesOfAGroupOfErrors(t *testing.T) {
	group := causeGroupError{causes: []error{
		errors.New("connection refused"),
		errors.New("rpc error: " + credentialText),
		verboseSecretError{},
		nil,
	}}
	var bare, wrapped bytes.Buffer
	jsonLogger(&bare, zapcore.DebugLevel, false).Error("m", zap.Error(group))
	jsonLogger(&wrapped, zapcore.DebugLevel, true).Error("m", zap.Error(group))

	require.Contains(t, bare.String(), `"errorCauses"`, "the sample must reproduce what zap writes")
	require.Contains(t, bare.String(), "abc123def456ghi789")
	requireNoCredential(t, "the core", wrapped.String())
	assert.Contains(t, wrapped.String(), `"error":"2 errors occurred"`)
}

// A group whose causes hold nothing, and an error whose verbose form holds nothing, are
// written as the bare core writes them, causes and verbose form included.
func TestRedactingCoreWritesCleanGroupsAndVerboseErrorsAsTheCoreDoes(t *testing.T) {
	fields := func() []zap.Field {
		return []zap.Field{
			zap.Error(causeGroupError{causes: []error{errors.New("connection refused"), richError{message: "timeout"}}}),
			zap.NamedError("rich", richError{message: "connection refused"}),
		}
	}
	var plain, redacting bytes.Buffer
	jsonLogger(&plain, zapcore.DebugLevel, false).Error("m", fields()...)
	jsonLogger(&redacting, zapcore.DebugLevel, true).Error("m", fields()...)
	assert.Equal(t, plain.String(), redacting.String())
	assert.Contains(t, redacting.String(), `"errorCauses"`)
	assert.Contains(t, redacting.String(), `"richVerbose"`)
}

func TestRedactingCoreRedactsTheErrorOfAMarshalerThatFails(t *testing.T) {
	for name, field := range map[string]zap.Field{
		"an object":                     zap.Object("o", failingObject{}),
		"an array":                      zap.Array("a", failingArray{}),
		"an object in one":              zap.Object("outer", nestingObject{}),
		"an inline object":              zap.Inline(failingObject{}),
		"any, a marshaler":              zap.Any("o", failingObject{}),
		"an object under a name hidden": zap.Object("token", failingObject{}),
	} {
		t.Run(name, func(t *testing.T) {
			var bare, wrapped bytes.Buffer
			jsonLogger(&bare, zapcore.DebugLevel, false).Info("m", field)
			jsonLogger(&wrapped, zapcore.DebugLevel, true).Info("m", field)

			require.Contains(t, bare.String(), "Error")
			requireNoCredential(t, "the core", wrapped.String())
		})
	}

	t.Run("the text around the credential is kept", func(t *testing.T) {
		var out bytes.Buffer
		jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Object("o", failingObject{}))
		assert.Contains(t, out.String(),
			`"oError":"marshal failed: Authorization: [REDACTED] ; password=[REDACTED] ; [REDACTED]"`)
		assert.Contains(t, out.String(), `"o":{"ok":"fine"}`)
	})
}

// zap writes the panic of an Error or a String method in a field of its own.
func TestRedactingCoreRedactsThePanicThatZapWritesForAMethodThatFails(t *testing.T) {
	var bare, wrapped bytes.Buffer
	fields := func() []zap.Field {
		return []zap.Field{zap.Error(panickingSecretError{}), zap.Stringer("s", panickingSecretStringer{}), zap.Int("count", 3)}
	}
	jsonLogger(&bare, zapcore.DebugLevel, false).Error("m", fields()...)
	jsonLogger(&wrapped, zapcore.DebugLevel, true).Error("m", fields()...)

	require.Contains(t, bare.String(), `"errorError":"PANIC=bad credentials: `, "the sample must reproduce what zap writes")
	require.Contains(t, bare.String(), `"sError":"PANIC=bad credentials: `)
	requireNoCredential(t, "the core", wrapped.String())
	assert.Contains(t, wrapped.String(), `"errorError":"PANIC=bad credentials: Authorization: [REDACTED] ; password=[REDACTED] ; [REDACTED]"`)
	assert.Contains(t, wrapped.String(), `"sError":"PANIC=bad credentials: `)
	assert.Contains(t, wrapped.String(), `"count":3`)
}

// An error that is replaced because its verbose form holds a credential still reaches the
// OTel bridge as an error of the same type, with the text it has.
func TestRedactingCoreKeepsTheTypeOfAnErrorWhoseVerboseFormItReplaces(t *testing.T) {
	exporter := &captureLogExporter{}
	provider := sdklog.NewLoggerProvider(sdklog.WithProcessor(sdklog.NewSimpleProcessor(exporter)))
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	logger := zap.New(NewRedactingCore(otelzap.NewCore("test", otelzap.WithLoggerProvider(provider))))

	logger.Error("RPC failed", zap.Error(verboseSecretError{}))

	exporter.mu.Lock()
	defer exporter.mu.Unlock()
	require.Len(t, exporter.entries, 1)
	requireNoCredential(t, "the OTel record", exporter.entries[0])
	assert.Contains(t, exporter.entries[0], "exception.message=request failed")
	assert.Contains(t, exporter.entries[0], "exception.type=telemetry.verboseSecretError")
}

// Only the verbose form of a cause, or what a cause of a cause holds, may be what carries
// the credential: the group is replaced all the same.
func TestRedactingCoreLooksAtTheCausesOfTheCausesOfAGroupOfErrors(t *testing.T) {
	for name, group := range map[string]causeGroupError{
		"the verbose form of a cause": {causes: []error{errors.New("connection refused"), verboseSecretError{}}},
		"a group in a group":          {causes: []error{causeGroupError{causes: []error{errors.New("rpc error: " + credentialText)}}}},
		"the verbose form of a cause of a cause": {
			causes: []error{causeGroupError{causes: []error{verboseSecretError{}}}},
		},
	} {
		t.Run(name, func(t *testing.T) {
			var bare, wrapped bytes.Buffer
			jsonLogger(&bare, zapcore.DebugLevel, false).Error("m", zap.Error(group))
			jsonLogger(&wrapped, zapcore.DebugLevel, true).Error("m", zap.Error(group))
			require.Contains(t, bare.String(), "abc123def456ghi789", "the sample must reproduce what zap writes")
			requireNoCredential(t, "the core", wrapped.String())
		})
	}
}

// selfGroupError is a group of errors that holds itself, which zap would follow without end.
type selfGroupError struct{ causes []error }

func (g *selfGroupError) Error() string   { return "a group that holds itself" }
func (g *selfGroupError) Errors() []error { return g.causes }

// A group is followed as far as the allowance of a walk goes: past it the error is
// replaced by its message, which is all that is written for it.
func TestRedactingCoreDoesNotFollowAGroupOfErrorsThatHoldsItself(t *testing.T) {
	loop := &selfGroupError{causes: nil}
	loop.causes = []error{loop}
	var out bytes.Buffer
	elapsed := logWithin(t, 10*time.Second, func() {
		jsonLogger(&out, zapcore.DebugLevel, true).Error("m", zap.Error(loop), zap.String("after", "kept"))
	})
	assert.Less(t, elapsed, 2*time.Second)
	assert.Contains(t, out.String(), `"error":"a group that holds itself"`)
	assert.NotContains(t, out.String(), "errorCauses")
	assert.Contains(t, out.String(), `"after":"kept"`)
}

// The causes of a group are counted against the allowance of the walk, like the entries of
// a slice: a group of as many as the allowance is read, and one cause more is not.
func TestRedactingCoreReadsTheCausesOfAGroupUpToTheAllowanceOfTheWalk(t *testing.T) {
	group := func(n int) causeGroupError {
		g := causeGroupError{causes: make([]error, n)}
		for i := range g.causes {
			g.causes[i] = errors.New("connection refused")
		}
		return g
	}
	var out bytes.Buffer
	logger := jsonLogger(&out, zapcore.DebugLevel, true)
	logger.Error("m", zap.Error(group(maxRedactNodes)))
	assert.Contains(t, out.String(), `"errorCauses"`, "a group of causes that hold nothing is written as zap writes it")
	out.Reset()
	logger.Error("m", zap.Error(group(maxRedactNodes+1)))
	assert.NotContains(t, out.String(), `"errorCauses"`)
	assert.Contains(t, out.String(), `"error":"2 errors occurred"`)
}
