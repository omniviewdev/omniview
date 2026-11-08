package devdiag

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRedactRemovesCredentialsAndKeepsTheDiagnostic(t *testing.T) {
	for name, test := range map[string]struct {
		in      string
		secrets []string
		keep    []string
	}{
		"password with an unescaped at sign": {
			in:      `Get "https://user:p@ss@word@proxy.example.com/github.com/omniviewdev/plugin-sdk/@v/list": dial tcp: refused`,
			secrets: []string{"p@ss", "ss@word", "word@proxy", "user:"},
			keep:    []string{"proxy.example.com/github.com/omniviewdev/plugin-sdk/@v/list", "dial tcp: refused"},
		},
		"user-only credential": {in: "fetching https://ghp_0123456789abcdefghijklmnop@github.com/org/repo.git", secrets: []string{"0123456789abcdef"}, keep: []string{"github.com/org/repo.git"}},
		"query token":          {in: "GET https://example.com/a/b?access_token=abc123secret&x=1 failed", secrets: []string{"abc123secret", "x=1"}, keep: []string{"https://example.com/a/b?", "failed"}},
		"query signature":      {in: "GET https://bucket.example.com/m.zip?X-Amz-Signature=deadbeefcafe&X-Amz-Expires=60 404", secrets: []string{"deadbeefcafe"}, keep: []string{"https://bucket.example.com/m.zip", "404"}},
		"token shaped path":    {in: "GET https://proxy.example.com/ghp_0123456789abcdefghijklmnopqrstuv/github.com/x/@v/list", secrets: []string{"0123456789abcdefghijklmnopqrstuv"}, keep: []string{"github.com/x/@v/list"}},
		"fine grained token":   {in: "token github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz invalid", secrets: []string{"11ABCDEFG0123456789"}},
		"json key":             {in: `{"api_key":"abc123secret","name":"x"}`, secrets: []string{"abc123secret"}, keep: []string{`"name":"x"`}},
		"prefixed key":         {in: "GITHUB_TOKEN=abc123secret go: downloading", secrets: []string{"abc123secret"}, keep: []string{"go: downloading"}},
		"authorization header": {in: "Authorization: Bearer abc123secret\nnext line", secrets: []string{"abc123secret"}, keep: []string{"next line"}},
		"bare bearer":          {in: "sent bearer abc123secret to proxy", secrets: []string{"abc123secret"}, keep: []string{"to proxy"}},
		"jwt":                  {in: "rejected eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM now", secrets: []string{"eyJhbGciOiJIUzI1NiJ9"}, keep: []string{"rejected"}},
		"aws key id":           {in: "key AKIAIOSFODNN7EXAMPLE rejected", secrets: []string{"AKIAIOSFODNN7EXAMPLE"}},
	} {
		t.Run(name, func(t *testing.T) {
			out := Redact(test.in)
			for _, secret := range test.secrets {
				require.NotContains(t, out, secret)
			}
			for _, kept := range test.keep {
				require.Contains(t, out, kept)
			}
		})
	}
}

func TestRedactLeavesOrdinaryDiagnosticsAlone(t *testing.T) {
	for _, text := range []string{
		"./pkg/main.go:12:3: undefined: sdk.Removed",
		"go: github.com/omniviewdev/plugin-sdk@v0.17.0: missing go.sum entry for go.mod file",
		"Get \"https://proxy.golang.org/github.com/omniviewdev/plugin-sdk/@v/v0.17.0.info\": dial tcp 142.250.0.1:443: i/o timeout",
		"verifying github.com/omniviewdev/plugin-sdk@v0.17.0: checksum mismatch",
	} {
		require.Equal(t, text, Redact(text))
	}
}

// A cut through the middle of a URL leaves a credential without the scheme that
// identifies it, so redaction has to run first.
func TestSafeRedactsBeforeItBoundsTheText(t *testing.T) {
	// The tail cut lands inside the password.
	text := "aaaaa" + "https://user:secretpassword@host/" + strings.Repeat("b", MaxBytes-18)
	require.Greater(t, len(text), MaxBytes)
	out := Safe(text, "")
	require.NotContains(t, out, "ecretpassword")
	require.LessOrEqual(t, len(out), MaxBytes)

	require.NotContains(t, Tail(Redact(text), 40), "secretpassword")
}

func TestSafeReplacesRootAndHomeAndSecretEnvironmentValues(t *testing.T) {
	t.Setenv("HOME", "/home/dev-user")
	t.Setenv("OMNIVIEW_TEST_API_TOKEN", "sensitive-value")
	out := Safe("/work/space/plugin/main.go:12: boom\n/home/dev-user/go/pkg/mod\nsensitive-value\nhttps://user:pass@example.com", "/work/space")
	for _, secret := range []string{"/work/space", "/home/dev-user", "sensitive-value", "user:pass"} {
		require.NotContains(t, out, secret)
	}
	require.Contains(t, out, "$WORKSPACE/plugin/main.go:12: boom")
	require.Contains(t, out, "$HOME/go/pkg/mod")
	require.Equal(t, "boom", Safe("boom", ""), "an empty root must not be replaced")
}

func TestTailMarksACut(t *testing.T) {
	require.Equal(t, "short", Tail("short", 10))
	require.Equal(t, "...cdef", Tail("abcdef", 4))
}
