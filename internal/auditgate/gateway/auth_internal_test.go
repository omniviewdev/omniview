package gateway

import (
	"encoding/base64"
	"strings"
	"testing"
	"unicode/utf8"
)

const (
	testUsername = "0123456789abcdef"
	testSecret   = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ" // 43 characters
)

func basic(username, secret string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+secret))
}

func TestParseBasicAcceptsExactlyOneWellFormedHeader(t *testing.T) {
	valid := basic(testUsername, testSecret)
	if len(valid) != authorizationLength {
		t.Fatalf("test setup: header is %d bytes, want %d", len(valid), authorizationLength)
	}
	username, secret, ok := parseBasic([]string{valid})
	if !ok || username != testUsername || secret != testSecret {
		t.Fatalf("parseBasic(valid) = %q %q %v", username, secret, ok)
	}

	rejected := map[string][]string{
		"no header":          nil,
		"empty list":         {},
		"empty value":        {""},
		"two headers":        {valid, valid},
		"two different":      {valid, basic(testUsername, strings.Repeat("B", 43))},
		"bearer":             {"Bearer " + testSecret},
		"basic prefix only":  {"Basic "},
		"no space":           {"Basic" + strings.TrimPrefix(valid, "Basic ")},
		"tab separator":      {"Basic\t" + strings.TrimPrefix(valid, "Basic ")},
		"two spaces":         {"Basic  " + strings.TrimPrefix(valid, "Basic ")},
		"trailing space":     {valid + " "},
		"trailing newline":   {valid + "\n"},
		"padding":            {valid + "="},
		"unpadded short":     {valid[:len(valid)-1]},
		"secret too short":   {basic(testUsername, testSecret[:42])},
		"user too short":     {basic(testUsername[:15], testSecret)},
		"user too long":      {basic(testUsername+"0", testSecret[:42])},
		"upper case hex":     {basic(strings.ToUpper(testUsername), testSecret)},
		"non hex user":       {basic("0123456789abcdeg", testSecret)},
		"secret with plus":   {basic(testUsername, strings.Repeat("+", 43))},
		"secret with slash":  {basic(testUsername, strings.Repeat("/", 43))},
		"secret with equals": {basic(testUsername, strings.Repeat("=", 43))},
		"extra colon":        {basic(testUsername, "x"+testSecret[2:]+":")},
		"no colon":           {"Basic " + base64.StdEncoding.EncodeToString([]byte(testUsername+"x"+testSecret))},
		"huge":               {valid + strings.Repeat("A", 1<<20)},
		"nul":                {"Basic " + strings.Repeat("\x00", encodedLength)},
	}
	for name, values := range rejected {
		if username, secret, ok = parseBasic(values); ok {
			t.Errorf("%s: accepted as %q %q", name, username, secret)
		}
	}

	for _, scheme := range []string{"basic ", "BASIC ", "bAsIc "} {
		if _, _, ok = parseBasic([]string{scheme + strings.TrimPrefix(valid, "Basic ")}); !ok {
			t.Errorf("scheme %q rejected", scheme)
		}
	}
}

func FuzzParseBasic(f *testing.F) { //nolint:gocognit // A fuzz target states every invariant in one place.
	valid := basic(testUsername, testSecret)
	for _, seed := range []string{
		valid, strings.ToLower(valid), valid + "=", valid[:len(valid)-2], "", "Basic ", "Bearer x",
		basic(testUsername, strings.Repeat("-", 43)), basic(strings.Repeat("f", 16), strings.Repeat("_", 43)),
		"Basic " + strings.Repeat("A", encodedLength), "Basic " + strings.Repeat("=", encodedLength),
	} {
		f.Add(seed, "")
	}
	f.Add(valid, valid)
	f.Fuzz(func(t *testing.T, first, second string) {
		username, secret, ok := parseBasic([]string{first})
		if _, _, both := parseBasic([]string{first, second}); both {
			t.Fatal("two Authorization headers were accepted")
		}
		if !ok {
			if username != "" || secret != "" {
				t.Fatalf("rejected input returned %q %q", username, secret)
			}
			return
		}
		// An accepted header has exactly the canonical shape and round-trips.
		if len(first) != authorizationLength || !utf8.ValidString(first) {
			t.Fatalf("accepted a header of %d bytes", len(first))
		}
		if len(username) != usernameLength || !allBytes([]byte(username), isLowerHex) {
			t.Fatalf("accepted username %q", username)
		}
		if len(secret) != secretLength || !allBytes([]byte(secret), isBase64URL) {
			t.Fatalf("accepted secret %q", secret)
		}
		if !strings.EqualFold(first[:len(basicScheme)], basicScheme) || first[len(basicScheme):] != basic(username, secret)[len(basicScheme):] {
			t.Fatalf("accepted %q does not re-encode from %q %q", first, username, secret)
		}
	})
}
