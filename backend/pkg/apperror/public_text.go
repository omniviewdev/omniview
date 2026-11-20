package apperror

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/omniviewdev/omniview/internal/devdiag"
)

// maxPublicTextBytes is the longest string PublicText will look at. A longer one is
// not a sentence, and is refused before any pattern runs over it.
const maxPublicTextBytes = 4096

var (
	// Terminal escape sequences: CSI, the string sequences (OSC, DCS, SOS, PM, APC) up
	// to their terminator, the escapes with intermediate bytes (a character set) and the
	// one-byte escapes, and the 8-bit C1 forms (a string needs its terminator there: a
	// lone C1 character is only dropped). They are removed whole: dropping only the
	// control byte would leave their parameters on screen as text.
	terminalEscape = regexp.MustCompile("\x1b(?:\\[[0-?]*[ -/]*[@-~]|[\\]PX^_][^\x07\x1b]*(?:\x07|\x1b\\\\)?|[ -/]*[0-~])|\u009b[0-?]*[ -/]*[@-~]|[\u0090\u0098\u009d\u009e\u009f][^\u009c\x07]*(?:\u009c|\x07)")

	// A PEM block of any kind: a key, a certificate, a request.
	pemBlock = regexp.MustCompile(`-----BEGIN [A-Z0-9 ]+-----`)

	// The keys of a kubeconfig (and of the credential helpers it names) followed by a
	// separator, and the header of the file itself. The word "kubeconfig" in prose is
	// fine; a key with its value is a fragment of the file.
	kubeconfigFragment = regexp.MustCompile(`(?i)(?:client-certificate-data|client-key-data|certificate-authority-data|client-certificate|client-key|certificate-authority|current-context|insecure-skip-tls-verify|auth-provider|access-token|refresh-token|id-token)["']?\s*[:=]|\bkind\s*:\s*config\b`)

	// Long opaque runs: embedded certificate or key material, digests, ids. The same
	// two shapes the host already scrubs from crash reports (backend/pkg/plugin/manager.go,
	// sensitivePattern).
	opaqueRun = regexp.MustCompile(`[A-Za-z0-9+/]{40,}={0,2}|[0-9a-fA-F]{32,}`)

	// A path under a user's home directory, however it is written. The directory of
	// the running user is checked separately, by value.
	homePath = regexp.MustCompile(`(?:^|[^A-Za-z0-9_.-])(?:/Users/|/home/|~[/\\])|(?i:[a-z]:[/\\]users[/\\])|(?i:\$HOME\b|\$\{HOME\}|%USERPROFILE%|%HOMEPATH%|file://)`)
)

// PublicText admits one string of provider-authored text into an error shown to a
// user. It returns the text cleaned for display and true, or "" and false when the
// text must not be shown at all; the caller then uses its own words.
//
// Cleaning: terminal escape sequences are removed whole; control, format (bidi,
// zero-width, tag), private-use and unassigned characters are dropped; every kind of
// white space becomes one space; the result is cut to maxRunes (with an ellipsis).
//
// Refusal: text that is not valid UTF-8 or longer than 4096 bytes; text with no
// letter or digit left; text that carries a credential or a path into a user's home
// directory. Credentials are recognised by the redactor the host already uses for
// command and tool output (internal/devdiag), plus PEM blocks, kubeconfig fragments
// and long opaque runs. The patterns run on the cleaned text, so a secret split by
// zero-width characters is still seen.
//
// This is a filter, not a guarantee: free text cannot be proved clean. What keeps
// provider text safe is where it is shown (never in chrome that decides anything,
// never for denial classes, never to an agent) and that it is bounded. PublicText is
// the last gate in front of the user, not the only one.
func PublicText(value string, maxRunes int) (string, bool) {
	if maxRunes < 2 || len(value) > maxPublicTextBytes || !utf8.ValidString(value) {
		return "", false
	}
	cleaned := cleanText(terminalEscape.ReplaceAllString(value, ""))
	if !strings.ContainsFunc(cleaned, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) {
		return "", false
	}
	if carriesSecretOrHomePath(cleaned) {
		return "", false
	}
	if utf8.RuneCountInString(cleaned) <= maxRunes {
		return cleaned, true
	}
	cut := []rune(cleaned)[:maxRunes-1]
	return strings.TrimRightFunc(string(cut), unicode.IsSpace) + "…", true
}

// cleanText drops what cannot be shown and collapses white space.
func cleanText(value string) string {
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range value {
		switch {
		case unicode.IsSpace(r):
			b.WriteByte(' ')
		case unicode.IsPrint(r):
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func carriesSecretOrHomePath(text string) bool {
	if devdiag.Redact(text) != text {
		return true
	}
	if pemBlock.MatchString(text) || kubeconfigFragment.MatchString(text) || opaqueRun.MatchString(text) || homePath.MatchString(text) {
		return true
	}
	if home, err := os.UserHomeDir(); err == nil && len(home) > 2 {
		return strings.Contains(text, home) || strings.Contains(text, filepath.ToSlash(home))
	}
	return false
}
