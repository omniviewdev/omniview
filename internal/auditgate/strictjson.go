package auditgate

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"unicode"
	"unicode/utf8"
)

// maxJSONDepth bounds container nesting in a runtime request. Real calls nest
// a handful of levels; a limit this low also removes parser-depth edge cases.
const maxJSONDepth = 32

// checkStrictJSON validates a whole JSON text the way the request evaluator
// needs it: well-formed UTF-8 JSON with exactly one top-level value, at most
// maxJSONDepth nested containers, and no object, at any depth, that repeats a
// key or holds two keys that Go's encoding/json would treat as the same field
// (it matches keys by Unicode simple case folding and keeps the last
// duplicate). Rejecting those texts removes every ambiguity between how the
// gateway and the upstream decoder read the same bytes.
//
// It returns an empty Reason when the text is acceptable.
func checkStrictJSON(data []byte) Reason {
	if bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}) {
		return ReasonMalformedJSON
	}
	if !utf8.Valid(data) {
		return ReasonInvalidUTF8
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	if reason := strictValue(dec, 0); reason != "" {
		return reason
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return ReasonTrailingData
	}
	return ""
}

// strictValue consumes one value, including the closing delimiter of a
// container, and reports the first violation it finds.
func strictValue(dec *json.Decoder, depth int) Reason {
	token, err := dec.Token()
	if err != nil {
		return ReasonMalformedJSON
	}
	delim, isContainer := token.(json.Delim)
	if !isContainer {
		return ""
	}
	if depth >= maxJSONDepth {
		return ReasonTooDeep
	}
	var reason Reason
	switch delim {
	case '{':
		reason = strictObject(dec, depth)
	case '[':
		reason = strictArray(dec, depth)
	default:
		return ReasonMalformedJSON
	}
	if reason != "" {
		return reason
	}
	if _, err = dec.Token(); err != nil {
		return ReasonMalformedJSON
	}
	return ""
}

func strictObject(dec *json.Decoder, depth int) Reason {
	var keys keySet
	for dec.More() {
		token, err := dec.Token()
		if err != nil {
			return ReasonMalformedJSON
		}
		key, isString := token.(string)
		if !isString {
			return ReasonMalformedJSON
		}
		if reason := keys.add(key); reason != "" {
			return reason
		}
		if reason := strictValue(dec, depth+1); reason != "" {
			return reason
		}
	}
	return ""
}

func strictArray(dec *json.Decoder, depth int) Reason {
	for dec.More() {
		if reason := strictValue(dec, depth+1); reason != "" {
			return reason
		}
	}
	return ""
}

// smallKeyLimit is how many keys an object may have before keySet switches
// from pairwise comparison to hashing.
const smallKeyLimit = 32

// keySet detects duplicate keys and keys that Go's decoder would merge. Small
// objects, the common case, compare pairwise with strings.EqualFold, the
// comparison encoding/json uses to match object keys to struct fields. Large
// objects switch to maps so a hostile body cannot make the check quadratic.
type keySet struct {
	small  []string
	exact  map[string]struct{}
	folded map[string]struct{}
}

// add records key and returns the reason it must be rejected, if any.
func (s *keySet) add(key string) Reason {
	if s.exact == nil {
		for _, other := range s.small {
			if other == key {
				return ReasonDuplicateKey
			}
			if strings.EqualFold(other, key) {
				return ReasonCaseFoldedKey
			}
		}
		s.small = append(s.small, key)
		if len(s.small) > smallKeyLimit {
			s.promote()
		}
		return ""
	}
	if _, dup := s.exact[key]; dup {
		return ReasonDuplicateKey
	}
	fold := foldKey(key)
	if _, dup := s.folded[fold]; dup {
		return ReasonCaseFoldedKey
	}
	s.exact[key] = struct{}{}
	s.folded[fold] = struct{}{}
	return ""
}

func (s *keySet) promote() {
	s.exact = make(map[string]struct{}, len(s.small))
	s.folded = make(map[string]struct{}, len(s.small))
	for _, key := range s.small {
		s.exact[key] = struct{}{}
		s.folded[foldKey(key)] = struct{}{}
	}
	s.small = nil
}

// foldKey maps a key to the representative of its Unicode simple case-folding
// class, so two keys collide exactly when strings.EqualFold calls them equal.
// That includes the non-ASCII members of a class, for example U+212A KELVIN
// SIGN folding to "k" and U+017F LATIN SMALL LETTER LONG S folding to "s".
func foldKey(key string) string {
	var b strings.Builder
	b.Grow(len(key))
	for _, r := range key {
		b.WriteRune(foldRune(r))
	}
	return b.String()
}

func foldRune(r rune) rune {
	smallest := r
	for f := unicode.SimpleFold(r); f != r; f = unicode.SimpleFold(f) {
		smallest = min(smallest, f)
	}
	return smallest
}
