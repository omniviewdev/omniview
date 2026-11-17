package gateway

import (
	"encoding/base64"
)

// Credential wire format. Usernames and secrets have one fixed shape, so the
// whole Authorization header has one fixed length and parsing it cannot be
// made to do variable work.
const (
	// usernameLength is the length of a credential's username: 16 lower-case
	// hexadecimal digits chosen at random per credential.
	usernameLength = 16
	// secretLength is the length of a credential's secret: the unpadded
	// base64url text of 256 random bits.
	secretLength = 43

	basicScheme         = "Basic "
	credentialsLength   = usernameLength + 1 + secretLength
	encodedLength       = credentialsLength / 3 * 4
	authorizationLength = len(basicScheme) + encodedLength
)

// The decoded credentials must encode without padding, or encodedLength would
// not be exact. A remainder makes this constant negative, which does not
// compile.
const _ = uint(0 - credentialsLength%3)

// parseBasic extracts the username and secret, in that order, from the values
// of the Authorization header. It accepts exactly one header whose text is
// "Basic " (any ASCII case), then the standard base64 of "username:secret", and
// nothing else: no second header, no other scheme, no padding, whitespace or
// trailing text, no username or secret of another shape. Anything that is not
// exactly that is refused without being interpreted further. The last result
// reports whether the header was accepted.
func parseBasic(values []string) (string, string, bool) {
	if len(values) != 1 {
		return "", "", false
	}
	value := values[0]
	if len(value) != authorizationLength || !asciiEqualFold(value[:len(basicScheme)], basicScheme) {
		return "", "", false
	}
	var decoded [credentialsLength]byte
	n, err := base64.StdEncoding.Strict().Decode(decoded[:], []byte(value[len(basicScheme):]))
	if err != nil || n != credentialsLength || decoded[usernameLength] != ':' {
		return "", "", false
	}
	name, key := decoded[:usernameLength], decoded[usernameLength+1:]
	if !allBytes(name, isLowerHex) || !allBytes(key, isBase64URL) {
		return "", "", false
	}
	return string(name), string(key), true
}

func asciiEqualFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range len(a) {
		x, y := a[i], b[i]
		if 'A' <= x && x <= 'Z' {
			x += 'a' - 'A'
		}
		if 'A' <= y && y <= 'Z' {
			y += 'a' - 'A'
		}
		if x != y {
			return false
		}
	}
	return true
}

func allBytes(b []byte, ok func(byte) bool) bool {
	for _, c := range b {
		if !ok(c) {
			return false
		}
	}
	return true
}

func isLowerHex(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')
}

func isBase64URL(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_'
}
