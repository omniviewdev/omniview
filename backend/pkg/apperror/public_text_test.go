package apperror

import (
	"os"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestPublicTextKeepsASentence(t *testing.T) {
	for _, sentence := range []string{
		// The Kubernetes plugin's fixed sentences (omniview-plugin-kubernetes, pkg/plugin/resource/errors.go).
		"The requested resource or API group was not found.",
		"You do not have permission to perform this resource operation.",
		"The resource operation conflicts with the current cluster state.",
		"The cluster did not complete the request in time.",
		"The resource listing continuation has expired. Start a new listing.",
		"The cluster certificate could not be verified.",
		// Names, versions, ports and API paths are not secrets.
		`Container "app" is not in this pod.`,
		"Helm repository is not configured: bitnami",
		"Pod my-extremely-long-deployment-name-7d9f8b6c5d-x7k2p was not found in namespace production.",
		"The server returned 503 for GET /api/v1/pods on port 6443.",
		"Check your kubeconfig credentials",
		"Précis : le délai est dépassé (délai 30 s).",
	} {
		got, ok := PublicText(sentence, 512)
		if !ok || got != sentence {
			t.Errorf("%q: got %q, %v", sentence, got, ok)
		}
	}
}

func TestPublicTextCleansWhatCannotBeShown(t *testing.T) {
	for name, tc := range map[string]struct{ in, want string }{
		"C0 controls and DEL":        {"Request\x00 timed\x07 out\x7f.", "Request timed out."},
		"C1 controls":                {"Request\u0080 timed\u009f out.", "Request timed out."},
		"white space of every kind":  {"Request\ttimed\v\f\r\nout.\u00a0\u2028Again\u3000now.", "Request timed out. Again now."},
		"a CSI escape, whole":        {"\x1b[31;1mRequest failed\x1b[0m", "Request failed"},
		"an OSC title, whole":        {"\x1b]0;you have been hacked\x07Request failed", "Request failed"},
		"an OSC with a string term.": {"\x1b]8;;https://evil.example\x1b\\Request failed", "Request failed"},
		"an 8-bit CSI":               {"\u009b31mRequest failed\u009b0m", "Request failed"},
		"a character-set escape":     {"\x1b(BRequest failed", "Request failed"},
		"a one-byte escape":          {"\x1b7Request failed\x1b8", "Request failed"},
		"a DCS string":               {"\x1bPq#0;2;0;0;0\x1b\\Request failed", "Request failed"},
		"an APC string":              {"\x1b_secret payload\x1b\\Request failed", "Request failed"},
		"an 8-bit OSC":               {"\u009d0;evil\u009cRequest failed", "Request failed"},
		"an unterminated OSC":        {"Request failed\x1b]0;evil title with no end", "Request failed"},
		"bidi overrides":             {"The \u202eecnatsni\u202c was not found.", "The ecnatsni was not found."},
		"bidi isolates and marks":    {"a\u2066b\u2069c\u200ed\u200fe\u061cf", "abcdef"},
		"zero-width characters":      {"time\u200b\u200c\u200d\u2060\ufeffout", "timeout"},
		"tag characters":             {"Request\U000e0001\U000e0041\U000e007f failed", "Request failed"},
		"private use":                {"Request\ue000 failed", "Request failed"},
		"a soft hyphen":              {"time\u00adout", "timeout"},
		"runs of spaces":             {"  Request     failed.   ", "Request failed."},
	} {
		got, ok := PublicText(tc.in, 512)
		if !ok || got != tc.want {
			t.Errorf("%s: PublicText(%q) = %q, %v; want %q", name, tc.in, got, ok, tc.want)
		}
	}
}

func TestPublicTextRefusesWhatIsNotASentence(t *testing.T) {
	for name, in := range map[string]string{
		"empty":                    "",
		"only white space":         " \t\r\n ",
		"only controls":            "\x00\x01\x02\x1b[0m",
		"only invisible":           "\u200b\u202e\u2060",
		"no letter or digit":       "…—…",
		"invalid UTF-8":            "Request \xff failed",
		"longer than the bound":    strings.Repeat("a ", maxPublicTextBytes/2+1),
		"a lone surrogate encoded": "Request \xed\xa0\x80 failed",
	} {
		if got, ok := PublicText(in, 512); ok {
			t.Errorf("%s: admitted %q as %q", name, in, got)
		}
	}
	if _, ok := PublicText("Request failed.", 1); ok {
		t.Error("a bound too small to hold a sentence admitted one")
	}
}

func TestPublicTextCutsToTheBoundOnARuneBoundary(t *testing.T) {
	got, ok := PublicText(strings.Repeat("é", 600), 512)
	if !ok || utf8.RuneCountInString(got) != 512 || !strings.HasSuffix(got, "…") || !utf8.ValidString(got) {
		t.Fatalf("cut wrongly: %d runes, valid=%v, ok=%v", utf8.RuneCountInString(got), utf8.ValidString(got), ok)
	}
	// The ellipsis never follows a space: the cut falls after "abcdefgh ".
	got, _ = PublicText("abcdefgh ijkl", 10)
	if got != "abcdefgh…" {
		t.Fatalf("got %q", got)
	}
	// At the bound exactly, nothing is cut.
	exact := strings.Repeat("word ", 102) + "ab"
	if got, ok := PublicText(exact, 512); !ok || got != exact {
		t.Fatalf("a sentence of exactly the bound was changed: %d runes", utf8.RuneCountInString(got))
	}
}

// What the host already treats as a credential (internal/devdiag.Redact), plus
// what a kubeconfig or a home directory puts in an error.
func TestPublicTextRefusesSecretsAndHomePaths(t *testing.T) {
	home, _ := os.UserHomeDir()
	for name, in := range map[string]string{
		"a bearer token":               "The request failed: Bearer abcdefghijklmnop was rejected.",
		"a token pair":                 "Request failed (token=abc123def456)",
		"a password pair":              "Login failed with password: hunter2",
		"an api key pair":              "Invalid api_key=ABCD1234",
		"an authorization header":      "Authorization: Basic dXNlcjpwYXNz",
		"a JWT":                        "Token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U was rejected",
		"a GitHub token":               "clone failed for ghp_abcdefghijklmnopqrstuvwxyz0123456789",
		"an AWS access key id":         "key AKIAIOSFODNN7EXAMPLE is invalid",
		"a URL with userinfo":          "Could not reach https://admin:s3cret@cluster.example.com/api",
		"a URL with a query":           "Could not reach https://cluster.example.com/api?sig=abcdef",
		"a PEM block":                  "tls: -----BEGIN PRIVATE KEY----- MIIEvQIBADANBg -----END PRIVATE KEY-----",
		"a certificate block":          "bad -----BEGIN CERTIFICATE----- MIIC -----END CERTIFICATE-----",
		"kubeconfig client key":        "invalid client-key-data: LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVk",
		"kubeconfig client cert":       `{"client-certificate-data":"LS0t"}`,
		"kubeconfig authority":         "certificate-authority-data = abc",
		"kubeconfig current context":   "current-context: prod",
		"kubeconfig header":            "kind: Config apiVersion: v1 clusters: - cluster: server: https://10.0.0.1",
		"a base64 blob":                "bad data LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUM2akNDQWRLZ0F3SUJBZ0lCQURBTkJna3Foa2lHOXcw",
		"a hex digest":                 "image digest 3f2a9c4b1d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a",
		"a macOS home path":            "failed to read /Users/alice/.kube/config",
		"a Linux home path":            "failed to read /home/bob/.kube/config",
		"a Windows home path":          `failed to read C:\Users\carol\.kube\config`,
		"a Windows home path, slashed": "failed to read c:/users/carol/.kube/config",
		"a tilde path":                 "failed to read ~/.kube/config",
		"a tilde path in quotes":       `failed to read "~/.kube/config"`,
		"a HOME reference":             "failed to read $HOME/.kube/config",
		"a profile variable":           `failed to read %USERPROFILE%\.kube\config`,
		"a file URL":                   "failed to read file:///etc/kubernetes/admin.conf",
		"a secret split by zero-width": "Request failed (tok\u200ben=abc123def456)",
		"a secret hidden by controls":  "Request failed (pass\x00word=hunter2)",
		"a secret behind an escape":    "Request failed (\x1b[0mtoken=abc123def456)",
	} {
		if got, ok := PublicText(in, 512); ok {
			t.Errorf("%s: admitted %q as %q", name, in, got)
		}
	}
	if len(home) > 2 {
		if got, ok := PublicText("failed to read "+home+"/notes.txt", 512); ok {
			t.Errorf("the running user's home directory was admitted: %q", got)
		}
	}
}

// A refusal must not hinge on where the secret sits: a secret in the part that a
// cut would remove still marks the whole text as not a sentence.
func TestPublicTextRefusesASecretBeyondTheCut(t *testing.T) {
	in := strings.Repeat("word ", 40) + "token=abc123def456"
	if got, ok := PublicText(in, 64); ok {
		t.Fatalf("admitted %q", got)
	}
}

func TestPublicTextIsIdempotent(t *testing.T) {
	for _, in := range []string{
		"The cluster did not complete the request in time.",
		"\x1b[31mRequest\u200b\ttimed  out\x1b[0m\n",
		strings.Repeat("é", 600),
	} {
		once, ok := PublicText(in, 512)
		if !ok {
			t.Fatalf("refused %q", in)
		}
		twice, ok := PublicText(once, 512)
		if !ok || twice != once {
			t.Errorf("not idempotent: %q then %q", once, twice)
		}
	}
}
