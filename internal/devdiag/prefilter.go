package devdiag

import "strings"

// The first bytes of the UTF-8 encodings of the long s (U+017F) and the Kelvin sign
// (U+212A).
const (
	longSLead  = 0xC5
	kelvinLead = 0xE2
)

// couldCarryCredential is the cheap test in front of the patterns in devdiag.go.
// It reports whether text holds what at least one of them needs in order to match.
// false is exact: no pattern can match, so Redact returns text as it is. true only
// says that the patterns have to run.
//
// The log sinks call Redact for every message and every field. The patterns cost
// about 16 µs on a short line that holds nothing and 140 ns for each byte of a long
// one; this costs a few ns a byte and allocates nothing.
//
// What each pattern needs:
//   - urlUserinfo and urlQuery: "://", and an '@' or a '?'.
//   - bearer: the word bearer.
//   - keyValue: one of its words, and a ':' or '=' for the separator after it.
//   - tokenShape: one of its prefixes.
//
// The patterns that ignore case fold more than ASCII: a long s (U+017F) is an s and
// the Kelvin sign (U+212A) is a k. Those two are the only characters outside ASCII
// that fold onto a letter, and they count here as the letters they stand for.
func couldCarryCredential(text string) bool {
	if strings.Contains(text, "://") && strings.ContainsAny(text, "@?") {
		return true
	}
	return containsCredentialStart(text, strings.ContainsAny(text, ":="))
}

// containsCredentialStart reports whether some position of text starts a word or a
// prefix that a pattern needs (startsCredential). separator tells whether the text
// has a ':' or '=' anywhere; SensitiveKey, whose keys carry none, passes true.
func containsCredentialStart(text string, separator bool) bool {
	for i := range len(text) {
		// Only the bytes startsCredential can accept are worth the call: the first
		// byte of a word, of a prefix, or of the two characters outside ASCII.
		switch text[i] {
		case 'a', 'A', 'b', 'B', 'c', 'C', 'e', 'g', 'p', 'P', 's', 'S', 't', 'T', 'x', longSLead, kelvinLead:
			if startsCredential(text[i:], separator) {
				return true
			}
		}
	}
	return false
}

// startsCredential reports whether s starts with a word or a prefix that a pattern
// needs. separator tells whether the text has a ':' or '=' anywhere.
func startsCredential(s string, separator bool) bool {
	switch s[0] | 0x20 { // folds ASCII case; no other byte becomes a letter
	case 'a':
		return strings.HasPrefix(s, "AKIA") ||
			separator && (hasPrefixFold(s, "authorization") || startsKeyName(s, "api") || startsKeyName(s, "access"))
	case 'b':
		return hasPrefixFold(s, "bearer")
	case 'c':
		return separator && hasPrefixFold(s, "credential")
	case 'e':
		return strings.HasPrefix(s, "eyJ")
	case 'g':
		return len(s) > 3 && s[1] == 'h' && s[3] == '_' && strings.IndexByte("pousr", s[2]) >= 0 ||
			strings.HasPrefix(s, "github_pat_") || strings.HasPrefix(s, "glpat-")
	case 'p':
		return separator && (hasPrefixFold(s, "password") || hasPrefixFold(s, "passwd"))
	case 's':
		return separator && (hasPrefixFold(s, "secret") || hasPrefixFold(s, "signature"))
	case 't':
		return separator && hasPrefixFold(s, "token")
	case 'x':
		return len(s) > 4 && s[1] == 'o' && s[2] == 'x' && strings.IndexByte("abprs", s[3]) >= 0 && s[4] == '-'
	}
	return strings.HasPrefix(s, "\u017f") || strings.HasPrefix(s, "\u212a")
}

// startsKeyName reports whether s starts with word, an optional '_' or '-', and key,
// in any case: api_key, API-KEY, accesskey.
func startsKeyName(s, word string) bool {
	if !hasPrefixFold(s, word) {
		return false
	}
	s = s[len(word):]
	if s != "" && (s[0] == '_' || s[0] == '-') {
		s = s[1:]
	}
	return hasPrefixFold(s, "key")
}

// hasPrefixFold reports whether s starts with lower, ignoring ASCII case. lower
// must be lower case.
func hasPrefixFold(s, lower string) bool {
	if len(s) < len(lower) {
		return false
	}
	for i := range len(lower) {
		c := s[i]
		if 'A' <= c && c <= 'Z' {
			c += 'a' - 'A'
		}
		if c != lower[i] {
			return false
		}
	}
	return true
}
