package telemetry

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/contrib/bridges/otelzap"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/omniviewdev/omniview/internal/devdiag"
)

const credentialText = "Authorization: Bearer abc123def456ghi789 ; password=hunter2 ; AKIAIOSFODNN7EXAMPLE"

// credentialValues are the values in credentialText that must not survive.
func credentialValues() []string {
	return []string{"abc123def456ghi789", "hunter2", "AKIAIOSFODNN7EXAMPLE"}
}

func requireRedacted(t *testing.T, where, out string) {
	t.Helper()
	for _, value := range credentialValues() {
		assert.NotContains(t, out, value, "%s carries a credential", where)
	}
	assert.Contains(t, out, "[REDACTED]", "%s: nothing was redacted", where)
}

// jsonCore writes JSON lines into out, without a time so that two outputs can be
// compared.
func jsonCore(out io.Writer, level zapcore.LevelEnabler) zapcore.Core {
	cfg := zap.NewProductionEncoderConfig()
	cfg.TimeKey = ""
	return zapcore.NewCore(zapcore.NewJSONEncoder(cfg), zapcore.AddSync(out), level)
}

// jsonLogger is a logger over jsonCore, with NewRedactingCore in front of it when wrap
// is set.
func jsonLogger(out io.Writer, level zapcore.LevelEnabler, wrap bool) *zap.Logger {
	core := jsonCore(out, level)
	if wrap {
		core = NewRedactingCore(core)
	}
	return zap.New(core)
}

// Marshalers that write the text of a credential through every method of an encoder
// that can take text.
type credentialObject struct{}

func (credentialObject) MarshalLogObject(enc zapcore.ObjectEncoder) error {
	enc.AddString("text", credentialText)
	enc.AddByteString("bytes", []byte(credentialText))
	enc.AddInt("number", 7)
	if err := enc.AddReflected("reflected", map[string]any{"deep": []any{credentialText}}); err != nil {
		return err
	}
	if err := enc.AddObject("object", nestedObject{}); err != nil {
		return err
	}
	return enc.AddArray("array", credentialArray{})
}

type nestedObject struct{}

func (nestedObject) MarshalLogObject(enc zapcore.ObjectEncoder) error {
	enc.AddString("inner", credentialText)
	return nil
}

type credentialArray struct{}

func (credentialArray) MarshalLogArray(enc zapcore.ArrayEncoder) error {
	enc.AppendString(credentialText)
	enc.AppendByteString([]byte(credentialText))
	enc.AppendInt(7)
	if err := enc.AppendReflected([]string{credentialText}); err != nil {
		return err
	}
	if err := enc.AppendObject(nestedObject{}); err != nil {
		return err
	}
	return enc.AppendArray(zapcore.ArrayMarshalerFunc(func(inner zapcore.ArrayEncoder) error {
		inner.AppendString(credentialText)
		return nil
	}))
}

// resourceObject holds no credential.
type resourceObject struct{ name string }

func (o resourceObject) MarshalLogObject(enc zapcore.ObjectEncoder) error {
	enc.AddString("resource", o.name)
	return nil
}

type stringerText string

func (s stringerText) String() string { return string(s) }

// richError has the verbose form that errors from github.com/pkg/errors have, which
// zap writes as a second field.
type richError struct{ message string }

func (e richError) Error() string { return e.message }
func (e richError) Format(f fmt.State, _ rune) {
	_, _ = fmt.Fprintf(f, "%s [stack: main.go:12 main.go:40]", e.message)
}

func TestRedactingCoreRedactsEveryFieldThatCanCarryText(t *testing.T) {
	err := errors.New("rpc error: " + credentialText)
	count := zap.Int("count", 3)
	// logs returns a call that logs fields and, after them, a field that holds no text.
	logs := func(fields ...zap.Field) func(*zap.Logger) {
		return func(l *zap.Logger) { l.Info("m", append(fields, count)...) }
	}
	jsonShaped := map[string]any{"a": []any{1, map[string]any{"b": credentialText}}}

	for name, log := range map[string]func(*zap.Logger){
		"message":                      func(l *zap.Logger) { l.Info(credentialText, count) },
		"a named logger":               func(l *zap.Logger) { l.Named("plugin").Info(credentialText, count) },
		"string":                       logs(zap.String("detail", credentialText)),
		"byte string":                  logs(zap.ByteString("detail", []byte(credentialText))),
		"error":                        logs(zap.Error(err)),
		"named error":                  logs(zap.NamedError("cause", err)),
		"wrapped error":                logs(zap.Error(fmt.Errorf("while checking: %w", err))),
		"joined errors":                logs(zap.Error(errors.Join(errors.New("first"), err))),
		"error with a verbose form":    logs(zap.Error(richError{message: credentialText})),
		"stringer":                     logs(zap.Stringer("s", stringerText(credentialText))),
		"strings":                      logs(zap.Strings("l", []string{"fine", credentialText})),
		"errors":                       logs(zap.Errors("errs", []error{errors.New("fine"), err})),
		"stringers":                    logs(zap.Stringers("ss", []fmt.Stringer{stringerText(credentialText)})),
		"array":                        logs(zap.Array("a", credentialArray{})),
		"object":                       logs(zap.Object("o", credentialObject{})),
		"inline":                       logs(zap.Inline(credentialObject{})),
		"any, an object marshaler":     logs(zap.Any("o", credentialObject{})),
		"any, a string slice":          logs(zap.Any("l", []string{credentialText})),
		"reflected string":             logs(zap.Reflect("r", credentialText)),
		"reflected map of strings":     logs(zap.Reflect("r", map[string]string{"k": credentialText})),
		"reflected json-shaped values": logs(zap.Any("r", jsonShaped)),
		"a field in a namespace":       logs(zap.Namespace("ns"), zap.String("detail", credentialText)),
	} {
		t.Run(name, func(t *testing.T) {
			var out bytes.Buffer
			log(jsonLogger(&out, zapcore.DebugLevel, true))
			requireRedacted(t, name, out.String())
			assert.Contains(t, out.String(), `"count":3`, "the fields that hold no text are written as they were")
		})
	}
}

func TestRedactingCoreRedactsFieldsBoundWithWith(t *testing.T) {
	err := errors.New("rpc error: " + credentialText)
	var out bytes.Buffer
	logger := jsonLogger(&out, zapcore.DebugLevel, true).
		With(zap.String("detail", credentialText), zap.Error(err), zap.Strings("l", []string{credentialText})).
		With(zap.Object("o", credentialObject{}), zap.Any("r", map[string]any{"k": credentialText})).
		Named("plugin")
	logger.Info("bound")
	logger.Info("bound again", zap.Int("count", 3))
	requireRedacted(t, "With", out.String())
	assert.Equal(t, 2, strings.Count(out.String(), "\n"), "two entries")
}

func TestRedactingCoreRedactsTheStack(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	entry := zapcore.Entry{Message: "m", Stack: "main.fetch(\"https://u:p@host/\")\n\tmain.go:12"}
	require.NoError(t, NewRedactingCore(core).Write(entry, nil))
	require.Equal(t, 1, logs.Len())
	assert.NotContains(t, logs.All()[0].Stack, "u:p@")
	assert.Contains(t, logs.All()[0].Stack, "main.go:12")
}

// What is clean comes out as the core alone would have written it, field for field:
// the verbose form of an error, the numbers, the namespace, the binary data.
func TestRedactingCoreWritesCleanFieldsExactlyAsTheCoreDoes(t *testing.T) {
	fields := func() []zap.Field {
		return []zap.Field{
			zap.String("s", "plugin loaded"),
			zap.ByteString("b", []byte("sha256:3d380ca8864549e74af4b29c10f9cb0956236dfb01c40ca076fb6c37253234db")),
			zap.Error(errors.New("connection refused")),
			zap.NamedError("rich", richError{message: "connection refused"}),
			zap.NamedError("joined", errors.Join(errors.New("first"), errors.New("second"))),
			zap.Stringer("st", stringerText("kube-system/coredns")),
			zap.Strings("l", []string{"a", "b"}),
			zap.Errors("errs", []error{errors.New("a")}),
			zap.Object("o", resourceObject{name: "pods.v1"}),
			zap.Any("m", map[string]any{"a": []any{"x", 1.5, true, nil}, "b": map[string]string{"k": "v"}}),
			zap.Any("l2", []string{"x"}),
			zap.Int("i", 3), zap.Int64("i64", -4), zap.Uint8("u8", 5), zap.Float64("f", 2.5), zap.Bool("ok", true),
			zap.Duration("d", 1500*time.Millisecond), zap.Time("t", time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)),
			zap.Binary("bin", []byte{1, 2, 3}), zap.Complex128("c", 1+2i),
			zap.Any("struct", struct{ Name string }{"x"}),
			zap.Namespace("ns"), zap.String("in-ns", "x"),
		}
	}
	var plain, redacting bytes.Buffer
	jsonLogger(&plain, zapcore.DebugLevel, false).Info("message", fields()...)
	jsonLogger(&redacting, zapcore.DebugLevel, true).Info("message", fields()...)
	assert.Equal(t, plain.String(), redacting.String())
	assert.Contains(t, redacting.String(), "richVerbose",
		"the sample must include a verbose error for the comparison to mean anything")
}

// zap's own check of the level is the lowest level of the tee, so a core that is
// asked about an entry below its level must say no itself.
func TestRedactingCoreHonoursTheLevelOfTheCoreItWraps(t *testing.T) {
	var out bytes.Buffer
	warnOnly := NewRedactingCore(jsonCore(&out, zapcore.WarnLevel))
	beside, besideLogs := observer.New(zapcore.DebugLevel)
	logger := zap.New(zapcore.NewTee(warnOnly, beside))

	logger.Info("below the level")
	assert.Empty(t, out.String())
	assert.Equal(t, 1, besideLogs.Len(), "the other core of the tee takes it")

	logger.Warn("at the level", zap.String("d", credentialText))
	requireRedacted(t, "warn", out.String())
	assert.Equal(t, 1, strings.Count(out.String(), "\n"))
}

// zap passes the same slice of fields to every core of a tee. A core that redacts in
// place would change what the cores after it are given.
func TestRedactingCoreDoesNotModifyTheFieldsItIsGiven(t *testing.T) {
	list := []any{credentialText}
	reflected := map[string]any{"k": list}
	slice := []string{credentialText}
	fields := []zapcore.Field{
		zap.String("s", credentialText), zap.Error(errors.New(credentialText)), zap.Any("r", reflected),
		zap.Strings("l", slice), zap.ByteString("b", []byte(credentialText)),
		zap.Stringer("st", stringerText(credentialText)),
	}
	original := append([]zapcore.Field(nil), fields...)

	behind, wrapped := observer.New(zapcore.DebugLevel)
	beside, besideLogs := observer.New(zapcore.DebugLevel)
	zap.New(zapcore.NewTee(NewRedactingCore(behind), beside)).Info(credentialText, fields...)

	for i := range fields {
		assert.True(t, original[i].Equals(fields[i]), "the field %q was modified", fields[i].Key)
	}
	assert.Equal(t, credentialText, list[0], "the caller's slice was modified")
	assert.Equal(t, credentialText, slice[0], "the caller's slice was modified")

	require.Equal(t, 1, wrapped.Len())
	require.Equal(t, 1, besideLogs.Len())
	for _, value := range credentialValues() {
		assert.NotContains(t, fmt.Sprint(wrapped.All()[0].Message, wrapped.All()[0].ContextMap()), value)
		assert.Contains(t, besideLogs.All()[0].Message, value,
			"the core beside the redacting one is given the text as it was")
		assert.Contains(t, fmt.Sprint(besideLogs.All()[0].ContextMap()), value)
	}
}

func TestRedactingCoreReflectedValues(t *testing.T) {
	t.Run("a value nested deeper than the bound, or one that contains itself, is not written", func(t *testing.T) {
		loop := map[string]any{}
		loop["self"] = loop
		var out bytes.Buffer
		require.NotPanics(t, func() {
			jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Any("loop", loop), zap.String("after", "kept"))
		})
		assert.Contains(t, out.String(), redactedTooDeep)
		assert.Contains(t, out.String(), `"after":"kept"`)
	})

	t.Run("a document nested as deep as the bound is read", func(t *testing.T) {
		var doc any = credentialText
		for range maxRedactDepth {
			doc = []any{doc}
		}
		var out bytes.Buffer
		jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Any("doc", doc))
		requireRedacted(t, "deep document", out.String())
		assert.NotContains(t, out.String(), redactedTooDeep)
	})

	t.Run("the caller's own values are never altered", func(t *testing.T) {
		inner := map[string]string{"k": credentialText, "kept": "fine"}
		doc := map[string]any{"list": []any{inner}, "text": credentialText, "n": 1}
		var out bytes.Buffer
		jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Any("doc", doc))
		requireRedacted(t, "doc", out.String())
		assert.Equal(t, credentialText, inner["k"])
		assert.Equal(t, credentialText, doc["text"])
		assert.Contains(t, out.String(), `"kept":"fine"`)
	})
}

// This pins the limits written on NewRedactingCore. A key is a name and not text to hide,
// and binary data, and bytes in a reflected value, are written as the base64 of the bytes
// and not read as text. If that is made to change, change the comment on NewRedactingCore
// with it. Each is checked on its own: a credential in one that is read would be written
// redacted, and one that is not is written whole.
func TestRedactingCoreDoesNotReadWhatItHasNoWayToInspect(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte(credentialText))
	// A name with the shape of a credential and no word of the list: the key of a field
	// that has one is the field of a credential, and its value is hidden.
	key := "Bearer abc123def456ghi789 AKIAIOSFODNN7EXAMPLE"
	for name, tc := range map[string]struct {
		field zap.Field
		want  string
	}{
		"a key":                    {zap.String(key, "a key is a name"), `"` + key + `":"a key is a name"`},
		"binary data":              {zap.Binary("binary", []byte(credentialText)), `"binary":"` + encoded + `"`},
		"bytes in a reflected one": {zap.Reflect("bytes", []byte(credentialText)), `"bytes":"` + encoded + `"`},
	} {
		t.Run(name, func(t *testing.T) {
			var out bytes.Buffer
			jsonLogger(&out, zapcore.DebugLevel, true).Info("m", tc.field)
			assert.Contains(t, out.String(), tc.want, "what is not inspected was changed")
		})
	}
}

// opaqueSecret has no shape that devdiag.Redact could find: only the name it is
// logged under gives it away.
const opaqueSecret = "s3cr3t-with-no-shape"

type plainArray struct{}

func (plainArray) MarshalLogArray(enc zapcore.ArrayEncoder) error {
	enc.AppendString(opaqueSecret)
	enc.AppendByteString([]byte(opaqueSecret))
	enc.AppendInt(7)
	return enc.AppendReflected([]any{opaqueSecret, 1.5})
}

type plainObject struct{}

func (plainObject) MarshalLogObject(enc zapcore.ObjectEncoder) error {
	enc.AddString("note", opaqueSecret)
	enc.AddInt("n", 7)
	return enc.AddArray("list", plainArray{})
}

func TestRedactingCoreHidesTheValueOfAFieldNamedForACredential(t *testing.T) {
	err := errors.New(opaqueSecret)
	count := zap.Int("count", 3)
	// logs returns a call that logs fields and, after them, a field that holds no text.
	logs := func(fields ...zap.Field) func(*zap.Logger) {
		return func(l *zap.Logger) { l.Info("m", append(fields, count)...) }
	}
	for name, log := range map[string]func(*zap.Logger){
		"string":                      logs(zap.String("auth_token", opaqueSecret)),
		"string, camelCase":           logs(zap.String("accessToken", opaqueSecret)),
		"string, header name":         logs(zap.String("x-api-key", opaqueSecret)),
		"string, the word on its own": logs(zap.String("password", opaqueSecret)),
		"byte string":                 logs(zap.ByteString("clientSecret", []byte(opaqueSecret))),
		"binary":                      logs(zap.Binary("password", []byte(opaqueSecret))),
		"error":                       logs(zap.NamedError("token_error", err)),
		"stringer":                    logs(zap.Stringer("credential", stringerText(opaqueSecret))),
		"strings":                     logs(zap.Strings("auth_token", []string{opaqueSecret, "other"})),
		"errors":                      logs(zap.Errors("token", []error{err})),
		"array":                       logs(zap.Array("authorization", plainArray{})),
		"object":                      logs(zap.Object("secret", plainObject{})),
		"any, a string slice":         logs(zap.Any("signature", []string{opaqueSecret})),
		"reflected string":            logs(zap.Reflect("password", opaqueSecret)),
		"reflected map of strings":    logs(zap.Reflect("secret", map[string]string{"a": opaqueSecret})),
		"reflected document":          logs(zap.Any("token", map[string]any{"a": []any{opaqueSecret, map[string]any{"b": opaqueSecret}}})),
		"reflected struct":            logs(zap.Any("credential", struct{ Value string }{opaqueSecret})),
		"reflected pointer":           logs(zap.Any("credential", &struct{ Value string }{opaqueSecret})),
		"a namespace":                 logs(zap.Namespace("secret"), zap.String("value", opaqueSecret)),
	} {
		t.Run(name, func(t *testing.T) {
			var out bytes.Buffer
			log(jsonLogger(&out, zapcore.DebugLevel, true))
			assert.NotContains(t, out.String(), opaqueSecret)
			assert.Contains(t, out.String(), devdiag.Placeholder)
			assert.Contains(t, out.String(), `"count":3`, "a field that holds no text is written as it was")
		})
	}
}

func TestRedactingCoreLeavesTheValueOfAnyOtherNameAlone(t *testing.T) {
	names := []string{
		"tokenizer", "secretary", "passwordless_enabled", "keyboard", "monkey", "key", "pluginID", "primary_key",
		"error", "connectionID", "cache_key", "resourceKey", "sessionID", "session", "certificate-authority-data",
	}
	fields := make([]zap.Field, 0, len(names))
	for _, name := range names {
		fields = append(fields, zap.String(name, "kept "+name))
	}
	var out bytes.Buffer
	jsonLogger(&out, zapcore.DebugLevel, true).Info("m", fields...)
	for _, name := range names {
		assert.Contains(t, out.String(), `"`+name+`":"kept `+name+`"`)
	}
	assert.NotContains(t, out.String(), devdiag.Placeholder)
}

// A number, a boolean, a duration or a time has no text to hide: under the name of a
// credential it is written as it was, as the bare core writes it.
func TestRedactingCoreKeepsWhatHasNoTextUnderTheNameOfACredential(t *testing.T) {
	fields := func() []zap.Field {
		return []zap.Field{
			zap.Int("token_count", 3), zap.Int64("secret_ttl_ms", 60000), zap.Uint8("auth_token_len", 32),
			zap.Float64("signature_score", 0.5), zap.Bool("password_set", true),
			zap.Duration("credential_ttl", time.Minute), zap.Time("token_expiry", time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)),
			zap.Any("authorization_attempts", map[string]any{
				"count": 2, "last": 1.5, "ok": false, "unset": nil, "ttl": time.Minute,
				"at": time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC), "ids": []any{1, 2},
			}),
		}
	}
	var plain, redacting bytes.Buffer
	jsonLogger(&plain, zapcore.DebugLevel, false).Info("m", fields()...)
	jsonLogger(&redacting, zapcore.DebugLevel, true).Info("m", fields()...)
	assert.Equal(t, plain.String(), redacting.String())
	assert.NotContains(t, redacting.String(), devdiag.Placeholder)
}

// namedObject writes one value under each kind of name, through every method of an
// encoder that takes a name and a value.
type namedObject struct{}

func (namedObject) MarshalLogObject(enc zapcore.ObjectEncoder) error {
	enc.AddString("clientSecret", opaqueSecret)
	enc.AddString("note", "plain text")
	enc.AddByteString("x-api-key", []byte(opaqueSecret))
	enc.AddBinary("auth_token", []byte(opaqueSecret))
	enc.AddInt("password_len", 12)
	if err := enc.AddReflected("access_token", map[string]any{"v": opaqueSecret, "n": 1}); err != nil {
		return err
	}
	if err := enc.AddReflected("headers", map[string]any{"authorization": opaqueSecret, "accept": "text/plain"}); err != nil {
		return err
	}
	if err := enc.AddObject("secret", plainObject{}); err != nil {
		return err
	}
	if err := enc.AddArray("credential", plainArray{}); err != nil {
		return err
	}
	enc.OpenNamespace("signature")
	enc.AddString("after", opaqueSecret)
	return nil
}

func TestRedactingCoreHidesByNameWhatAMarshalerWrites(t *testing.T) {
	for name, field := range map[string]zap.Field{
		"an object": zap.Object("detail", namedObject{}),
		"inline":    zap.Inline(namedObject{}),
		"any":       zap.Any("detail", namedObject{}),
	} {
		t.Run(name, func(t *testing.T) {
			var out bytes.Buffer
			jsonLogger(&out, zapcore.DebugLevel, true).Info("m", field)
			assert.NotContains(t, out.String(), opaqueSecret)
			for _, want := range []string{
				`"clientSecret":"[REDACTED]"`, `"note":"plain text"`, `"x-api-key":"[REDACTED]"`, `"auth_token":"[REDACTED]"`,
				`"password_len":12`, `"access_token":{"n":1,"v":"[REDACTED]"}`,
				`"headers":{"accept":"text/plain","authorization":"[REDACTED]"}`,
				`"secret":{"note":"[REDACTED]","n":7,"list":["[REDACTED]","[REDACTED]",7,["[REDACTED]",1.5]]}`,
				`"credential":["[REDACTED]","[REDACTED]",7,["[REDACTED]",1.5]]`,
				`"signature":{"after":"[REDACTED]"}`,
			} {
				assert.Contains(t, out.String(), want)
			}
		})
	}
}

func TestRedactingCoreHidesByNameWhatAReflectedDocumentHolds(t *testing.T) {
	doc := map[string]any{
		"token": "x", "n": 1,
		"nested":  map[string]any{"password": "p", "list": []any{"a", map[string]any{"secret": "s", "ok": "fine"}}},
		"headers": map[string]string{"authorization": "a", "accept": "text/plain"},
		"api_key": map[string]any{"value": "v", "ttl": 5, "meta": []any{"y", 1.5, nil}},
	}
	var out bytes.Buffer
	jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Any("doc", doc))
	for _, want := range []string{
		`"token":"[REDACTED]"`, `"n":1`, `"password":"[REDACTED]"`, `"list":["a",{"ok":"fine","secret":"[REDACTED]"}]`,
		`"headers":{"accept":"text/plain","authorization":"[REDACTED]"}`,
		`"api_key":{"meta":["[REDACTED]",1.5,null],"ttl":5,"value":"[REDACTED]"}`,
	} {
		assert.Contains(t, out.String(), want)
	}
	// The caller's own document is never altered.
	assert.Equal(t, "x", doc["token"])
	nested, ok := doc["nested"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "p", nested["password"])
}

func TestRedactingCoreHidesByNameTheFieldsBoundWithWith(t *testing.T) {
	var out bytes.Buffer
	logger := jsonLogger(&out, zapcore.DebugLevel, true).
		With(zap.String("auth_token", opaqueSecret), zap.Object("secret", plainObject{}), zap.Strings("x-api-key", []string{opaqueSecret})).
		Named("plugin")
	logger.Info("bound", zap.String("note", "plain text"))
	assert.NotContains(t, out.String(), opaqueSecret)
	assert.Contains(t, out.String(), `"auth_token":"[REDACTED]"`)
	assert.Contains(t, out.String(), `"note":"plain text"`)
}

// zap.Namespace opens a scope that lasts to the end of the entry, and, bound by With, to
// the end of every entry of the logger.
func TestRedactingCoreHidesEverythingAfterANamespaceNamedForACredential(t *testing.T) {
	t.Run("in one call", func(t *testing.T) {
		var out bytes.Buffer
		jsonLogger(&out, zapcore.DebugLevel, true).Info("m",
			zap.String("before", "plain text"), zap.Namespace("credential"), zap.String("after", opaqueSecret), zap.Int("n", 1))
		assert.NotContains(t, out.String(), opaqueSecret)
		assert.Contains(t, out.String(), `"before":"plain text"`)
		assert.Contains(t, out.String(), `"credential":{"after":"[REDACTED]","n":1}`)
	})
	t.Run("bound with With", func(t *testing.T) {
		var out bytes.Buffer
		logger := jsonLogger(&out, zapcore.DebugLevel, true).With(zap.Namespace("secret"))
		logger.Info("m", zap.String("value", opaqueSecret), zap.Object("o", plainObject{}))
		logger.With(zap.String("more", opaqueSecret)).Info("again")
		assert.NotContains(t, out.String(), opaqueSecret)
		assert.Contains(t, out.String(), `"secret":{"value":"[REDACTED]","o":{"note":"[REDACTED]"`)
		assert.Contains(t, out.String(), `"more":"[REDACTED]"`)
	})
	t.Run("a namespace of any other name", func(t *testing.T) {
		var out bytes.Buffer
		jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Namespace("request"), zap.String("note", "plain text"))
		assert.Contains(t, out.String(), `"request":{"note":"plain text"}`)
	})
}

// countingStringer and countingError count the calls made to read them.
type countingStringer struct{ calls *int }

func (s countingStringer) String() string { *s.calls++; return opaqueSecret }

type countingError struct{ calls *int }

func (e countingError) Error() string { *e.calls++; return opaqueSecret }

// What is hidden is not read: its method is not called, here or by the encoder.
func TestRedactingCoreDoesNotReadTheValueItHides(t *testing.T) {
	var stringerCalls, errorCalls int
	var out bytes.Buffer
	jsonLogger(&out, zapcore.DebugLevel, true).Info("m",
		zap.Stringer("token", countingStringer{calls: &stringerCalls}),
		zap.NamedError("credential", countingError{calls: &errorCalls}),
	)
	assert.Zero(t, stringerCalls)
	assert.Zero(t, errorCalls)
	assert.NotContains(t, out.String(), opaqueSecret)
	assert.Contains(t, out.String(), `"token":"[REDACTED]"`)
	assert.Contains(t, out.String(), `"credential":"[REDACTED]"`)
}

type panickingError struct{ message string }

func (e *panickingError) Error() string { return e.message }

type panickingStringer struct{ text string }

func (s *panickingStringer) String() string { return s.text }

// zap recovers from a method that panics, and writes "<nil>" for a nil pointer; the
// core in front must neither panic nor change that.
func TestRedactingCoreLeavesAPanickingMethodToZap(t *testing.T) {
	var nilError *panickingError
	var nilStringer *panickingStringer
	fields := func() []zap.Field { return []zap.Field{zap.Error(nilError), zap.Stringer("s", nilStringer)} }

	var plain, redacting bytes.Buffer
	jsonLogger(&plain, zapcore.DebugLevel, false).Info("m", fields()...)
	require.NotPanics(t, func() { jsonLogger(&redacting, zapcore.DebugLevel, true).Info("m", fields()...) })
	assert.Equal(t, plain.String(), redacting.String())
	assert.Contains(t, redacting.String(), "<nil>")
}

// The OTel bridge does not turn an error under the key "error" into an attribute; it
// attaches the error to the record, and the SDK derives exception.message and
// exception.type from it. A redacted error has to give the SDK the type of the error
// it stands for.
func TestRedactingCoreErrorsReachTheOTelBridgeRedactedAndOfTheSameType(t *testing.T) {
	exporter := &captureLogExporter{}
	provider := sdklog.NewLoggerProvider(sdklog.WithProcessor(sdklog.NewSimpleProcessor(exporter)))
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	logger := zap.New(NewRedactingCore(otelzap.NewCore("test", otelzap.WithLoggerProvider(provider))))

	logger.Error("RPC failed", zap.Error(errors.New("rpc error: "+credentialText)))
	logger.Error("RPC failed", zap.Error(errors.New("connection refused")))

	exporter.mu.Lock()
	defer exporter.mu.Unlock()
	require.Len(t, exporter.entries, 2)
	requireRedacted(t, "OTel record", exporter.entries[0])
	assert.Contains(t, exporter.entries[0], "exception.type=*errors.errorString")
	assert.Contains(t, exporter.entries[1], "exception.message=connection refused")
	assert.Contains(t, exporter.entries[1], "exception.type=*errors.errorString")
}

// The console core exists only in a development build, so it is not reached by
// TestHostLogPipelineRedactsProviderErrorText, which covers the file core and the
// OTel core.
func TestHostConsoleCoreRedacts(t *testing.T) {
	reader, writer, err := os.Pipe()
	require.NoError(t, err)
	stderr := os.Stderr
	os.Stderr = writer // buildZapLogger gives the console core os.Stderr as it is when it is called
	logger, _, buildErr := buildZapLogger(true, nil, "warn", t.TempDir())
	os.Stderr = stderr
	require.NoError(t, buildErr)

	logger.Error("RPC failed", zap.String("detail", credentialText), zap.Error(errors.New(credentialText)))
	require.NoError(t, writer.Close())
	console, err := io.ReadAll(reader)
	require.NoError(t, err)
	requireRedacted(t, "console core", string(console))
}

// BenchmarkRedactingCore compares a core with and without the wrapper, the way a log
// call reaches it: the check, the encoding, and a write to a discarded writer.
func BenchmarkRedactingCore(b *testing.B) {
	longText := strings.Repeat("watching pods namespace=default resource=pods.v1 resourceVersion=123456 ", 60)
	cases := []struct {
		name   string
		msg    string
		fields []zap.Field
	}{
		{
			name: "short message, numbers and flags",
			msg:  "plugin loaded",
			fields: []zap.Field{
				zap.Int("count", 3), zap.Int64("durationMs", 412), zap.Bool("cached", true), zap.Duration("elapsed", time.Second),
			},
		},
		{
			name: "short message, strings and an error",
			msg:  "connection started",
			fields: []zap.Field{
				zap.String("pluginID", "kubernetes"), zap.String("connectionID", "3f2b8c1e-9d4a-4e7b-8a61-5c0d2f9e7b14"),
				zap.Int("count", 3), zap.Error(errors.New("dial tcp 10.96.0.1:443: i/o timeout")),
			},
		},
		{
			name:   "message with a 4.3 KB string field",
			msg:    "request completed",
			fields: []zap.Field{zap.String("pluginID", "kubernetes"), zap.String("body", longText)},
		},
		{
			name: "message with a string slice and an object",
			msg:  "entries",
			fields: []zap.Field{
				zap.Strings("entries", []string{"a", "b", "c"}), zap.Object("o", resourceObject{name: "pods.v1"}),
			},
		},
		{
			name: "message with a credential in an error",
			msg:  "RPC failed",
			fields: []zap.Field{
				zap.String("op", "CheckConnection"), zap.Error(errors.New("rpc error: " + credentialText)),
			},
		},
		{
			name: "message with a field under a credential name",
			msg:  "login",
			fields: []zap.Field{
				zap.String("pluginID", "kubernetes"), zap.String("access_token", "0123456789abcdefghij"),
			},
		},
		{
			name: "message with a key that holds a word start",
			msg:  "loaded",
			fields: []zap.Field{
				zap.String("pluginID", "kubernetes"), zap.String("tokenizer", "wordpiece"), zap.String("secretary", "jane"),
			},
		},
	}
	for _, tc := range cases {
		for _, wrap := range []bool{false, true} {
			name := "unwrapped"
			if wrap {
				name = "redacting"
			}
			b.Run(tc.name+"/"+name, func(b *testing.B) {
				logger := jsonLogger(io.Discard, zapcore.DebugLevel, wrap)
				b.ReportAllocs()
				for range b.N {
					logger.Info(tc.msg, tc.fields...)
				}
			})
		}
	}
}
