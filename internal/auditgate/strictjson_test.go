package auditgate

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestCheckStrictJSON(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		reason Reason
	}{
		{"object", `{"a":1}`, ""},
		{"scalar", `7`, ""},
		{"string", `"x"`, ""},
		{"array of objects reuses keys across siblings", `[{"id":1},{"id":2},{"id":3}]`, ""},
		{"nested objects reuse keys across levels", `{"a":{"a":{"a":1}}}`, ""},
		{"keys differing only by case in different objects", `{"x":{"Name":1},"y":{"name":2}}`, ""},
		{"escaped and literal spellings that differ", `{"a":1,"\u0062":2}`, ""},
		{"surrounding whitespace", " \t\r\n{\"a\":1}\n ", ""},
		{"empty containers", `{"a":{},"b":[],"c":[{}]}`, ""},

		{"duplicate key", `{"a":1,"a":2}`, ReasonDuplicateKey},
		{"duplicate key after an escape", `{"a":1,"\u0061":2}`, ReasonDuplicateKey},
		{"duplicate key in a nested array object", `{"a":[{"k":1,"k":2}]}`, ReasonDuplicateKey},
		{"duplicate empty key", `{"":1,"":2}`, ReasonDuplicateKey},
		{"case folded keys", `{"a":1,"A":2}`, ReasonCaseFoldedKey},
		{"case folded keys with a sharp s variant", `{"s":1,"\u017f":2}`, ReasonCaseFoldedKey},
		{"case folded greek sigma forms", `{"\u03c3":1,"\u03c2":2}`, ReasonCaseFoldedKey},
		{"case folded keys in a nested object", `{"o":{"b":1,"B":2}}`, ReasonCaseFoldedKey},

		{"empty input", ``, ReasonMalformedJSON},
		{"only whitespace", `  `, ReasonMalformedJSON},
		{"byte order mark", "\xef\xbb\xbf{}", ReasonMalformedJSON},
		{"invalid utf-8", "{\"a\":\"\xff\"}", ReasonInvalidUTF8},
		{"trailing value", `{} {}`, ReasonTrailingData},
		{"trailing comma", `[1,]`, ReasonMalformedJSON},
		{"unterminated array", `[1,2`, ReasonMalformedJSON},
		{"mismatched closers", `{"a":[1}`, ReasonMalformedJSON},
		{"bare key", `{a:1}`, ReasonMalformedJSON},
		{"unquoted literal", `{"a":nul}`, ReasonMalformedJSON},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.reason, checkStrictJSON([]byte(tt.input)))
		})
	}
}

func TestCheckStrictJSONDepthLimit(t *testing.T) {
	nest := func(depth int) string {
		return strings.Repeat("[", depth) + strings.Repeat("]", depth)
	}
	require.Equal(t, Reason(""), checkStrictJSON([]byte(nest(maxJSONDepth))))
	require.Equal(t, ReasonTooDeep, checkStrictJSON([]byte(nest(maxJSONDepth+1))))
	require.Equal(t, ReasonTooDeep, checkStrictJSON([]byte(nest(100000))))

	objects := strings.Repeat(`{"k":`, maxJSONDepth) + `1` + strings.Repeat(`}`, maxJSONDepth)
	require.Equal(t, Reason(""), checkStrictJSON([]byte(objects)))
	objects = strings.Repeat(`{"k":`, maxJSONDepth+1) + `1` + strings.Repeat(`}`, maxJSONDepth+1)
	require.Equal(t, ReasonTooDeep, checkStrictJSON([]byte(objects)))
}

// foldKey must agree with the comparison encoding/json uses to match object
// keys (bytes.EqualFold), otherwise a key pair that Go merges could slip past.
func TestFoldKeyAgreesWithEqualFold(t *testing.T) {
	samples := []string{
		"", "a", "A", "object", "Object", "OBJECT", "args", "ARGS", "argS", "arg\u017f", "k", "K", "\u212a",
		"methodID", "methodid", "METHODID", "call-id", "CALL-ID", "\u03c3", "\u03c2", "\u03a3", "\u01c4", "\u01c5", "\u01c6",
		"i", "I", "\u0130", "\u0131", "\u00df", "SS", "ss", "x y", "x Y", "\u00e9", "\u00c9", "e\u0301",
	}
	for _, a := range samples {
		for _, b := range samples {
			require.Equal(t, strings.EqualFold(a, b), foldKey(a) == foldKey(b), "%q vs %q", a, b)
		}
	}
}

// Objects past the pairwise-comparison limit switch to hashing; both modes
// must find the same violations, and a wide hostile object must stay cheap.
func TestCheckStrictJSONWideObjects(t *testing.T) {
	object := func(count int, extra ...string) string {
		members := make([]string, 0, count+len(extra))
		for i := range count {
			members = append(members, `"key`+strconv.Itoa(i)+`":`+strconv.Itoa(i))
		}
		members = append(members, extra...)
		return `{` + strings.Join(members, ",") + `}`
	}
	counts := []int{1, smallKeyLimit - 1, smallKeyLimit, smallKeyLimit + 1, smallKeyLimit + 2, 4 * smallKeyLimit}
	for _, count := range counts {
		require.Equal(t, Reason(""), checkStrictJSON([]byte(object(count))), "%d keys", count)
		require.Equal(t, ReasonDuplicateKey, checkStrictJSON([]byte(object(count, `"key0":0`))), "%d keys", count)
		require.Equal(t, ReasonCaseFoldedKey, checkStrictJSON([]byte(object(count, `"KEY0":0`))), "%d keys", count)
		require.Equal(t, ReasonCaseFoldedKey, checkStrictJSON([]byte(object(count, `"\u212aey0":0`))), "%d keys", count)
	}

	start := time.Now()
	require.Equal(t, Reason(""), checkStrictJSON([]byte(object(50_000))))
	require.Less(t, time.Since(start), 5*time.Second, "checking a wide object must not be quadratic")
}
