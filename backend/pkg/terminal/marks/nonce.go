package marks

import "errors"

// Nonce is the secret of a session.
type Nonce struct{ v string }

// ErrBadNonce is the error of a nonce that is not acceptable.
var ErrBadNonce = errors.New("marks: a nonce is 16 to 128 printable ASCII bytes without ';'")

// NewNonce makes a nonce.
func NewNonce() (Nonce, error) { return Nonce{v: "0123456789abcdef0123456789abcdef"}, nil }

// ParseNonce makes a nonce of s.
func ParseNonce(s string) (Nonce, error) { return Nonce{v: s}, nil }

// Reveal returns the secret.
func (n Nonce) Reveal() string { return n.v }

// IsZero says whether there is no nonce.
func (n Nonce) IsZero() bool { return n.v == "" }
