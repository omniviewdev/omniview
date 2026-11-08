package gateway

import (
	"strings"
	"testing"
)

func TestPairingCodesAreUniformOverTheAlphabet(t *testing.T) {
	counts := map[byte]int{}
	const codes = 4000
	for range codes {
		code, err := newPairingCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != pairingCodeLength {
			t.Fatalf("code %q has %d symbols", code, len(code))
		}
		for i := range len(code) {
			if strings.IndexByte(pairingAlphabet, code[i]) < 0 {
				t.Fatalf("symbol %q is outside the alphabet", code[i])
			}
			counts[code[i]]++
		}
	}
	if len(counts) != len(pairingAlphabet) {
		t.Fatalf("%d of %d symbols ever drawn", len(counts), len(pairingAlphabet))
	}
	// 64000 draws over 32 symbols: each expects 2000. Allow generous slack;
	// a modulo-biased or truncated source would be far outside it.
	for symbol, n := range counts {
		if n < 1700 || n > 2300 {
			t.Errorf("symbol %q drawn %d times, want about 2000", symbol, n)
		}
	}
	if strings.ContainsAny(pairingAlphabet, "01IO") {
		t.Error("the alphabet contains look-alike symbols")
	}
}

func TestPairingCodeFormatting(t *testing.T) {
	if got := groupPairingCode("ABCDEFGHJKLMNPQR"); got != "ABCD-EFGH-JKLM-NPQR" {
		t.Fatalf("grouped = %q", got)
	}
	code, ok := normalizePairingCode(" abcd-efgh JKLM-npqr ")
	if !ok || code != "ABCDEFGHJKLMNPQR" {
		t.Fatalf("normalized = %q %v", code, ok)
	}
	for _, bad := range []string{"", "ABCD", "ABCDEFGHJKLMNPQ", "ABCDEFGHJKLMNPQRS", "ABCDEFGHJKLMNPQ0", "ABCDEFGHJKLMNPQI", "ABCD_EFGHJKLMNPQ"} {
		if got, good := normalizePairingCode(bad); good || got != placeholderCode() {
			t.Errorf("normalize(%q) = %q %v, want the placeholder", bad, got, good)
		}
	}
}

func FuzzNormalizePairingCode(f *testing.F) {
	for _, seed := range []string{"", "ABCD-EFGH-JKLM-NPQR", "abcdefghjklmnpqr", strings.Repeat("A", 64), "A B C D", "\xff", "AAAA-AAAA-AAAA-AAAA-"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		code, ok := normalizePairingCode(input)
		if len(code) != pairingCodeLength {
			t.Fatalf("normalize(%q) returned %d symbols: later steps rely on a fixed length", input, len(code))
		}
		for i := range len(code) {
			if strings.IndexByte(pairingAlphabet, code[i]) < 0 {
				t.Fatalf("normalize(%q) returned %q", input, code)
			}
		}
		if !ok {
			if code != placeholderCode() {
				t.Fatalf("a rejected input returned %q, not the placeholder", code)
			}
			return
		}
		// A code accepted from any spelling is the same code when displayed
		// and typed back.
		again, ok := normalizePairingCode(groupPairingCode(code))
		if !ok || again != code {
			t.Fatalf("%q does not survive grouping", code)
		}
	})
}
