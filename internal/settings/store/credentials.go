package store

import (
	"bytes"
	"encoding/json"
	"math/big"
	"reflect"
	"strings"
)

// credentialClassifier says whether the stored value of the setting with the
// given ID is a credential: a value whose old bytes must not stay in the file
// once it is gone.
type credentialClassifier func(id string) bool

// ordinaryCredentials classifies a plugin's stored values by the IDs of its
// ordinary settings: every other value is a credential, as it is for an uninstall.
// With no ordinary IDs (nothing is remembered about the plugin) every value is.
func ordinaryCredentials(ordinary map[string]struct{}) credentialClassifier {
	return func(id string) bool {
		_, isOrdinary := ordinary[id]
		return !isOrdinary
	}
}

// credentialsDied reports whether storing next in place of the document old
// (next is nil when the document is removed) destroys a credential: a value the
// classifier calls a credential that was set and is now gone or different. A
// value that was empty had nothing to leak, so setting a password for the first
// time is not one. A document that cannot be read may hold anything, so it counts.
//
// bbolt is copy-on-write: the page that held old is freed, not wiped, so each of
// these writes leaves the old bytes in the file.
func credentialsDied(old, next []byte, isCredential credentialClassifier) bool {
	if len(old) == 0 {
		return false
	}
	var before map[string]json.RawMessage
	if err := json.Unmarshal(old, &before); err != nil {
		return true
	}
	var after map[string]json.RawMessage
	if next != nil && json.Unmarshal(next, &after) != nil {
		after = nil
	}
	for id, was := range before {
		if !isCredential(id) || isEmptyValue(was) {
			continue
		}
		if now, kept := after[id]; !kept || !sameJSON(was, now) {
			return true
		}
	}
	return false
}

// isEmptyValue reports whether a stored value is JSON null or an empty string.
func isEmptyValue(raw json.RawMessage) bool {
	return bytes.Equal(raw, []byte("null")) || bytes.Equal(raw, []byte(`""`))
}

// maxExactNumberText bounds the numbers whose values equalNumbers works out.
const maxExactNumberText = 128

// sameJSON reports whether two encoded values are equal, as bytes or as values.
// Numbers are compared exactly, not as float64: two integers that differ in their
// last digits above 2^53 are different values.
func sameJSON(a, b json.RawMessage) bool {
	if bytes.Equal(a, b) {
		return true
	}
	left, leftOK := decodeExact(a)
	right, rightOK := decodeExact(b)
	return leftOK && rightOK && equalValues(left, right)
}

// decodeExact decodes a value with its numbers kept as text.
func decodeExact(raw json.RawMessage) (any, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, false
	}
	return value, true
}

// equalValues compares decoded values, numbers by value (see equalNumbers).
func equalValues(a, b any) bool {
	switch left := a.(type) {
	case json.Number:
		right, ok := b.(json.Number)
		return ok && equalNumbers(left, right)
	case map[string]any:
		right, ok := b.(map[string]any)
		if !ok || len(left) != len(right) {
			return false
		}
		for key, value := range left {
			other, found := right[key]
			if !found || !equalValues(value, other) {
				return false
			}
		}
		return true
	case []any:
		right, ok := b.([]any)
		if !ok || len(left) != len(right) {
			return false
		}
		for i := range left {
			if !equalValues(left[i], right[i]) {
				return false
			}
		}
		return true
	default:
		return reflect.DeepEqual(a, b)
	}
}

// equalNumbers reports whether two JSON numbers are the same number: 1234 and
// 1234.0 are, 9007199254740992 and 9007199254740993 are not. A number with an
// exponent, or a very long one, is not worked out and counts as different, which
// costs a scrub and nothing else.
func equalNumbers(a, b json.Number) bool {
	if a == b {
		return true
	}
	if len(a) > maxExactNumberText || len(b) > maxExactNumberText || strings.ContainsAny(string(a)+string(b), "eE") {
		return false
	}
	left, leftOK := new(big.Rat).SetString(string(a))
	right, rightOK := new(big.Rat).SetString(string(b))
	return leftOK && rightOK && left.Cmp(right) == 0
}
