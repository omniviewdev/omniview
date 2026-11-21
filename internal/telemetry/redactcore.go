package telemetry

import (
	"bytes"
	"encoding/json"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/omniviewdev/omniview/internal/devdiag"
)

// The bounds of the walk over a reflected value (redactValue): how deep it follows maps and
// slices, how many entries of them it reads in all, and how long the JSON of a value of
// another type may be. A value past the first bound is replaced in that place by
// redactedTooDeep; one past the others is replaced as a whole by redactedTooLarge. A value
// that is not read cannot be known clean, and a cycle is one that has no end.
const (
	maxRedactDepth   = 32
	maxRedactNodes   = 10_000
	maxRedactBytes   = 256 << 10
	redactedTooDeep  = "[REDACTED: nested too deeply]"
	redactedTooLarge = "[REDACTED: value too large]"
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
// have no shape. The names are the words of Redact's key=value pattern and a few that
// only a name can mean, found as SensitiveKey defines: token, tokens, auth_token,
// accessToken, x-api-key, clientSecret, private_key, kubeconfig and Set-Cookie are
// credentials; tokenizer, secretary, passwordless_enabled, sessionID and a bare key
// are not. Under such a name every string is hidden, however deep: an object, an
// array, a map and a reflected slice are read for the strings in them and each is
// replaced; numbers, booleans, times and durations stay; a value that cannot be read
// (a struct, a pointer, a byte slice) is replaced as a whole. A zap.Namespace with such
// a name hides every string after it. Hidden, the value is not even read: an error
// or a Stringer under such a name is not called.
//
// Covered, whatever the encoder and the sink behind it:
//   - the entry message and its stack, by shape;
//   - fields of type string, byte string, binary, error and fmt.Stringer;
//   - what zap writes of its own around them: the verbose form and the causes of an
//     error, the field named for a key and Error that holds the text of a marshaler
//     or a value that failed, and the text of a panic in an Error or String method;
//   - everything an ObjectMarshaler or ArrayMarshaler writes through its encoder
//     (strings, byte strings, binary data, reflected values, namespaces, nested objects
//     and arrays), by shape and by the names it writes under: zap.Object, zap.Array,
//     zap.Inline, zap.Strings, zap.Errors, zap.Stringers and any marshaler of the
//     caller's;
//   - in reflected fields (zap.Any, zap.Reflect), every value that zap writes as JSON,
//     by shape and by the keys of maps and the names of fields: the types a JSON
//     document decodes to (string, []string, map[string]string, []any, map[string]any)
//     are walked, and any other (a struct, a pointer, http.Header, url.Values, a named
//     string, raw JSON) is read as the JSON written for it. In a map or a struct the
//     value of a pair of a name and a value (an environment variable, a header, a
//     setting) is hidden when its name is that of a credential. The walk is bounded
//     (maxRedactDepth, maxRedactNodes, maxRedactBytes);
//   - the fields given to With, when they are bound, which is when an encoder reads them.
//
// Not inspected: field keys, which are names and not text to hide; the logger name
// and the caller; numbers, booleans, times, durations and the other fields that carry
// no text; and binary data, which is written as the base64 of its bytes, in a field
// and in a reflected value.
//
// Redaction is by pattern and by name, so it is defence in depth and not a guarantee.
// A secret with no recognisable shape under a name that is not in the list (a field
// called data, client_key, ssh_key) is not found, and nothing here makes it safe to
// log one.
//
// A field is left as it came when nothing in it changes, so the output for text that
// holds no credential, under names that are none, is the output of core itself, field
// for field. The caller's slice of fields is never modified: zap hands the same one to
// every core of a tee.
//
// The core leaves to core every decision it takes in Check (its level, a sampler or a
// hook under it, a filter on the name of the logger, the level of each core of a tee):
// see Check below. The wrapper does not have to be put in a particular place.
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

// Check asks the core this one wraps whether it will write the entry, and so leaves to it
// everything it decides in Check: its level, a sampler or a hook under it, a filter on the
// name of the logger, the level of each core of a tee. That core agrees by registering
// itself, and whatever else is to write, with a CheckedEntry; Check keeps that entry
// aside and registers this core in its place, so that Write is where the entry and its
// fields are redacted, and where the cores that agreed are given them.
//
// A wrapper that only asked whether the level is enabled would bypass a sampler under
// it, replace the write of a core under a hook by the hook alone, and have every core
// of a tee under it write an entry it never agreed to.
func (c *redactingCore) Check(ent zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	agreed := c.Core.Check(ent, nil)
	if agreed == nil {
		return ce
	}
	write, ok := checkedWrites.Get().(*checkedWrite)
	if !ok {
		write = new(checkedWrite)
	}
	write.redactingCore, write.agreed = c, agreed
	ce = ce.AddCore(ent, write)
	write.entry = ce
	return ce
}

// Write redacts the entry and the fields and gives them to the wrapped core. It is the
// way in for a caller that writes without Check; what zap writes after a Check goes
// through checkedWrite.Write, which gives them to the cores that agreed.
func (c *redactingCore) Write(ent zapcore.Entry, fields []zapcore.Field) error {
	ent, fields = c.redact(ent, fields)
	return c.Core.Write(ent, fields)
}

// redact returns ent and fields with the text in them redacted.
func (c *redactingCore) redact(ent zapcore.Entry, fields []zapcore.Field) (zapcore.Entry, []zapcore.Field) {
	ent.Message = devdiag.Redact(ent.Message)
	ent.Stack = devdiag.Redact(ent.Stack)
	redacted, _ := redactFields(fields, c.scoped)
	return ent, redacted
}

// checkedWrites holds the checkedWrite of each entry between its Check and its Write, so
// that a log call allocates nothing on the way.
//
//nolint:gochecknoglobals // A pool is shared by every core of the process, as zap's own are.
var checkedWrites = sync.Pool{New: func() any { return new(checkedWrite) }}

// checkedWrite is what Check registers with the CheckedEntry zap writes, in the place of
// the cores that agreed to write the entry: it holds them, in agreed, until Write.
type checkedWrite struct {
	// redactingCore is the core that registered this write; it is a Core only so that
	// checkedWrite is one, and nothing but Write is called on it.
	*redactingCore
	// agreed is the CheckedEntry that the wrapped core registered itself with.
	agreed *zapcore.CheckedEntry
	// entry is the CheckedEntry zap writes, which carries the logger's error output.
	entry *zapcore.CheckedEntry
}

// Write gives the redacted entry and fields to the cores that agreed to write it, as zap
// would have given them the entry itself, and returns the checkedWrite to the pool.
// Write errors are reported by agreed, to the same error output.
func (w *checkedWrite) Write(ent zapcore.Entry, fields []zapcore.Field) error {
	core, agreed, entry := w.redactingCore, w.agreed, w.entry
	w.redactingCore, w.agreed, w.entry = nil, nil, nil
	checkedWrites.Put(w)

	agreed.Entry, fields = core.redact(ent, fields)
	agreed.ErrorOutput = entry.ErrorOutput
	agreed.Write(fields...)
	return nil
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
		// Hidden under the name of a credential, a value is not marshalled and so cannot fail.
		if v, changed, err := redactReflected(f.Interface, true); err == nil && changed {
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
		v, changed, err := redactReflected(f.Interface, false)
		if err != nil {
			return zap.String(f.Key+"Error", devdiag.Redact(err.Error())), true
		}
		if changed {
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
// error that does hold one, in its message or in anything zap derives from it, is
// replaced by redactedError: still an error, and so still handled as one by the
// encoders and by the OTel bridge, with its message redacted. The companions are not
// written for it, as they would repeat the text.
//
// An error whose message cannot be read, because the method panics, is written by zap
// as a field named for the key and Error with the text of the panic: that field is
// written here instead, redacted. A nil pointer is left to zap, which writes "<nil>".
func redactErrorField(f zapcore.Field) (zapcore.Field, bool) {
	err, ok := f.Interface.(error)
	if !ok {
		return f, false
	}
	text, panicked, ok := callText(err.Error)
	if !ok {
		return redactPanickedField(f, err, panicked)
	}
	redacted := devdiag.Redact(text)
	if redacted == text && !derivedTextHoldsCredential(err) {
		return f, false
	}
	f.Interface = &redactedError{message: redacted, typeName: fmt.Sprintf("%T", err)}
	return f, true
}

// errorGroup is an error made of other errors, the form go.uber.org/multierr gives, of
// which zap writes the causes.
type errorGroup interface{ Errors() []error }

// derivedTextHoldsCredential reports whether what zap writes for err besides its message,
// the way it does for an error field, holds a credential: the causes of a group of errors
// (each written as an error of its own) or the verbose form of an error that formats
// itself. A call that panics counts as holding one: what zap writes for it is not known.
// The causes are counted against the allowance of a walk, which bounds a group that holds
// itself as well as one of a million causes.
func derivedTextHoldsCredential(err error) bool {
	walk := redactWalk{entries: maxRedactNodes, tooLarge: false, err: nil}
	return derivedHoldsCredential(err, &walk)
}

func derivedHoldsCredential(err error, walk *redactWalk) bool {
	switch e := err.(type) { //nolint:errorlint // zap's own encodeError looks at the error itself, not at what it wraps.
	case errorGroup:
		causes, _, ok := callCauses(e)
		if !ok || !walk.charge(len(causes)) {
			return true
		}
		for _, cause := range causes {
			if cause == nil {
				continue
			}
			text, _, returned := callText(cause.Error)
			if !returned || devdiag.Redact(text) != text || derivedHoldsCredential(cause, walk) {
				return true
			}
		}
	case fmt.Formatter:
		verbose, _, ok := callText(func() string { return fmt.Sprintf("%+v", e) })
		return !ok || devdiag.Redact(verbose) != verbose
	}
	return false
}

// callCauses calls Errors on a group of errors, as callText calls Error. returned is
// false when the call panicked.
func callCauses(group errorGroup) ([]error, any, bool) {
	var causes []error
	var panicked any
	returned := false
	func() {
		defer func() { panicked = recover() }()
		causes = group.Errors()
		returned = true
	}()
	return causes, panicked, returned
}

// redactStringerField reads the Stringer now, which is when an encoder would, and
// replaces it by its redacted text when that differs. One that panics is dealt with as
// an error is (redactErrorField).
func redactStringerField(f zapcore.Field) (zapcore.Field, bool) {
	stringer, ok := f.Interface.(fmt.Stringer)
	if !ok {
		return f, false
	}
	text, panicked, ok := callText(stringer.String)
	if !ok {
		return redactPanickedField(f, stringer, panicked)
	}
	redacted := devdiag.Redact(text)
	if redacted == text {
		return f, false
	}
	return zap.String(f.Key, redacted), true
}

// callText calls an Error or a String method. The call can panic (a nil pointer
// receiver, say): returned is then false and panicked is what the method panicked
// with.
func callText(method func() string) (string, any, bool) {
	var text string
	var panicked any
	returned := false
	func() {
		defer func() { panicked = recover() }()
		text = method()
		returned = true
	}()
	return text, panicked, returned
}

// redactPanickedField is for a field whose Error or String method panicked with
// panicked. zap recovers, and writes "<nil>" for a nil pointer and, for anything else, a
// field named for the key and Error that holds the text of the panic; the panic of a
// method that was handed a credential can print it. A nil pointer is left to zap, as it
// writes what it always did; the field for the panic is written here, redacted.
func redactPanickedField(f zapcore.Field, receiver, panicked any) (zapcore.Field, bool) {
	if v := reflect.ValueOf(receiver); v.Kind() == reflect.Pointer && v.IsNil() {
		return f, false
	}
	return zap.String(f.Key+"Error", devdiag.Redact(fmt.Sprintf("PANIC=%v", panicked))), true
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

// redactWalk is what one walk over a reflected value may still spend, and what it found
// that the walk cannot deal with where it is. It is shared by every level of the walk,
// so that a value is bounded as a whole and not one container at a time.
type redactWalk struct {
	// entries is how many more entries of maps and slices the walk may read.
	entries int
	// tooLarge is set when the walk had to read more than it may: the value is not read
	// and is replaced as a whole.
	tooLarge bool
	// err is the first error that json gave for a value of another type, which zap would
	// have written in a field of its own.
	err error
}

// charge takes n entries from the allowance, and reports whether there were that many.
// It marks the walk when there were not. The entries of a container are charged before
// they are read, so that a value of a million entries costs one comparison.
func (w *redactWalk) charge(n int) bool {
	if w.tooLarge {
		return false
	}
	if n > w.entries {
		w.tooLarge = true
		return false
	}
	w.entries -= n
	return true
}

// redactReflected redacts the text in a reflected value: by shape and by name, as
// redactValue says. It returns v itself when nothing changes; redactedTooLarge when the
// value has more entries than maxRedactNodes; and the error that json gives for a value
// that it cannot marshal, which zap would have written in a field named for the key and
// Error, and which can hold anything the failing marshaler put in it.
func redactReflected(v any, all bool) (any, bool, error) {
	walk := redactWalk{entries: maxRedactNodes, tooLarge: false, err: nil}
	redacted, changed := redactValue(v, 0, all, &walk)
	switch {
	case walk.tooLarge:
		return redactedTooLarge, true, nil
	case walk.err != nil:
		return v, false, walk.err
	}
	return redacted, changed, nil
}

// redactValue redacts the text in a reflected value, by shape and, in a map, by the name
// of each key. The types a JSON document decodes to (string, []string, map[string]string,
// []any, map[string]any) are walked here; a value of any other type is read as the JSON
// that zap writes for it (redactTyped). all says that the value is under the name of a
// credential, so that every string in it is replaced; a value of any other type is then
// replaced as a whole unless it is a number, a boolean, a time or a duration. It returns
// v itself when nothing changes, and a copy, never the caller's own map or slice
// altered, when something does.
//
// The walk is bounded in depth (maxRedactDepth: a branch deeper than that is replaced by
// redactedTooDeep) and in entries (walk: the value is replaced as a whole when it holds
// more than maxRedactNodes), whatever the value is made of: a cycle is one with no end.
func redactValue(v any, depth int, all bool, walk *redactWalk) (any, bool) {
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
		if redacted, changed := redactSlice(t, walk, redactElement); changed {
			return redacted, true
		}
	case map[string]string:
		if redacted, changed := redactMap(t, all, walk, textOfString, redactString); changed {
			return redacted, true
		}
	case []any:
		redactElement := func(e any) (any, bool) { return redactValue(e, depth+1, all, walk) }
		if redacted, changed := redactSlice(t, walk, redactElement); changed {
			return redacted, true
		}
	case map[string]any:
		redactEntry := func(e any, sub bool) (any, bool) { return redactValue(e, depth+1, sub, walk) }
		if redacted, changed := redactMap(t, all, walk, textOfAny, redactEntry); changed {
			return redacted, true
		}
	default:
		return redactOther(v, depth, all, walk)
	}
	return v, false
}

// redactOther redacts a value that is not one of the types redactValue walks.
func redactOther(v any, depth int, all bool, walk *redactWalk) (any, bool) {
	switch {
	case plainScalar(v):
		return v, false
	case all:
		return devdiag.Placeholder, true
	}
	return redactTyped(v, depth, walk)
}

// redactTyped redacts a value of a type that a JSON document does not decode to: a
// struct, a pointer, a map or a slice of another type (http.Header and url.Values among
// them), a named string, raw JSON. Each is written by zap as JSON, so each is read as that
// JSON: marshalled, read as a document when it holds anything that could matter, and, when
// something in it changes, replaced by the document as it was read. A value that changes
// nothing is returned as it came, and is written as the core would write it.
//
// A value is not read, and is replaced as a whole, when it has more entries than a walk
// may read or its JSON is longer than maxRedactBytes. One that json cannot marshal is not
// read either: the error is for zap to write, redacted, as it would have written it. A
// method of the value that panics is left to zap, which does not recover from it.
func redactTyped(v any, depth int, walk *redactWalk) (any, bool) {
	if tooWide(v) {
		walk.tooLarge = true
		return v, false
	}
	data, ok, err := marshalTyped(v)
	switch {
	case !ok:
		return v, false
	case err != nil:
		if walk.err == nil {
			walk.err = err
		}
		return v, false
	case len(data) > maxRedactBytes:
		walk.tooLarge = true
		return v, false
	case !devdiag.MayCarryCredential(string(data)):
		return v, false
	}
	return redactDocument(v, data, depth, walk)
}

// redactDocument reads data, the JSON of v, as a document and redacts it. It returns v
// itself when nothing in the document changes. Data that cannot be read as a document is
// nested past what json allows, which json does not write either: it is not known clean
// and is not written.
func redactDocument(v any, data []byte, depth int, walk *redactWalk) (any, bool) {
	document, ok := decodeTyped(data)
	if !ok {
		return redactedTooDeep, true
	}
	if redacted, changed := redactValue(document, depth, false, walk); changed {
		return redacted, true
	}
	return v, false
}

// tooWide reports whether v is a slice, an array or a map with more entries than a walk
// may read. Raw bytes are one string to json, whatever their number.
func tooWide(v any) bool {
	rv := reflect.ValueOf(v)
	switch kind := rv.Kind(); {
	case kind == reflect.Slice && rv.Type().Elem().Kind() == reflect.Uint8:
		return false
	case kind == reflect.Slice, kind == reflect.Array, kind == reflect.Map:
		return rv.Len() > maxRedactNodes
	}
	return false
}

// marshalTyped marshals v as zap's encoder would. ok is false when a method of v
// panicked.
func marshalTyped(v any) ([]byte, bool, error) {
	var data []byte
	var err error
	ok := true
	func() {
		defer func() {
			if recover() != nil {
				ok = false
			}
		}()
		data, err = json.Marshal(v)
	}()
	return data, ok, err
}

// decodeTyped reads data as a document in which a number keeps the digits it was written
// with.
func decodeTyped(data []byte) (any, bool) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var document any
	if err := decoder.Decode(&document); err != nil {
		return nil, false
	}
	return document, true
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
	case nil, time.Time, time.Duration, json.Number:
		return true
	}
	kind := reflect.TypeOf(v).Kind()
	return reflect.Bool <= kind && kind <= reflect.Complex128
}

func textOfString(s string) (string, bool) { return s, true }

func textOfAny(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok
}

// redactSlice applies redact to each element of s. It returns a copy of s when an
// element changes, and reports false, with the s it was given, when none does, or when
// the walk has no more entries to read.
func redactSlice[T any](s []T, walk *redactWalk, redact func(T) (T, bool)) ([]T, bool) {
	if !walk.charge(len(s)) {
		return s, false
	}
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
// name of a credential: all, the key is one, or the entry is the value of a pair whose
// name is one (see pairedValueKey). textOf reads the text of a value, if it is text. It
// returns a copy of m when a value changes, and reports false, with the m it was given,
// when none does, or when the walk has no more entries to read.
func redactMap[V any](
	m map[string]V, all bool, walk *redactWalk, textOf func(V) (string, bool), redact func(V, bool) (V, bool),
) (map[string]V, bool) {
	if !walk.charge(len(m)) {
		return m, false
	}
	pairedKey, paired := pairedValueKey(m, textOf)
	var out map[string]V
	for k, e := range m {
		hide := all || paired && k == pairedKey || devdiag.SensitiveKey(k)
		if redacted, changed := redact(e, hide); changed {
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

// pairedValueKey finds, in a map that is a pair of a name and a value, the key of the
// value when the name is that of a credential. A list of environment variables, of
// headers or of settings is written as [{"name": "DB_PASSWORD", "value": "hunter2"}]:
// the secret has no key of its own to give it away, and the name is in the entry next to
// it. The entries are those with the key name or key and the key value, in any case.
// A map of any size is looked at, and the walk's allowance is what bounds the cost.
func pairedValueKey[V any](m map[string]V, textOf func(V) (string, bool)) (string, bool) {
	valueKey, hasValue, namesCredential := "", false, false
	for k, e := range m {
		switch {
		case strings.EqualFold(k, "value"):
			valueKey, hasValue = k, true
		case strings.EqualFold(k, "name"), strings.EqualFold(k, "key"):
			if text, isText := textOf(e); isText && devdiag.SensitiveKey(text) {
				namesCredential = true
			}
		}
	}
	return valueKey, hasValue && namesCredential
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

// MarshalLogObject and MarshalLogArray return what the marshaler returns, with the text of
// its error redacted: zap writes that text, in a field named for the key and Error, and
// an error is as likely as anything else to say what it was doing with a credential.
func (o *redactingObject) MarshalLogObject(enc zapcore.ObjectEncoder) error {
	return redactedMarshalError(o.inner.MarshalLogObject(&redactingObjectEncoder{ObjectEncoder: enc, all: o.all}))
}

func (a *redactingArray) MarshalLogArray(enc zapcore.ArrayEncoder) error {
	return redactedMarshalError(a.inner.MarshalLogArray(&redactingArrayEncoder{ArrayEncoder: enc, all: a.all}))
}

// redactedMarshalError returns err as it is when its text holds no credential, and an
// error with the same type and the text redacted when it does. It is what zap is given
// to write after the key and Error.
func redactedMarshalError(err error) error {
	if err == nil {
		return nil
	}
	text, _, ok := callText(err.Error)
	if !ok {
		return err
	}
	if redacted := devdiag.Redact(text); redacted != text {
		return &redactedError{message: redacted, typeName: fmt.Sprintf("%T", err)}
	}
	return err
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

// AddReflected writes the value redacted. The error of a value that cannot be marshalled,
// and that of the encoder, are returned as they are: they reach zap through the marshaler
// that called this, and what a marshaler returns is redacted (redactingObject).
func (e *redactingObjectEncoder) AddReflected(key string, value any) error {
	redacted, _, err := redactReflected(value, e.hides(key))
	if err != nil {
		return err
	}
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
	redacted, _, err := redactReflected(value, e.all)
	if err != nil {
		return err
	}
	return e.ArrayEncoder.AppendReflected(redacted)
}

func (e *redactingArrayEncoder) AppendObject(m zapcore.ObjectMarshaler) error {
	return e.ArrayEncoder.AppendObject(&redactingObject{inner: m, all: e.all})
}

func (e *redactingArrayEncoder) AppendArray(m zapcore.ArrayMarshaler) error {
	return e.ArrayEncoder.AppendArray(&redactingArray{inner: m, all: e.all})
}
