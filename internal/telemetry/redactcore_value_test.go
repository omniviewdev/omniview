package telemetry

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// A reflected value is read by walking it, and a value that cannot be read with the time
// and the memory a log call can spend is not written: a value that is not read cannot be
// known clean. It is replaced by a placeholder that says why, and the entry goes on.

// logWithin runs log and fails the test, without waiting for it, if it takes longer than
// limit: a log call that never returns holds the goroutine that made it.
func logWithin(t *testing.T, limit time.Duration, log func()) time.Duration {
	t.Helper()
	done := make(chan struct{})
	start := time.Now()
	go func() {
		defer close(done)
		log()
	}()
	select {
	case <-done:
		return time.Since(start)
	case <-time.After(limit):
		t.Fatalf("the log call did not return within %v", limit)
		return 0
	}
}

// allocatedBy returns the bytes the process allocated while log ran.
func allocatedBy(log func()) uint64 {
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	log()
	runtime.ReadMemStats(&after)
	return after.TotalAlloc - before.TotalAlloc
}

func TestRedactingCoreBoundsTheReadingOfAValueThatContainsItself(t *testing.T) {
	for _, edges := range []int{1, 2, 3, 5} {
		loopMap := map[string]any{}
		for i := range edges {
			loopMap[strconv.Itoa(i)] = loopMap
		}
		loopSlice := make([]any, edges)
		for i := range loopSlice {
			loopSlice[i] = loopSlice
		}
		for name, loop := range map[string]any{"map": loopMap, "slice": loopSlice} {
			t.Run(fmt.Sprintf("%s with %d edges", name, edges), func(t *testing.T) {
				var out bytes.Buffer
				elapsed := logWithin(t, 10*time.Second, func() {
					jsonLogger(&out, zapcore.DebugLevel, true).Info("m",
						zap.Reflect("loop", loop), zap.String("detail", credentialText), zap.String("after", "kept"))
				})
				assert.Less(t, elapsed, 2*time.Second)
				if edges == 1 {
					// One way round: the walk reaches the bound on its way down and goes no further.
					assert.Contains(t, out.String(), redactedTooDeep)
				} else {
					assert.Contains(t, out.String(), `"loop":"`+redactedTooLarge+`"`)
				}
				requireRedacted(t, "the field next to the loop", out.String())
				assert.Contains(t, out.String(), `"after":"kept"`)
			})
		}
	}
}

func TestRedactingCoreBoundsTheDepthOfAValue(t *testing.T) {
	var nestedSlices, nestedMaps any = credentialText, credentialText
	for range 10_000 {
		nestedSlices = []any{nestedSlices}
		nestedMaps = map[string]any{"k": nestedMaps}
	}
	for name, doc := range map[string]any{"slices": nestedSlices, "maps": nestedMaps} {
		t.Run(name, func(t *testing.T) {
			var out bytes.Buffer
			elapsed := logWithin(t, 10*time.Second, func() {
				jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Reflect("doc", doc), zap.String("detail", credentialText))
			})
			assert.Less(t, elapsed, 2*time.Second)
			assert.Contains(t, out.String(), redactedTooDeep)
			assert.Less(t, out.Len(), 4096, "what is written is the value as far as it was read")
			requireRedacted(t, "the field next to it", out.String())
		})
	}
}

func TestRedactingCoreBoundsTheWidthOfAValue(t *testing.T) {
	wideAny := make([]any, 1_000_000)
	for i := range wideAny {
		wideAny[i] = "x"
	}
	wideAny[0] = credentialText
	wideStrings := make([]string, 1_000_000)
	wideStrings[0] = credentialText
	wideMap := make(map[string]string, 100_000)
	for i := range 100_000 {
		wideMap[strconv.Itoa(i)] = "x"
	}
	wideMap["first"] = credentialText
	wideTyped := make([]int, 1_000_000)

	for name, wide := range map[string]any{"any": wideAny, "strings": wideStrings, "string map": wideMap, "typed": wideTyped} {
		t.Run(name, func(t *testing.T) {
			var out bytes.Buffer
			var elapsed time.Duration
			allocated := allocatedBy(func() {
				elapsed = logWithin(t, 10*time.Second, func() {
					jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Reflect("wide", wide), zap.String("detail", credentialText))
				})
			})
			assert.Less(t, elapsed, 2*time.Second)
			assert.Less(t, allocated, uint64(1<<20), "a value of a million entries was copied")
			assert.Contains(t, out.String(), `"wide":"`+redactedTooLarge+`"`)
			requireRedacted(t, "the field next to it", out.String())
		})
	}
}

// The allowance is one for the whole value: what a map holds is counted with what the
// slices in it hold, and the first entry past the allowance is the one that is not read.
func TestRedactingCoreCountsTheEntriesOfAWholeValueAgainstOneAllowance(t *testing.T) {
	read := func(value any) string {
		var out bytes.Buffer
		jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Reflect("doc", value))
		return out.String()
	}
	fill := func(n int) []any {
		entries := make([]any, n)
		for i := range entries {
			entries[i] = "x"
		}
		entries[0] = credentialText
		return entries
	}

	t.Run("the allowance is read in full", func(t *testing.T) {
		out := read(fill(maxRedactNodes))
		assert.NotContains(t, out, redactedTooLarge)
		requireRedacted(t, "a slice of exactly the allowance", out)
	})
	t.Run("one entry more is not read", func(t *testing.T) {
		assert.Contains(t, read(fill(maxRedactNodes+1)), redactedTooLarge)
	})
	t.Run("two slices that fit apart and not together", func(t *testing.T) {
		half := maxRedactNodes/2 + 1
		assert.Contains(t, read(map[string]any{"a": fill(half), "b": fill(half)}), redactedTooLarge)
		assert.NotContains(t, read(map[string]any{"a": fill(half)}), redactedTooLarge)
	})
	t.Run("a document of ordinary size is read in full", func(t *testing.T) {
		doc := map[string]any{}
		for i := range 100 {
			doc["key"+strconv.Itoa(i)] = map[string]any{"items": fill(20), "name": "n"}
		}
		out := read(doc)
		assert.NotContains(t, out, redactedTooLarge)
		assert.NotContains(t, out, "hunter2")
	})
}

// opaqueHeaders hold no credential that Redact could find: a header is a credential by
// its name.
func opaqueHeaders() http.Header {
	return http.Header{
		"Cookie":               {"theme=dark"},
		"Set-Cookie":           {"id=" + opaqueSecret},
		"X-Api-Token":          {opaqueSecret},
		"X-Amz-Security-Token": {opaqueSecret},
		"X-Session-Token":      {opaqueSecret},
		"Accept":               {"text/plain"},
		"Content-Type":         {"application/json"},
	}
}

type namedString string

type envVar struct {
	Name  string `json:"name"`
	Value string `json:"value,omitempty"`
}

type login struct {
	User     string
	Token    string
	Endpoint string `json:"endpoint"`
	APIKey   string `json:"api_key"`
	Retries  int
}

// resourceInfo holds no name that is a credential.
type resourceInfo struct {
	Name      string
	Namespace string
	Replicas  int
}

type nested struct {
	Request  login
	Response *login
	Headers  http.Header
}

func TestRedactingCoreRedactsTheTypedValuesAJSONDocumentWouldNotHold(t *testing.T) {
	for name, tc := range map[string]struct {
		field   zap.Field
		absent  []string
		present []string
	}{
		"http.Header, by shape": {
			field:   zap.Any("headers", http.Header{"Authorization": {"Bearer abc123def456ghi789"}, "Content-Type": {"application/json"}}),
			absent:  []string{"abc123def456ghi789"},
			present: []string{`"Authorization":["[REDACTED]"]`, `"Content-Type":["application/json"]`},
		},
		"http.Header, by the name of the header": {
			field:  zap.Any("headers", opaqueHeaders()),
			absent: []string{opaqueSecret, "theme=dark"},
			present: []string{
				`"Cookie":["[REDACTED]"]`, `"Set-Cookie":["[REDACTED]"]`, `"X-Api-Token":["[REDACTED]"]`,
				`"X-Amz-Security-Token":["[REDACTED]"]`, `"X-Session-Token":["[REDACTED]"]`,
				`"Accept":["text/plain"]`, `"Content-Type":["application/json"]`,
			},
		},
		"url.Values": {
			field:   zap.Any("query", url.Values{"api_key": {opaqueSecret}, "password": {"hunter2"}, "limit": {"500"}}),
			absent:  []string{opaqueSecret, "hunter2"},
			present: []string{`"api_key":["[REDACTED]"]`, `"password":["[REDACTED]"]`, `"limit":["500"]`},
		},
		"map of lists of strings": {
			field:   zap.Any("headers", map[string][]string{"X-Api-Key": {opaqueSecret}, "Accept": {"text/plain"}}),
			absent:  []string{opaqueSecret},
			present: []string{`"X-Api-Key":["[REDACTED]"]`, `"Accept":["text/plain"]`},
		},
		"a named string, by shape": {
			field:   zap.Any("detail", namedString(credentialText)),
			absent:  credentialValues(),
			present: []string{"[REDACTED]"},
		},
		"a slice of named strings": {
			field:   zap.Any("details", []namedString{credentialText, "fine"}),
			absent:  credentialValues(),
			present: []string{"[REDACTED]", `"fine"`},
		},
		"a map of named strings": {
			field:   zap.Any("details", map[string]namedString{"a": credentialText, "token": opaqueSecret, "b": "fine"}),
			absent:  append(credentialValues(), opaqueSecret),
			present: []string{`"token":"[REDACTED]"`, `"b":"fine"`},
		},
		"a pointer to a named string": {
			field:   zap.Any("detail", new(namedString(credentialText))),
			absent:  credentialValues(),
			present: []string{"[REDACTED]"},
		},
		"a struct, by the name of its fields": {
			field:   zap.Any("login", login{User: "jane", Token: opaqueSecret, Endpoint: "https://host/x", APIKey: opaqueSecret, Retries: 3}),
			absent:  []string{opaqueSecret},
			present: []string{`"Token":"[REDACTED]"`, `"api_key":"[REDACTED]"`, `"User":"jane"`, `"endpoint":"https://host/x"`, `"Retries":3`},
		},
		"a pointer to a struct, by shape": {
			field:   zap.Any("login", &login{User: credentialText}),
			absent:  credentialValues(),
			present: []string{"[REDACTED]"},
		},
		"structs that hold structs, pointers and headers": {
			field: zap.Any("call", nested{
				Request:  login{User: "jane", Token: opaqueSecret},
				Response: &login{APIKey: opaqueSecret},
				Headers:  opaqueHeaders(),
			}),
			absent:  []string{opaqueSecret, "theme=dark"},
			present: []string{`"User":"jane"`, `"Accept":["text/plain"]`, `"Token":"[REDACTED]"`, `"api_key":"[REDACTED]"`},
		},
		"environment variables as structs": {
			field:   zap.Any("env", []envVar{{Name: "DB_PASSWORD", Value: opaqueSecret}, {Name: "LOG_LEVEL", Value: "debug"}}),
			absent:  []string{opaqueSecret},
			present: []string{`{"name":"DB_PASSWORD","value":"[REDACTED]"}`, `{"name":"LOG_LEVEL","value":"debug"}`},
		},
		"environment variables as maps of strings": {
			field:   zap.Any("env", []map[string]string{{"name": "DB_PASSWORD", "value": opaqueSecret}, {"name": "LOG_LEVEL", "value": "debug"}}),
			absent:  []string{opaqueSecret},
			present: []string{`{"name":"DB_PASSWORD","value":"[REDACTED]"}`, `{"name":"LOG_LEVEL","value":"debug"}`},
		},
		"environment variables as a document": {
			field:   zap.Any("env", []any{map[string]any{"name": "DB_PASSWORD", "value": opaqueSecret}, map[string]any{"Key": "api_key", "Value": opaqueSecret}}),
			absent:  []string{opaqueSecret},
			present: []string{`{"name":"DB_PASSWORD","value":"[REDACTED]"}`, `{"Key":"api_key","Value":"[REDACTED]"}`},
		},
		"a pair whose name is harmless is read by shape": {
			field:   zap.Any("env", []envVar{{Name: "DATABASE_URL", Value: "password=hunter2"}}),
			absent:  []string{"hunter2"},
			present: []string{`{"name":"DATABASE_URL","value":"password=[REDACTED]"}`},
		},
		"a pair with no value is left alone": {
			field:   zap.Any("ref", map[string]any{"configMapKeyRef": map[string]any{"name": "app-config", "key": "password"}}),
			present: []string{`"configMapKeyRef":{"key":"password","name":"app-config"}`},
		},
		"raw JSON, by shape and by name": {
			field:   zap.Reflect("raw", json.RawMessage(`{"Authorization":"Bearer abc123def456ghi789","password":"`+opaqueSecret+`","ok":1}`)),
			absent:  append(credentialValues(), opaqueSecret),
			present: []string{`"password":"[REDACTED]"`, `"ok":1`},
		},
		"typed values inside a document": {
			field:   zap.Any("doc", map[string]any{"headers": opaqueHeaders(), "list": []any{login{Token: opaqueSecret}}, "n": 1}),
			absent:  []string{opaqueSecret},
			present: []string{`"Accept":["text/plain"]`, `"Token":"[REDACTED]"`, `"n":1`},
		},
		"a number keeps the digits it was written with": {
			field: zap.Any("doc", struct {
				Big   uint64
				Token string
			}{Big: 18446744073709551615, Token: opaqueSecret}),
			absent:  []string{opaqueSecret},
			present: []string{`"Big":18446744073709551615`, `"Token":"[REDACTED]"`},
		},
	} {
		t.Run(name, func(t *testing.T) {
			var out bytes.Buffer
			jsonLogger(&out, zapcore.DebugLevel, true).Info("m", tc.field, zap.Int("count", 3))
			for _, value := range tc.absent {
				assert.NotContains(t, out.String(), value)
			}
			for _, fragment := range tc.present {
				assert.Contains(t, out.String(), fragment)
			}
			assert.Contains(t, out.String(), `"count":3`)
		})
	}
}

// What holds nothing to hide is written as the bare core writes it, byte for byte: the
// field order of a struct, the digits of a number, its pointers.
func TestRedactingCoreWritesTypedValuesThatHoldNothingToHideAsTheCoreDoes(t *testing.T) {
	fields := func() []zap.Field {
		return []zap.Field{
			zap.Any("headers", http.Header{"Content-Type": {"application/json"}, "Accept": {"text/plain"}}),
			zap.Any("query", url.Values{"limit": {"500"}, "watch": {"true"}}),
			zap.Any("named", namedString("kube-system")),
			zap.Any("names", []namedString{"a", "b"}),
			zap.Any("struct", resourceInfo{Name: "coredns", Namespace: "kube-system", Replicas: 2}),
			zap.Any("pointer", &resourceInfo{Name: "coredns"}),
			zap.Any("env", []envVar{{Name: "LOG_LEVEL", Value: "debug"}}),
			zap.Reflect("raw", json.RawMessage(`{"ok": true,  "n": 1.50}`)),
			zap.Reflect("ints", []int{1, 2, 3}),
			zap.Any("matrix", [][]float64{{1, 2.5}, {3}}),
			zap.Any("html", map[string]string{"a": "<b>&</b>"}),
			zap.Any("time", struct{ At time.Time }{time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)}),
			zap.Any("bytes", []byte("not text")),
			zap.Any("nil pointer", (*resourceInfo)(nil)),
			zap.Any("empty", struct{}{}),
		}
	}
	var plain, redacting bytes.Buffer
	jsonLogger(&plain, zapcore.DebugLevel, false).Info("message", fields()...)
	jsonLogger(&redacting, zapcore.DebugLevel, true).Info("message", fields()...)
	assert.Equal(t, plain.String(), redacting.String())
	assert.Contains(t, redacting.String(), `"At":"2026-11-20T10:00:00Z"`, "the sample must hold what the comparison is about")
}

// Under the name of a credential a value that is not a plain scalar is hidden whole, as
// it was, whatever its type.
func TestRedactingCoreHidesATypedValueUnderTheNameOfACredential(t *testing.T) {
	var out bytes.Buffer
	jsonLogger(&out, zapcore.DebugLevel, true).Info("m",
		zap.Any("authorization", http.Header{"X": {opaqueSecret}}),
		zap.Any("token", namedString(opaqueSecret)),
		zap.Any("credentials", login{User: "jane", Token: opaqueSecret}),
		zap.Any("secret_count", namedCount(3)),
	)
	assert.NotContains(t, out.String(), opaqueSecret)
	assert.NotContains(t, out.String(), "jane")
	assert.Contains(t, out.String(), `"authorization":"[REDACTED]"`)
	assert.Contains(t, out.String(), `"token":"[REDACTED]"`)
	assert.Contains(t, out.String(), `"credentials":"[REDACTED]"`)
	assert.Contains(t, out.String(), `"secret_count":3`, "a number has no text to hide")
}

type namedCount int

// A marshaler can write a typed value through AddReflected, and a typed value nested in
// a document that a marshaler writes is read in the same way.
type typedObject struct{}

func (typedObject) MarshalLogObject(enc zapcore.ObjectEncoder) error {
	if err := enc.AddReflected("headers", opaqueHeaders()); err != nil {
		return err
	}
	if err := enc.AddReflected("env", []envVar{{Name: "DB_PASSWORD", Value: opaqueSecret}}); err != nil {
		return err
	}
	return enc.AddReflected("authorization", http.Header{"X": {opaqueSecret}})
}

type typedArray struct{}

func (typedArray) MarshalLogArray(enc zapcore.ArrayEncoder) error {
	return enc.AppendReflected(login{Token: opaqueSecret, User: "jane"})
}

func TestRedactingCoreRedactsTheTypedValuesAMarshalerWrites(t *testing.T) {
	var out bytes.Buffer
	jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Object("o", typedObject{}), zap.Array("a", typedArray{}))
	assert.NotContains(t, out.String(), opaqueSecret)
	for _, want := range []string{
		`"Cookie":["[REDACTED]"]`, `"Accept":["text/plain"]`, `{"name":"DB_PASSWORD","value":"[REDACTED]"}`,
		`"authorization":"[REDACTED]"`, `"Token":"[REDACTED]"`, `"User":"jane"`,
	} {
		assert.Contains(t, out.String(), want)
	}
}

// A value is not read when its text, as JSON, passes the limit; neither is one with more
// entries than the allowance. What is under the limit is, and nothing else is changed.
func TestRedactingCoreReadsATypedValueOnlyUpToALimit(t *testing.T) {
	big := make([]envVar, 3000)
	for i := range big {
		big[i] = envVar{Name: "LOG_LEVEL_" + strconv.Itoa(i), Value: strings.Repeat("v", 20)}
	}
	huge := struct{ Blob string }{Blob: strings.Repeat("x", maxRedactBytes+1)}
	under := struct{ Blob string }{Blob: strings.Repeat("x", maxRedactBytes/2) + " " + credentialText}

	var out bytes.Buffer
	logger := jsonLogger(&out, zapcore.DebugLevel, true)
	logger.Info("big", zap.Any("env", big))
	assert.NotContains(t, out.String(), redactedTooLarge, "three thousand entries that hold nothing to hide are written")
	assert.Contains(t, out.String(), `"name":"LOG_LEVEL_2999"`)

	out.Reset()
	logger.Info("huge", zap.Any("v", huge), zap.Reflect("ints", make([]int, maxRedactNodes+1)))
	assert.Equal(t, 2, strings.Count(out.String(), redactedTooLarge))
	assert.Less(t, out.Len(), 512)

	out.Reset()
	logger.Info("under", zap.Any("v", under))
	requireRedacted(t, "a value under the limit", out.String())
	assert.NotContains(t, out.String(), redactedTooLarge)
}

// The limit on the JSON of a value is on its length, and a value of exactly that length
// is read: {"Blob":"..."} is 11 bytes longer than its text.
func TestRedactingCoreReadsAValueWhoseJSONIsExactlyTheLimitAndNotOneByteMore(t *testing.T) {
	const overhead = len(`{"Blob":""}`)
	blob := func(jsonLength int) struct{ Blob string } {
		text := jsonLength - overhead
		return struct{ Blob string }{Blob: strings.Repeat("x", text-len(credentialText)-1) + " " + credentialText}
	}
	logger := func(out *bytes.Buffer) *zap.Logger { return jsonLogger(out, zapcore.DebugLevel, true) }

	var out bytes.Buffer
	logger(&out).Info("at the limit", zap.Any("v", blob(maxRedactBytes)))
	requireRedacted(t, "a value at the limit", out.String())
	assert.NotContains(t, out.String(), redactedTooLarge)

	out.Reset()
	logger(&out).Info("one more", zap.Any("v", blob(maxRedactBytes+1)))
	assert.Contains(t, out.String(), `"v":"`+redactedTooLarge+`"`)

	out.Reset()
	logger(&out).Info("as many entries as are read", zap.Reflect("ints", make([]int, maxRedactNodes)))
	assert.NotContains(t, out.String(), redactedTooLarge)
}

type loginAttempt struct {
	Retries int
	Name    string
}

type attempts struct {
	Credentials loginAttempt
	Ready       bool
}

// A number under the name of a credential has no text to hide, and keeps its digits.
func TestRedactingCoreKeepsANumberInATypedValueUnderTheNameOfACredential(t *testing.T) {
	var out bytes.Buffer
	jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Any("call", attempts{Credentials: loginAttempt{Retries: 3, Name: "jane"}, Ready: true}))
	assert.NotContains(t, out.String(), "jane")
	assert.Contains(t, out.String(), `"Retries":3`)
	assert.Contains(t, out.String(), `"Name":"[REDACTED]"`)
	assert.Contains(t, out.String(), `"Ready":true`)
}

// Raw bytes are one string to JSON, however many there are: raw JSON of more bytes than a
// walk may read entries is read.
func TestRedactingCoreCountsRawBytesAsOneString(t *testing.T) {
	raw := json.RawMessage(`{"note":"` + strings.Repeat("x", 3*maxRedactNodes) + ` ` + credentialText + `"}`)
	var out bytes.Buffer
	jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Reflect("raw", raw))
	assert.NotContains(t, out.String(), redactedTooLarge)
	requireRedacted(t, "raw JSON", out.String())
}

// A map is a pair when it has a name and a value, however many other entries it has: the
// allowance of the walk bounds the cost, not a guess at how small a pair is.
func TestRedactingCoreReadsAPairInAMapOfAnySize(t *testing.T) {
	doc := map[string]any{"name": "DB_PASSWORD", "value": opaqueSecret}
	for i := range 50 {
		doc["field"+strconv.Itoa(i)] = i
	}
	var out bytes.Buffer
	jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Reflect("env", doc))
	assert.NotContains(t, out.String(), opaqueSecret)
	assert.Contains(t, out.String(), `"value":"[REDACTED]"`)
	assert.Contains(t, out.String(), `"field49":49`)
}

// A chain of structs longer than json allows a value to be nested is reported by zap as
// an error of its own, which holds no text of the value, and the core gets there in no
// more time than zap does.
func TestRedactingCoreWritesTheErrorOfATypedValueNestedPastWhatJSONAllows(t *testing.T) {
	type link struct {
		Token string `json:"token"`
		Next  *link  `json:"n"`
	}
	var head *link
	for range 10_500 {
		head = &link{Token: opaqueSecret, Next: head}
	}
	var bare, wrapped bytes.Buffer
	jsonLogger(&bare, zapcore.DebugLevel, false).Info("m", zap.Any("chain", head), zap.String("after", "kept"))
	elapsed := logWithin(t, 10*time.Second, func() {
		jsonLogger(&wrapped, zapcore.DebugLevel, true).Info("m", zap.Any("chain", head), zap.String("after", "kept"))
	})
	assert.Less(t, elapsed, 2*time.Second)
	assert.Equal(t, bare.String(), wrapped.String())
	assert.Contains(t, wrapped.String(), `"chainError":"exceeded max depth"`)
	assert.NotContains(t, wrapped.String(), opaqueSecret)
}

// A document that cannot be read is not written: it is not known to be clean. What json
// writes can always be read, so the test gives the function data that json did not write.
func TestRedactingCoreDoesNotWriteADocumentItCannotRead(t *testing.T) {
	walk := redactWalk{entries: maxRedactNodes, tooLarge: false, err: nil}
	redacted, changed := redactDocument(login{Token: opaqueSecret}, []byte(`{"Token": "`+opaqueSecret), 0, &walk)
	assert.True(t, changed)
	assert.Equal(t, redactedTooDeep, redacted)

	redacted, changed = redactDocument(resourceInfo{Name: "coredns"}, []byte(`{"Name":"coredns"}`), 0, &walk)
	assert.False(t, changed, "a document that holds nothing is left as it came")
	assert.Equal(t, resourceInfo{Name: "coredns"}, redacted)
}

// A value that holds no word of the lists and nothing with the shape of a credential is
// marshalled and no more: it is not read as a document, which would cost a good deal
// more than writing it.
func TestRedactingCoreDoesNotReadATypedValueThatHoldsNothingThatCouldMatter(t *testing.T) {
	skipAllocationCountsUnderTheRaceDetector(t)
	clean := http.Header{"Accept": {"text/plain"}, "Content-Type": {"application/json"}, "Cache-Control": {"no-cache"}}
	marshalled := testing.AllocsPerRun(200, func() { _, _ = json.Marshal(clean) })
	reflected := testing.AllocsPerRun(200, func() { _, _, _ = redactReflected(clean, false) })
	assert.LessOrEqual(t, reflected, marshalled+2, "marshalling costs %v allocations, redacting the value %v", marshalled, reflected)

	withWord := http.Header{"Accept": {"text/plain"}, "X-Api-Token": {opaqueSecret}}
	read := testing.AllocsPerRun(200, func() { _, _, _ = redactReflected(withWord, false) })
	assert.Greater(t, read, marshalled+10, "a value that holds a word is read as a document")
}

type badJSON struct{}

func (badJSON) MarshalJSON() ([]byte, error) {
	return nil, errors.New("cannot encode: " + credentialText)
}

// A value that cannot be written as JSON is reported by zap in a field of its own, named
// for the key and Error, with the text of the error: and that text is the text of the
// failing marshaler, which can hold anything.
func TestRedactingCoreRedactsTheErrorThatZapWritesForAValueItCannotMarshal(t *testing.T) {
	var bare, wrapped bytes.Buffer
	fields := func() []zap.Field {
		return []zap.Field{
			zap.Any("x", badJSON{}),
			zap.Any("doc", map[string]any{"c": make(chan int)}),
			zap.Any("fine", "kept"),
		}
	}
	jsonLogger(&bare, zapcore.DebugLevel, false).Info("m", fields()...)
	jsonLogger(&wrapped, zapcore.DebugLevel, true).Info("m", fields()...)

	require.Contains(t, bare.String(), `"xError":"json: error calling MarshalJSON for type `, "the sample must reproduce what zap writes")
	require.Contains(t, bare.String(), `cannot encode: `+credentialText)
	requireRedacted(t, "the error of a failed marshal", wrapped.String())
	assert.Contains(t, wrapped.String(), `"xError":"json: error calling MarshalJSON for type `)
	assert.Contains(t, wrapped.String(), `cannot encode: Authorization: [REDACTED] ; password=[REDACTED] ; [REDACTED]"`)
	assert.Contains(t, wrapped.String(), `"docError":"json: unsupported type: chan int"`, "what holds nothing is written as zap writes it")
	assert.Contains(t, wrapped.String(), `"fine":"kept"`)
}

func TestRedactingCoreRedactsTheErrorOfAValueAMarshalerCannotWrite(t *testing.T) {
	var out bytes.Buffer
	jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Object("o", reflectingBadObject{}))
	requireRedacted(t, "the error of a failed marshal", out.String())
	assert.Contains(t, out.String(), `"oError":"json: error calling MarshalJSON for type `)
	assert.Contains(t, out.String(), `cannot encode: Authorization: [REDACTED] ; password=[REDACTED] ; [REDACTED]"`)
}

type reflectingBadObject struct{}

func (reflectingBadObject) MarshalLogObject(enc zapcore.ObjectEncoder) error {
	return enc.AddReflected("bad", badJSON{})
}

// The same value, found under the name of a credential, is hidden before it is marshalled,
// and what it would have said is not written.
func TestRedactingCoreDoesNotMarshalAValueItHides(t *testing.T) {
	var out bytes.Buffer
	jsonLogger(&out, zapcore.DebugLevel, true).Info("m", zap.Any("token", badJSON{}))
	assert.JSONEq(t, `{"level":"info","msg":"m","token":"[REDACTED]"}`, out.String())
}

func BenchmarkRedactingCoreReflectedValues(b *testing.B) {
	doc := map[string]any{
		"request": map[string]any{"method": "GET", "path": "/api/v1/pods", "labels": []any{"a", "b", "c"}},
		"items":   []any{map[string]any{"name": "a", "n": 1}, map[string]any{"name": "b", "n": 2}},
		"headers": map[string]string{"accept": "text/plain"},
	}
	for name, value := range map[string]any{
		"document":      doc,
		"typed headers": http.Header{"Accept": {"text/plain"}, "Content-Type": {"application/json"}},
		"typed struct":  login{User: "jane", Endpoint: "https://host/x", Retries: 3},
		"typed secrets": opaqueHeaders(),
	} {
		for _, wrap := range []bool{false, true} {
			label := name + "/unwrapped"
			if wrap {
				label = name + "/redacting"
			}
			b.Run(label, func(b *testing.B) {
				logger := jsonLogger(io.Discard, zapcore.DebugLevel, wrap)
				b.ReportAllocs()
				for range b.N {
					logger.Info("m", zap.Any("value", value))
				}
			})
		}
	}
}
