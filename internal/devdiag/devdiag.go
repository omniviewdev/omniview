// Package devdiag sanitizes diagnostics that carry command or tool output before
// they reach typed errors, persisted launch status or logs. Every producer of such
// text (the controller's graph, the supervisor's launch commands, the host's managed
// plugin builder and the SDK verifier) goes through the same redactor so that a
// credential removed in one place cannot survive in another.
package devdiag

import (
	"os"
	"regexp"
	"strings"
)

// MaxBytes bounds the text Safe returns: its tail, where the go command and the
// compilers print the failing line.
const MaxBytes = 8192

const redacted = "[REDACTED]"

// Placeholder is the text that takes the place of a credential, in the text Redact
// returns and wherever else a caller replaces a value it knows to be one.
const Placeholder = redacted

// optionalSeparator stands, in keyWords and nameWords, for "an underscore, a hyphen or
// nothing".
const optionalSeparator = `[_-]?`

// keyWords are the words that mark a key as holding a credential: the one list
// behind both the key=value pattern below, which looks for them in text, and
// SensitiveKey, which looks for them in the name of a field. They are written as a
// regexp alternation in lower case, with optionalSeparator where a separator may be.
// A word added here is found by both; it also has to be added to startsCredential
// (prefilter.go), which only tells the two when to bother looking.
const keyWords = `token|password|passwd|secret|authorization|api` + optionalSeparator + `key|access` +
	optionalSeparator + `key|credential|signature`

// nameWords are the words that mark the NAME of a field as holding a credential and
// that the key=value pattern does not look for. They are in the same form as keyWords.
// In a name they say what the field holds: a private key, the key or the certificate of
// a kubeconfig user, a whole kubeconfig, a cookie. In text they are ordinary words
// ("loading kubeconfig: stat ...", "setting a cookie: ..."), and Redact, which
// apperror.PublicText shares, would blank the sentence after them. A word added here is
// found by SensitiveKey only; it also has to be added to startsNameWord (prefilter.go).
//
// The public half of a kubeconfig, certificate-authority-data, is not in the list.
const nameWords = `private` + optionalSeparator + `key|client` + optionalSeparator + `key` + optionalSeparator +
	`data|client` + optionalSeparator + `certificate` + optionalSeparator + `data|cookie|kube` + optionalSeparator + `config`

// The patterns Redact applies. Each is also described, as the least it needs in
// order to match, in couldCarryCredential (prefilter.go): a new pattern, or a new
// word in one of these, has to be added there too, or Redact stops running it.
var (
	// Credentials in a URL authority. The class is greedy up to the LAST '@' before
	// the path, so a password that itself contains an unescaped '@' cannot leak the
	// remainder after its first '@'.
	urlUserinfo = regexp.MustCompile(`(?i)([a-z][a-z0-9+.-]*://)[^/\s"']*@`)
	// Query strings routinely carry tokens (signatures, API keys, access tokens).
	// The query of every URL is dropped; its path is kept because module proxy
	// failures are undiagnosable without it.
	urlQuery = regexp.MustCompile(`(://[^\s"'?#]*\?)[^\s"']*`)
	bearer   = regexp.MustCompile(`(?i)\b(bearer\s+)[^\s"',;]+`)
	// A secret-looking key, optionally quoted (JSON), with its value. The key may
	// carry a prefix (access_token, GITHUB_TOKEN, x-api-key). The words are keyWords.
	keyValue = regexp.MustCompile(`(?i)\b([a-z0-9_.-]*(?:` + keyWords + `)["']?\s*[:=]\s*["']?)(?:(?:bearer|basic)\s+)?[^\s,;"']+`)
	// Credentials with a recognizable shape wherever they appear, including URL
	// paths: GitHub and GitLab tokens, Slack tokens, AWS access key IDs, JWTs.
	tokenShape = regexp.MustCompile(`\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b`)
)

// Redact removes credentials from text without bounding it. Truncate only after
// redacting, never before: a cut through the middle of a URL would otherwise
// leave a credential without the scheme that identifies it.
//
// Text that cannot match any pattern is returned as it is, without running them
// (see couldCarryCredential): the log sinks call Redact for every record.
func Redact(text string) string {
	if !couldCarryCredential(text) {
		return text
	}
	return redactPatterns(text)
}

// redactPatterns applies every pattern, in this order, to text.
func redactPatterns(text string) string {
	text = urlUserinfo.ReplaceAllString(text, "${1}"+redacted+"@")
	text = urlQuery.ReplaceAllString(text, "${1}"+redacted)
	text = bearer.ReplaceAllString(text, "${1}"+redacted)
	text = keyValue.ReplaceAllString(text, "${1}"+redacted)
	return tokenShape.ReplaceAllString(text, redacted)
}

// Tail returns the last limit bytes of text, marked with a leading "..." when it
// had to cut. Redact first.
func Tail(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return "..." + strings.ToValidUTF8(text[len(text)-limit:], "")
}

// Safe sanitizes command or compiler output for a diagnostic: credentials are
// removed (including the values of secret-named environment variables), the
// workspace root and home directory are replaced by placeholders, and only the
// last MaxBytes remain. An empty root is not replaced.
func Safe(text, root string) string {
	text = Redact(text)
	for _, entry := range os.Environ() {
		key, value, ok := strings.Cut(entry, "=")
		key = strings.ToLower(key)
		if ok && len(value) >= 4 && (strings.Contains(key, "token") || strings.Contains(key, "secret") || strings.Contains(key, "password") || strings.Contains(key, "api_key")) {
			text = strings.ReplaceAll(text, value, redacted)
		}
	}
	if root != "" {
		text = strings.ReplaceAll(text, root, "$WORKSPACE")
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		text = strings.ReplaceAll(text, home, "$HOME")
	}
	if len(text) > MaxBytes {
		text = strings.ToValidUTF8(text[len(text)-MaxBytes:], "")
	}
	return strings.TrimSpace(text)
}
