package marks

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
)

// The sizes of a nonce, in bytes of text.
const (
	minNonce = 16
	maxNonce = 128
	// nonceEntropy is how many random bytes NewNonce uses: 128 bits.
	nonceEntropy = 16
	// secretText is what a nonce prints as, whatever prints it.
	secretText = "«secret»"
)

// ErrBadNonce is the error of a nonce that is not acceptable. It never holds the nonce.
var ErrBadNonce = errors.New("marks: a nonce is 16 to 128 printable ASCII bytes without ';' or a space")

// Nonce is the secret of a session: the shell integration script keeps it and prints it inside its own marks, and a
// mark without it is not believed. It prints as «secret» from every verb, as JSON and in a log. The one way to read it
// is Reveal, for the code that hands it to the script.
type Nonce struct{ v string }

// NewNonce makes a nonce of 128 random bits.
func NewNonce() (Nonce, error) {
	var b [nonceEntropy]byte
	if _, err := rand.Read(b[:]); err != nil {
		return Nonce{v: ""}, fmt.Errorf("marks: no random bytes for a nonce: %w", err)
	}
	return Nonce{v: hex.EncodeToString(b[:])}, nil
}

// ParseNonce makes a nonce of s, which is 16 to 128 bytes of ASCII between '!' and '~' without ';' (the byte that
// ends a field of a mark). The error does not say s.
func ParseNonce(s string) (Nonce, error) {
	if len(s) < minNonce || len(s) > maxNonce {
		return Nonce{v: ""}, ErrBadNonce
	}
	for i := range len(s) {
		if c := s[i]; c <= ' ' || c > '~' || c == ';' {
			return Nonce{v: ""}, ErrBadNonce
		}
	}
	return Nonce{v: s}, nil
}

// Reveal returns the secret, for the code that gives it to the integration script. Nothing else calls it.
func (n Nonce) Reveal() string { return n.v }

// IsZero says whether there is no nonce: a scanner with none trusts no mark.
func (n Nonce) IsZero() bool { return n.v == "" }

// Format prints «secret» whatever the verb.
func (n Nonce) Format(f fmt.State, _ rune) { _, _ = f.Write([]byte(secretText)) }

// String is «secret».
func (n Nonce) String() string { return secretText }

// GoString is «secret».
func (n Nonce) GoString() string { return secretText }

// MarshalJSON is "«secret»".
func (n Nonce) MarshalJSON() ([]byte, error) { return []byte(`"` + secretText + `"`), nil }

// MarshalText is «secret».
func (n Nonce) MarshalText() ([]byte, error) { return []byte(secretText), nil }

// LogValue is «secret».
func (n Nonce) LogValue() slog.Value { return slog.StringValue(secretText) }
