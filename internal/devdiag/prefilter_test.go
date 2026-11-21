package devdiag

import (
	"math/rand/v2"
	"strings"
	"testing"
	"unicode"

	"github.com/stretchr/testify/require"
)

// Redact runs a cheap test before its patterns and skips them when the test says
// that none can match. A wrong "none" leaves a credential in the output with no
// error anywhere, so these tests compare Redact with the patterns themselves.

// expandWords writes the alternation list out: api[_-]?key becomes apikey, api_key and
// api-key; a word with two optional separators becomes nine.
func expandWords(list string) []string {
	var words []string
	for _, alternative := range strings.Split(list, "|") {
		spellings := []string{""}
		for i, part := range strings.Split(alternative, optionalSeparator) {
			var next []string
			for _, spelled := range spellings {
				if i == 0 {
					next = append(next, spelled+part)
					continue
				}
				next = append(next, spelled+part, spelled+"_"+part, spelled+"-"+part)
			}
			spellings = next
		}
		words = append(words, spellings...)
	}
	return words
}

// keyValueWords returns the words of keyWords, written out. It reads the list the code
// reads, so that a word added there is tested here without anyone remembering to; and
// it checks that the key=value pattern is built from that list and not from a copy.
func keyValueWords(t *testing.T) []string {
	t.Helper()
	require.Contains(t, keyValue.String(), keyWords, "the key=value pattern is not built from keyWords")

	words := expandWords(keyWords)
	require.GreaterOrEqual(t, len(words), 9)
	return words
}

// tokenShapeExamples returns a string that each tokenShape alternative matches.
func tokenShapeExamples() []string {
	return []string{
		"ghp_0123456789abcdefghijklmnop",
		"gho_0123456789abcdefghijklmnop",
		"ghu_0123456789abcdefghijklmnop",
		"ghs_0123456789abcdefghijklmnop",
		"ghr_0123456789abcdefghijklmnop",
		"github_pat_11ABCDEFG0123456789_abcdefghij",
		"glpat-0123456789abcdefghij",
		"xoxa-0123456789abc",
		"xoxb-0123456789abc",
		"xoxp-0123456789abc",
		"xoxr-0123456789abc",
		"xoxs-0123456789abc",
		"AKIAIOSFODNN7EXAMPLE",
		"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM",
	}
}

func alternatingCase(s string) string {
	b := []byte(s)
	for i := 0; i < len(b); i += 2 {
		if 'a' <= b[i] && b[i] <= 'z' {
			b[i] -= 'a' - 'A'
		}
	}
	return string(b)
}

func TestRedactSkipsThePatternsOnlyWhenNoneCanMatch(t *testing.T) {
	requireFound := func(t *testing.T, text string) {
		t.Helper()
		require.NotEqual(t, text, redactPatterns(text), "the example no longer holds a credential: %q", text)
		require.True(t, couldCarryCredential(text),
			"the patterns would change this text and the fast path skips them: %q", text)
		require.Equal(t, redactPatterns(text), Redact(text))
	}

	t.Run("every word of keyValue, in every case, with every separator", func(t *testing.T) {
		for _, word := range keyValueWords(t) {
			spellings := []string{word, strings.ToUpper(word), strings.ToUpper(word[:1]) + word[1:], alternatingCase(word)}
			for _, spelled := range spellings {
				for _, tail := range []string{"=value", ": value", `":"value"`, " = 'value'"} {
					requireFound(t, "prefix_"+spelled+tail)
					requireFound(t, spelled+tail)
				}
			}
		}
	})

	t.Run("every prefix of tokenShape", func(t *testing.T) {
		for _, example := range tokenShapeExamples() {
			requireFound(t, example)
			requireFound(t, "rejected "+example+" now")
		}
	})

	t.Run("bearer needs no separator", func(t *testing.T) {
		requireFound(t, "sent BEARER abc123secret to proxy")
		requireFound(t, "sent bEaReR abc123secret")
	})

	t.Run("urls", func(t *testing.T) {
		requireFound(t, "fetching https://user:pass@example.com/a")
		requireFound(t, "GET https://example.com/a?token=1")
		requireFound(t, "GET HTTPS://example.com/a?x=1")
	})

	// (?i) in the patterns folds the long s and the Kelvin sign onto s and k. The
	// two are found by asking Unicode, so that a third would be seen.
	t.Run("characters outside ASCII that fold onto a letter", func(t *testing.T) {
		var folding []rune
		for r := rune(unicode.MaxASCII + 1); r <= unicode.MaxRune; r++ {
			for f := unicode.SimpleFold(r); f != r; f = unicode.SimpleFold(f) {
				if f <= unicode.MaxASCII {
					folding = append(folding, r)
					break
				}
			}
		}
		require.ElementsMatch(t, []rune{'\u017f', '\u212a'}, folding,
			"a new character folds onto ASCII: couldCarryCredential has to know it")

		// \b is ASCII only, so a key that starts with the folded character needs a
		// prefix: the match begins at the prefix.
		requireFound(t, "pa\u017f\u017fword=hunter2")
		requireFound(t, "my_\u017fecret=hunter2")
		requireFound(t, "to\u212aen=hunter2")
		requireFound(t, "api_\u212aey=hunter2")
		requireFound(t, "my_\u017fignature=hunter2")
	})
}

// The test is only worth its cost when ordinary text passes it. A test that always
// says "maybe" is correct and useless.
func TestRedactSkipsThePatternsOnOrdinaryText(t *testing.T) {
	for _, text := range []string{
		"",
		"plugin loaded pluginID=kubernetes version=0.12.3 durationMs=412",
		"connection started connectionID=3f2b8c1e-9d4a-4e7b-8a61-5c0d2f9e7b14 cluster=prod-us-east-1",
		"pulling image registry.k8s.io/pause@sha256:3d380ca8864549e74af4b29c10f9cb0956236dfb01c40ca076fb6c37253234db",
		"serviceaccount token mounted at /var/run/secrets/kubernetes.io/serviceaccount/token",
		"plugin process crashed \u2014 attempting recovery",
		"watching pods.v1 in namespace kube-system resourceVersion=48213917",
		"GET https://10.96.0.1:443/api/v1/namespaces/default/pods 200 OK",
	} {
		require.False(t, couldCarryCredential(text), "ordinary text takes the slow path: %q", text)
		require.Equal(t, text, Redact(text))
	}
}

// ordinaryLogText is what the host writes to its logs, and none of it is secret:
// the patterns have to leave it alone, or the logs stop being of use. The shapes
// a credential pattern could eat by mistake are the ones here: digests, hashes,
// identifiers, URLs, paths and the words the patterns look for used as plain words.
func ordinaryLogText() []string {
	return []string{
		"plugin loaded pluginID=kubernetes version=0.12.3 durationMs=412",
		"connection started pluginID=kubernetes connectionID=3f2b8c1e-9d4a-4e7b-8a61-5c0d2f9e7b14 cluster=prod-us-east-1",
		"pulling image registry.k8s.io/pause@sha256:3d380ca8864549e74af4b29c10f9cb0956236dfb01c40ca076fb6c37253234db",
		"resolved plugin source ref=9fceb02d0ae598e95dc970b74767f19372d61af8 dirty=false",
		"config checksum=Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5d2FsZHRodWQ= unchanged, skipping reload",
		"last-applied-configuration hash=5f4dcc3b5aa765d61d8327deb882cf99 matches",
		"watching resource=pods.v1 namespace=kube-system name=coredns-5dd5756b68-x7k2q resourceVersion=48213917",
		"reading kubeconfig path=/Users/jane/.kube/config context=docker-desktop",
		`opened C:\Users\jane\AppData\Roaming\Omniview\logs\omniview.log`,
		"GET https://registry.omniview.dev/v1/plugins/kubernetes/versions 200 OK",
		`Get "https://10.96.0.1:443/api/v1/namespaces/default/pods": dial tcp 10.96.0.1:443: i/o timeout`,
		"host pprof listening url=http://127.0.0.1:6060/debug/pprof source=env",
		"plugin process crashed \u2014 attempting recovery pluginID=kubernetes",
		"helm release deployed name=my-app-secrets-store chart=bitnami/vault-0.3.1 revision=3",
		"serviceaccount token mounted at /var/run/secrets/kubernetes.io/serviceaccount/token",
		"listed 42 secrets in namespace=default",
		"kubectl get secret db-credentials -o yaml",
		"2024-01-15T10:30:00.000Z [DEBUG] kubernetes: starting informer resource=deployments.apps",
		"api version apps/v1 kind=Deployment api-server=10.96.0.1 accessMode=ReadWriteOnce",
		// Near misses of the prefixes in tokenShape.
		"gh pr list returned 3 results; ghost-writer branch is ahead",
		"image tag xoxb-1 built for linux/amd64",
	}
}

func TestRedactLeavesOrdinaryLogTextAlone(t *testing.T) {
	for _, line := range ordinaryLogText() {
		require.Equal(t, line, Redact(line))
		require.Equal(t, line, redactPatterns(line),
			"the patterns themselves change this line; the fast path is not what keeps it")
	}
}

// What the patterns do change in text like the above, so that the cost is on record.
func TestRedactOnLogTextThatHoldsCredentials(t *testing.T) {
	for name, tc := range map[string]struct{ in, want string }{
		"bearer header, password, key id": {
			in: `RPC failed error="rpc error: code = Unauthenticated desc = ` +
				`Authorization: Bearer abc123def456ghi789 ; password=hunter2 ; AKIAIOSFODNN7EXAMPLE"`,
			want: `RPC failed error="rpc error: code = Unauthenticated desc = ` +
				`Authorization: [REDACTED] ; password=[REDACTED] ; [REDACTED]"`,
		},
		"url query is dropped, path kept": {
			in:   "GET https://api.example.com/v1/pods?limit=500&watch=true 200 OK",
			want: "GET https://api.example.com/v1/pods?[REDACTED] 200 OK",
		},
		"url user and password": {
			in:   "cloning https://deploy:s3cr3t@git.example.com/org/repo.git",
			want: "cloning https://[REDACTED]@git.example.com/org/repo.git",
		},
		"json key": {
			in:   `{"client_secret":"abc123","name":"x"}`,
			want: `{"client_secret":"[REDACTED]","name":"x"}`,
		},
		// The next three are the cost of the patterns: the text after the word is
		// not a credential, and is removed all the same.
		"a sentence that says token:": {
			in:   "failed to refresh token: 401 Unauthorized",
			want: "failed to refresh token: [REDACTED] Unauthorized",
		},
		"a resource kind written Secret:": {
			in:   "created Secret: default/db-credentials",
			want: "created Secret: [REDACTED]",
		},
		"the user of a git ssh url": {
			in:   "cloned ssh://git@github.com/omniviewdev/omniview.git",
			want: "cloned ssh://[REDACTED]@github.com/omniviewdev/omniview.git",
		},
	} {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, tc.want, Redact(tc.in))
			require.Equal(t, tc.want, Redact(Redact(tc.in)), "redacting twice must not change the result")
		})
	}
}

// generatedFragments returns the pieces of the generated text below: fixed ones, and
// the words of keyValue with bearer and basic.
func generatedFragments(t *testing.T) ([]string, []string) {
	t.Helper()
	words := append(keyValueWords(t), "bearer", "basic", "Bearer", "Basic")
	fixed := []string{
		":", "=", ": ", " = ", `":"`, `="`, "':'", " ", "\n", "\t", ", ", ";", `"`, "'", "-", "_", ".", "/", "&", "#",
		"://", "https://", "HTTP://", "ssh://", "@", "?", "user:pass@", "host.example.com", "/a/b", "?x=1&y=2", "[REDACTED]",
		"ghp_", "gho_", "gh_", "ghx_", "github_pat_", "glpat-", "xox", "xoxb-", "xoxz-",
		"AKIA", "AKIAIOSFODNN7", "eyJ", "eyJ.", "a.b.c",
		"0123456789abcdefghij", "abc123def456ghi789", "pods", "namespace", "failed", "ok", "123", "sha256:deadbeef",
		"\u017f", "\u212a", "\u00e9", "\u65e5\u672c\u8a9e", "\U0001f642", "\u00a0",
	}
	return fixed, words
}

func generatedText(rng *rand.Rand, fixed, words []string) string {
	shapes := tokenShapeExamples()
	var b strings.Builder
	for range 1 + rng.IntN(10) {
		switch rng.IntN(4) {
		case 0, 1:
			b.WriteString(fixed[rng.IntN(len(fixed))])
		case 2:
			word := words[rng.IntN(len(words))]
			switch rng.IntN(5) {
			case 0:
				word = strings.ToUpper(word)
			case 1:
				word = alternatingCase(word)
			case 2:
				// A letter written as the character that folds onto it.
				word = strings.Replace(strings.Replace(word, "k", "\u212a", 1), "s", "\u017f", 1)
			}
			b.WriteString(word)
		default:
			b.WriteString(shapes[rng.IntN(len(shapes))])
		}
		if rng.IntN(3) == 0 {
			b.WriteByte(' ')
		}
	}
	return b.String()
}

// The same text through Redact and through the patterns alone, with a fixed seed so
// that a failure can be repeated.
func TestRedactAgreesWithThePatternsOnGeneratedText(t *testing.T) {
	fixed, words := generatedFragments(t)
	rng := rand.New(rand.NewPCG(20261120, 1))
	changed := 0
	for range 20000 {
		text := generatedText(rng, fixed, words)
		want := redactPatterns(text)
		if want != text {
			changed++
		}
		require.Equal(t, want, Redact(text), "input %q", text)
	}
	// Half the inputs or so hold a credential; if none did the comparison would prove nothing.
	require.Greater(t, changed, 2000, "the generated text rarely holds a credential")
}

// BenchmarkRedact compares Redact with the patterns alone on a short line and on a
// long text that hold nothing, and on a short line that holds a credential (where
// the fast path cannot help, and must not cost much).
func BenchmarkRedact(b *testing.B) {
	inputs := []struct{ name, text string }{
		{
			"short clean line",
			"plugin loaded pluginID=kubernetes version=0.12.3 durationMs=412 connectionID=3f2b8c1e-9d4a-4e7b-8a61-5c0d2f9e7b14",
		},
		{
			"long clean text",
			strings.Repeat("watching pods namespace=default resource=pods.v1 resourceVersion=123456 ", 60),
		},
		{
			"short line with a credential",
			"RPC failed op=CheckConnection error=rpc error: code = Unauthenticated " +
				"desc = Authorization: Bearer abc123def456ghi789",
		},
	}
	for _, input := range inputs {
		b.Run(input.name+"/Redact", func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(input.text)))
			for range b.N {
				_ = Redact(input.text)
			}
		})
		b.Run(input.name+"/patterns only", func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(input.text)))
			for range b.N {
				_ = redactPatterns(input.text)
			}
		})
	}
}
