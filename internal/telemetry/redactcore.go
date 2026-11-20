package telemetry

import (
	"fmt"
	"maps"
	"reflect"
	"slices"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/omniviewdev/omniview/internal/devdiag"
)

// maxRedactDepth bounds how far redactValue follows a reflected value into maps and
// slices. A value nested deeper (or one that contains itself) is not read: it is
// replaced by redactedTooDeep, because a value that is not read cannot be known clean.
const (
	maxRedactDepth  = 32
	redactedTooDeep = "[REDACTED: nested too deeply]"
)

// NewRedactingCore wraps core so that what it is given has been through devdiag first.
// It is the one place the host's log sinks get that protection: provider errors,
// plugin output and frontend console text all reach them as ordinary log fields.
//
// By shape (devdiag.Redact): text that looks like a credential (a bearer token, a
// key=value secret, the user and password or the query of a URL, a GitHub, GitLab or
// Slack token, an AWS access key ID, a JWT) is replaced by [REDACTED], and the rest
// of the text is kept.
//
// By name (devdiag.SensitiveKey): the value of a field whose name is that of a
// credential is replaced by [REDACTED] whatever it looks like, because most secrets
// have no shape. The names are the words of Redact's key=value pattern, found as
// SensitiveKey defines: token, auth_token, accessToken, x-api-key and clientSecret
// are credentials; tokenizer, secretary, passwordless_enabled and a bare key are
// not. Under such a name every string is hidden, however deep: an object, an array, a
// map and a reflected slice are read for the strings in them and each is replaced;
// numbers, booleans, times and durations stay; a value that cannot be read (a
// struct, a pointer, a byte slice) is replaced as a whole. A zap.Namespace with such
// a name hides every string after it. Hidden, the value is not even read: an error
// or a Stringer under such a name is not called.
//
// Covered, whatever the encoder and the sink behind it:
//   - the entry message and its stack, by shape;
//   - fields of type string, byte string, binary, error and fmt.Stringer;
//   - everything an ObjectMarshaler or ArrayMarshaler writes through its encoder
//     (strings, byte strings, binary data, reflected values, namespaces, nested objects
//     and arrays), by shape and by the names it writes under: zap.Object, zap.Array,
//     zap.Inline, zap.Strings, zap.Errors, zap.Stringers and any marshaler of the
//     caller's;
//   - in reflected fields (zap.Any, zap.Reflect), values of the types string,
//     []string, map[string]string, []any and map[string]any, nested to any depth up
//     to maxRedactDepth, by shape and by the keys of their maps. These are the types
//     a JSON document decodes to;
//   - the fields given to With, when they are bound, which is when an encoder reads them.
//
// Not inspected: field keys, which are names and not text to hide; the logger name
// and the caller; numbers, booleans, times, durations and the other fields that carry
// no text; and, by shape, binary fields and anything in a reflected field that is not
// one of the types above (a struct, a pointer, a typed map or slice, a
// json.RawMessage), whose text reaches the sink as it was.
//
// Redaction is by pattern and by name, so it is defence in depth and not a guarantee.
// A secret with no recognisable shape under a name that is not in the list (a field
// called data, private_key, client_key; tokens, credentials, secrets, which are not
// the words) is not found, and nothing here makes it safe to log one.
//
// A field is left as it came when nothing in it changes, so the output for text that
// holds no credential, under names that are none, is the output of core itself, field
// for field. The caller's slice of fields is never modified: zap hands the same one to
// every core of a tee.
//
// Check asks core.Enabled, as a wrapper of the Core interface has to: wrap a core
// whose Check does more than that (a sampler, say) outside of it, not inside.
func NewRedactingCore(core zapcore.Core) zapcore.Core {
	return &redactingCore{Core: core, scoped: false}
}

type redactingCore struct {
	zapcore.Core
	// scoped is set when With bound a namespace named for a credential: the fields of
	// every entry this core writes are inside it.
	scoped bool
}

func (c *redactingCore) With(fields []zapcore.Field) zapcore.Core {
	redacted, scoped := redactFields(fields, c.scoped)
	return &redactingCore{Core: c.Core.With(redacted), scoped: scoped}
}

func (c *redactingCore) Check(ent zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	if c.Enabled(ent.Level) {
		return ce.AddCore(ent, c)
	}
	return ce
}

func (c *redactingCore) Write(ent zapcore.Entry, fields []zapcore.Field) error {
	ent.Message = devdiag.Redact(ent.Message)
	ent.Stack = devdiag.Redact(ent.Stack)
	redacted, _ := redactFields(fields, c.scoped)
	return c.Core.Write(ent, redacted)
}

// redactFields returns fields with the text in them redacted, and whether the fields
// after them are inside a namespace named for a credential; scoped says whether the
// fields themselves are. It returns fields, uncopied and without allocating, when
// nothing changes, and a copy when something does.
func redactFields(fields []zapcore.Field, scoped bool) ([]zapcore.Field, bool) {
	var out []zapcore.Field
	for i := range fields {
		if fields[i].Type == zapcore.NamespaceType {
			scoped = scoped || devdiag.SensitiveKey(fields[i].Key)
			continue
		}
		redacted, changed := redactField(fields[i], scoped)
		if !changed {
			continue
		}
		if out == nil {
			out = slices.Clone(fields)
		}
		out[i] = redacted
	}
	if out == nil {
		return fields, scoped
	}
	return out, scoped
}

// redactField returns f with its text redacted, and whether that changed it. A field
// that carries text under the name of a credential, or inside a namespace with one,
// is hidden whatever its text is; any other is redacted by the shape of its text.
func redactField(f zapcore.Field, scoped bool) (zapcore.Field, bool) {
	if carriesText(f.Type) && (scoped || devdiag.SensitiveKey(f.Key)) {
		return blankField(f)
	}
	return redactFieldByShape(f)
}

// carriesText reports whether a field of type t holds text, or something that can: a
// value an encoder writes as a string, as binary data, through a marshaler or by
// reflection. A number, a boolean, a time or a duration under the name of a credential
// is not one to hide.
func carriesText(t zapcore.FieldType) bool {
	switch t {
	case zapcore.StringType, zapcore.ByteStringType, zapcore.BinaryType, zapcore.ErrorType, zapcore.StringerType,
		zapcore.ArrayMarshalerType, zapcore.ObjectMarshalerType, zapcore.InlineMarshalerType, zapcore.ReflectType:
		return true
	case zapcore.UnknownType, zapcore.BoolType, zapcore.Complex128Type, zapcore.Complex64Type,
		zapcore.DurationType, zapcore.Float64Type, zapcore.Float32Type, zapcore.Int64Type, zapcore.Int32Type,
		zapcore.Int16Type, zapcore.Int8Type, zapcore.TimeType, zapcore.TimeFullType, zapcore.Uint64Type,
		zapcore.Uint32Type, zapcore.Uint16Type, zapcore.Uint8Type, zapcore.UintptrType, zapcore.NamespaceType,
		zapcore.SkipType:
		return false
	}
	return false
}

// blankField returns f, a field that carries text, with its value replaced by the
// placeholder because its name is that of a credential. Marshalers are always wrapped,
// for what they write is only known when they write it.
func blankField(f zapcore.Field) (zapcore.Field, bool) {
	switch f.Type {
	case zapcore.StringType:
		if f.String == devdiag.Placeholder {
			return f, false
		}
		f.String = devdiag.Placeholder
		return f, true
	case zapcore.ArrayMarshalerType:
		if m, ok := f.Interface.(zapcore.ArrayMarshaler); ok {
			f.Interface = &redactingArray{inner: m, all: true}
			return f, true
		}
	case zapcore.ObjectMarshalerType, zapcore.InlineMarshalerType:
		if m, ok := f.Interface.(zapcore.ObjectMarshaler); ok {
			f.Interface = &redactingObject{inner: m, all: true}
			return f, true
		}
	case zapcore.ReflectType:
		if v, changed := redactValue(f.Interface, 0, true); changed {
			f.Interface = v
			return f, true
		}
	case zapcore.ByteStringType, zapcore.BinaryType, zapcore.ErrorType, zapcore.StringerType:
		// Written as the placeholder in their place, and never read.
		return zap.String(f.Key, devdiag.Placeholder), true
	case zapcore.UnknownType, zapcore.BoolType, zapcore.Complex128Type, zapcore.Complex64Type,
		zapcore.DurationType, zapcore.Float64Type, zapcore.Float32Type, zapcore.Int64Type, zapcore.Int32Type,
		zapcore.Int16Type, zapcore.Int8Type, zapcore.TimeType, zapcore.TimeFullType, zapcore.Uint64Type,
		zapcore.Uint32Type, zapcore.Uint16Type, zapcore.Uint8Type, zapcore.UintptrType, zapcore.NamespaceType,
		zapcore.SkipType:
		// Carry no text: carriesText does not send them here.
	}
	return f, false
}

// redactFieldByShape redacts the text of f that looks like a credential, and reports
// whether that changed f. Marshalers are always wrapped: what they write is only known
// when they write it.
func redactFieldByShape(f zapcore.Field) (zapcore.Field, bool) {
	switch f.Type {
	case zapcore.StringType:
		if text := devdiag.Redact(f.String); text != f.String {
			f.String = text
			return f, true
		}
	case zapcore.ByteStringType:
		if b, ok := f.Interface.([]byte); ok {
			if redacted, changed := redactBytes(b); changed {
				f.Interface = redacted
				return f, true
			}
		}
	case zapcore.ErrorType:
		return redactErrorField(f)
	case zapcore.StringerType:
		return redactStringerField(f)
	case zapcore.ArrayMarshalerType:
		if m, ok := f.Interface.(zapcore.ArrayMarshaler); ok {
			f.Interface = &redactingArray{inner: m, all: false}
			return f, true
		}
	case zapcore.ObjectMarshalerType, zapcore.InlineMarshalerType:
		if m, ok := f.Interface.(zapcore.ObjectMarshaler); ok {
			f.Interface = &redactingObject{inner: m, all: false}
			return f, true
		}
	case zapcore.ReflectType:
		if v, changed := redactValue(f.Interface, 0, false); changed {
			f.Interface = v
			return f, true
		}
	case zapcore.UnknownType, zapcore.BinaryType, zapcore.BoolType, zapcore.Complex128Type, zapcore.Complex64Type,
		zapcore.DurationType, zapcore.Float64Type, zapcore.Float32Type, zapcore.Int64Type, zapcore.Int32Type,
		zapcore.Int16Type, zapcore.Int8Type, zapcore.TimeType, zapcore.TimeFullType, zapcore.Uint64Type,
		zapcore.Uint32Type, zapcore.Uint16Type, zapcore.Uint8Type, zapcore.UintptrType, zapcore.NamespaceType,
		zapcore.SkipType:
		// No text, or opaque bytes that are not text.
	}
	return f, false
}

// redactErrorField keeps an error that holds no credential as it is, so that zap
// goes on writing what it derives from the error itself (the "Verbose" and "Causes"
// companions of a rich error, and the type of the error for the OTel bridge). An
// error that does hold one is replaced by redactedError: still an error, and so
// still handled as one by the encoders and by the OTel bridge, with its text
// redacted. The companions are not written for it, as they would repeat the text.
func redactErrorField(f zapcore.Field) (zapcore.Field, bool) {
	err, ok := f.Interface.(error)
	if !ok {
		return f, false
	}
	text, ok := callText(err.Error)
	if !ok {
		return f, false
	}
	redacted := devdiag.Redact(text)
	if redacted == text {
		return f, false
	}
	f.Interface = &redactedError{message: redacted, typeName: fmt.Sprintf("%T", err)}
	return f, true
}

// redactStringerField reads the Stringer now, which is when an encoder would, and
// replaces it by its redacted text when that differs.
func redactStringerField(f zapcore.Field) (zapcore.Field, bool) {
	stringer, ok := f.Interface.(fmt.Stringer)
	if !ok {
		return f, false
	}
	text, ok := callText(stringer.String)
	if !ok {
		return f, false
	}
	redacted := devdiag.Redact(text)
	if redacted == text {
		return f, false
	}
	return zap.String(f.Key, redacted), true
}

// callText calls an Error or a String method. The call can panic (a nil pointer
// receiver, say); zap has its own recovery for that, and so false leaves the field
// to zap, which writes it as it always did.
func callText(method func() string) (string, bool) {
	var text string
	returned := false
	func() {
		defer func() { _ = recover() }()
		text = method()
		returned = true
	}()
	return text, returned
}

// redactedError is an error whose text has been redacted. It reports the type of the
// error it stands for, in the form the OTel SDK asks for it, so that an exported
// record differs from the unredacted one only in its text.
type redactedError struct {
	message  string
	typeName string
}

func (e *redactedError) Error() string     { return e.message }
func (e *redactedError) ErrorType() string { return e.typeName }

// redactBytes redacts the text in b. It returns b itself when nothing changes.
func redactBytes(b []byte) ([]byte, bool) {
	text := string(b)
	if redacted := devdiag.Redact(text); redacted != text {
		return []byte(redacted), true
	}
	return b, false
}

// redactValue redacts the text in a reflected value of one of the types a JSON
// document decodes to: by shape and, in a map, by the name of each key. all says
// that the value is under the name of a credential, so that every string in it is
// replaced; a value of any other type is then replaced as a whole unless it is a
// number, a boolean, a time or a duration. It returns v itself when nothing changes,
// and a copy, never the caller's own map or slice altered, when something does.
func redactValue(v any, depth int, all bool) (any, bool) {
	if depth > maxRedactDepth {
		return redactedTooDeep, true
	}
	switch t := v.(type) {
	case string:
		if redacted, changed := redactString(t, all); changed {
			return redacted, true
		}
	case []string:
		redactElement := func(s string) (string, bool) { return redactString(s, all) }
		if redacted, changed := redactSlice(t, redactElement); changed {
			return redacted, true
		}
	case map[string]string:
		if redacted, changed := redactMap(t, all, redactString); changed {
			return redacted, true
		}
	case []any:
		redactElement := func(e any) (any, bool) { return redactValue(e, depth+1, all) }
		if redacted, changed := redactSlice(t, redactElement); changed {
			return redacted, true
		}
	case map[string]any:
		redactEntry := func(e any, sub bool) (any, bool) { return redactValue(e, depth+1, sub) }
		if redacted, changed := redactMap(t, all, redactEntry); changed {
			return redacted, true
		}
	default:
		if all && !plainScalar(v) {
			return devdiag.Placeholder, true
		}
	}
	return v, false
}

// redactString redacts s by its shape, or replaces it by the placeholder if all.
func redactString(s string, all bool) (string, bool) {
	if all {
		return devdiag.Placeholder, s != devdiag.Placeholder
	}
	redacted := devdiag.Redact(s)
	return redacted, redacted != s
}

// plainScalar reports whether v is nothing, a number, a boolean, a time or a
// duration: what stays when it is under the name of a credential, as it carries no
// text to hide. Anything else (a struct, a pointer, a byte slice) cannot be read for
// text and is hidden as a whole.
func plainScalar(v any) bool {
	switch v.(type) {
	case nil, time.Time, time.Duration:
		return true
	}
	kind := reflect.TypeOf(v).Kind()
	return reflect.Bool <= kind && kind <= reflect.Complex128
}

// redactSlice applies redact to each element of s. It returns a copy of s when an
// element changes, and reports false, with the s it was given, when none does.
func redactSlice[T any](s []T, redact func(T) (T, bool)) ([]T, bool) {
	var out []T
	for i, e := range s {
		if redacted, changed := redact(e); changed {
			if out == nil {
				out = slices.Clone(s)
			}
			out[i] = redacted
		}
	}
	if out == nil {
		return s, false
	}
	return out, true
}

// redactMap applies redact to each value of m, saying whether the value is under the
// name of a credential: all, or the key is one. It returns a copy of m when a value
// changes, and reports false, with the m it was given, when none does.
func redactMap[V any](m map[string]V, all bool, redact func(V, bool) (V, bool)) (map[string]V, bool) {
	var out map[string]V
	for k, e := range m {
		if redacted, changed := redact(e, all || devdiag.SensitiveKey(k)); changed {
			if out == nil {
				out = maps.Clone(m)
			}
			out[k] = redacted
		}
	}
	if out == nil {
		return m, false
	}
	return out, true
}

// redactingObject and redactingArray hand a marshaler an encoder that redacts what
// the marshaler writes to it. all says that the marshaler was written under the name
// of a credential, and so every string it writes is replaced.
type (
	redactingObject struct {
		inner zapcore.ObjectMarshaler
		all   bool
	}
	redactingArray struct {
		inner zapcore.ArrayMarshaler
		all   bool
	}
)

func (o *redactingObject) MarshalLogObject(enc zapcore.ObjectEncoder) error {
	return o.inner.MarshalLogObject(&redactingObjectEncoder{ObjectEncoder: enc, all: o.all})
}

func (a *redactingArray) MarshalLogArray(enc zapcore.ArrayEncoder) error {
	return a.inner.MarshalLogArray(&redactingArrayEncoder{ArrayEncoder: enc, all: a.all})
}

// redactingObjectEncoder redacts the methods of an ObjectEncoder that take text, by
// shape and by the name they are given, and the marshalers and reflected values that
// can hold more of it. The others, which take numbers, booleans and times, go to the
// encoder as they are. A namespace with the name of a credential, once opened, puts
// the rest of the object under that name: it cannot be closed.
type redactingObjectEncoder struct {
	zapcore.ObjectEncoder
	all bool
}

// hides reports whether what is written under key is the value of a credential.
func (e *redactingObjectEncoder) hides(key string) bool {
	return e.all || devdiag.SensitiveKey(key)
}

func (e *redactingObjectEncoder) AddString(key, value string) {
	text, _ := redactString(value, e.hides(key))
	e.ObjectEncoder.AddString(key, text)
}

func (e *redactingObjectEncoder) AddByteString(key string, value []byte) {
	if e.hides(key) {
		e.ObjectEncoder.AddString(key, devdiag.Placeholder)
		return
	}
	redacted, _ := redactBytes(value)
	e.ObjectEncoder.AddByteString(key, redacted)
}

func (e *redactingObjectEncoder) AddBinary(key string, value []byte) {
	if e.hides(key) {
		e.ObjectEncoder.AddString(key, devdiag.Placeholder)
		return
	}
	e.ObjectEncoder.AddBinary(key, value)
}

func (e *redactingObjectEncoder) AddReflected(key string, value any) error {
	redacted, _ := redactValue(value, 0, e.hides(key))
	return e.ObjectEncoder.AddReflected(key, redacted)
}

func (e *redactingObjectEncoder) AddObject(key string, m zapcore.ObjectMarshaler) error {
	return e.ObjectEncoder.AddObject(key, &redactingObject{inner: m, all: e.hides(key)})
}

func (e *redactingObjectEncoder) AddArray(key string, m zapcore.ArrayMarshaler) error {
	return e.ObjectEncoder.AddArray(key, &redactingArray{inner: m, all: e.hides(key)})
}

func (e *redactingObjectEncoder) OpenNamespace(key string) {
	e.ObjectEncoder.OpenNamespace(key)
	e.all = e.hides(key)
}

// redactingArrayEncoder is redactingObjectEncoder for the elements of an array,
// which have no names: all says that the array is under one.
type redactingArrayEncoder struct {
	zapcore.ArrayEncoder
	all bool
}

func (e *redactingArrayEncoder) AppendString(value string) {
	text, _ := redactString(value, e.all)
	e.ArrayEncoder.AppendString(text)
}

func (e *redactingArrayEncoder) AppendByteString(value []byte) {
	if e.all {
		e.ArrayEncoder.AppendString(devdiag.Placeholder)
		return
	}
	redacted, _ := redactBytes(value)
	e.ArrayEncoder.AppendByteString(redacted)
}

func (e *redactingArrayEncoder) AppendReflected(value any) error {
	redacted, _ := redactValue(value, 0, e.all)
	return e.ArrayEncoder.AppendReflected(redacted)
}

func (e *redactingArrayEncoder) AppendObject(m zapcore.ObjectMarshaler) error {
	return e.ArrayEncoder.AppendObject(&redactingObject{inner: m, all: e.all})
}

func (e *redactingArrayEncoder) AppendArray(m zapcore.ArrayMarshaler) error {
	return e.ArrayEncoder.AppendArray(&redactingArray{inner: m, all: e.all})
}
