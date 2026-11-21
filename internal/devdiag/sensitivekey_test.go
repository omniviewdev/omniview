package devdiag

import (
	"math/rand/v2"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// SensitiveKey tells a field called token from a field called tokenizer. It shares the
// words of keyWords with the key=value pattern of Redact and has a few of its own
// (nameWords), and these tests hold it to the definition written on it: the tables are
// the definition by example, the rest builds keys from every word of the lists, and
// compares the two-step test with a plain search.

// nameOnlyWords returns the words of nameWords, written out, and checks that the text
// pattern is not built from them.
func nameOnlyWords(t *testing.T) []string {
	t.Helper()
	require.NotContains(t, keyValue.String(), nameWords, "the key=value pattern is built from nameWords")
	words := expandWords(nameWords)
	require.GreaterOrEqual(t, len(words), 5)
	return words
}

// sensitiveKeyWords returns every word SensitiveKey looks for, written out.
func sensitiveKeyWords(t *testing.T) []string {
	t.Helper()
	return append(keyValueWords(t), nameOnlyWords(t)...)
}

func TestSensitiveKeyNamesACredential(t *testing.T) {
	for _, key := range []string{
		"token", "Token", "TOKEN", "auth_token", "authToken", "AuthToken", "access_token", "accessToken",
		"x-auth-token", "authtoken", "mytoken", "token_count", "tokenCount", "token2", "token.value",
		"password", "PASSWORD", "passwd", "db.password", "dbPassword", "password_hash", "passwordHash", "password1",
		"user:password", "secret", "client_secret", "clientSecret", "ClientSecret", "secretName", "secret_key",
		"secretKey", "SECRET_KEY", "authorization", "Authorization", "proxy-authorization", "authorizationHeader",
		"api_key", "api-key", "apikey", "apiKey", "ApiKey", "API_KEY", "APIKey", "x-api-key", "X-Api-Key", "x_api_key",
		"access_key", "access-key", "accesskey", "accessKey", "AccessKeyId", "AWS_ACCESS_KEY_ID",
		"credential", "credentialId", "awsCredential", "gcp_credential",
		"signature", "x-amz-signature", "signatureValue", "request_signature",
		// A plural is the word: a field called secrets or credentials holds them.
		"tokens", "secrets", "passwords", "credentials", "signatures", "passwds", "authorizations", "api_keys", "apiKeys",
		"apikeys", "access_keys", "accessKeys", "authTokens", "TOKENS", "tokensValue", "tokens_count", "secretsMap",
		// What a private key, a kubeconfig and a cookie are called.
		"private_key", "privateKey", "private-key", "PRIVATE_KEY", "privatekey", "ssl_private_key", "privateKeyPem",
		"client-key-data", "client_key_data", "clientKeyData", "client-certificate-data", "clientCertificateData",
		"kubeconfig", "kubeConfig", "kube-config", "kube_config", "KUBECONFIG", "kubeconfigPath", "kubeconfigs",
		"cookie", "Cookie", "COOKIE", "cookies", "set-cookie", "Set-Cookie", "setCookie", "set_cookie", "x-cookie",
	} {
		require.True(t, SensitiveKey(key), "%q names a credential", key)
	}
}

func TestSensitiveKeyLeavesOtherNamesAlone(t *testing.T) {
	for _, key := range []string{
		"", "id", "pluginID", "connectionID", "error", "errorClass", "durationMs", "count", "name",
		"namespace", "resource", "op", "trigger", "status", "details", "url", "path", "version", "component",
		// A bare key is not a credential: it is not in the list, and the host logs it as the key of a map entry or
		// of a resource. The same goes for the other ways to say key that the list does not have.
		"key", "Key", "KEY", "resourceKey", "cache_key", "primary_key", "partitionKey", "object_key", "s3_key",
		"client_key", "clientKey", "ssh_key", "encryptionKey", "signing_key", "private", "privateData",
		// A client certificate's authority is public, and the name of a file is not the content of one.
		"certificate-authority-data", "certificateAuthorityData", "certificate-authority", "client-certificate",
		"client-key", "client_cert", "kube", "kube-system", "kubernetes", "kubeletConfig",
		// A word with letters after it is another word, even in its plural.
		"keyboard", "monkey", "donkey", "tokenizer", "tokenize", "tokenization", "secretary", "secretive",
		"passwordless", "passwordless_enabled", "tokenss", "secretsmanager", "credentialsx", "cookiejar", "cookiecutter",
		// Half a word.
		"author", "autho", "pass", "passw", "sig", "sign", "cred", "toke", "accesss", "api", "access", "cook", "priv",
	} {
		require.False(t, SensitiveKey(key), "%q does not name a credential", key)
	}
}

// A session is not a word of the list. The host's own handles for an exec, a log and a
// terminal session are called session, sessionID and session_id: they correlate the
// lines of one session and are not credentials, and hiding them would cost debugging for
// no gain. What a session holds that is a credential has a name that is: a token, a
// cookie, the security token of an AWS call. This test keeps the day someone drops the
// bare word from being read as dropping those.
func TestSensitiveKeyNamesTheTokenAndTheCookieOfASessionAndNotItsHandle(t *testing.T) {
	for _, key := range []string{
		"session_token", "sessionToken", "session-token", "SessionToken", "AWS_SESSION_TOKEN", "aws_session_token",
		"x-amz-security-token", "X-Amz-Security-Token", "securityToken", "session_cookie", "sessionCookie",
		"cookie", "Cookie", "set-cookie", "Set-Cookie", "session_secret", "sessionPassword",
	} {
		require.True(t, SensitiveKey(key), "%q names a credential", key)
	}
	for _, key := range []string{
		"session", "Session", "SESSION", "sessionID", "sessionId", "session_id", "session-id", "sessions",
		"sessionCount", "session_ttl", "x-session-id", "mcpSessionID",
	} {
		require.False(t, SensitiveKey(key), "%q is a handle, not a credential", key)
	}
}

// Every word of the lists, in four spellings of its letters, with what can come before
// it (nothing is required) and after it (a word ends where the key ends or goes on).
func TestSensitiveKeyMatchesEveryWordOfTheListsAndOnlyWhereAWordEnds(t *testing.T) {
	for _, word := range sensitiveKeyWords(t) {
		for _, spelled := range []string{word, strings.ToUpper(word), strings.ToUpper(word[:1]) + word[1:], alternatingCase(word)} {
			for _, key := range []string{
				spelled, "x_" + spelled, "x-" + spelled, "x." + spelled, "my" + spelled, "X" + spelled,
				spelled + "_id", spelled + "-id", spelled + ".id", spelled + "2", spelled + "/x", spelled + " x",
				// The plural of a word is the word.
				spelled + "s", "x_" + spelled + "s", spelled + "s_id", spelled + "s2", spelled + "S",
			} {
				require.True(t, SensitiveKey(key), "%q ends with the word %q", key, word)
			}
			for _, key := range []string{spelled + "er", spelled + "less", spelled + "ize", spelled + "ser", spelled + "sless"} {
				require.False(t, SensitiveKey(key), "%q goes on after the word %q", key, word)
			}
		}
		// A capital after a lower case letter starts a new word.
		for _, spelled := range []string{word, strings.ToUpper(word[:1]) + word[1:]} {
			require.True(t, SensitiveKey(spelled+"Id"), "%q", spelled+"Id")
			require.True(t, SensitiveKey(spelled+"ID"), "%q", spelled+"ID")
			require.True(t, SensitiveKey(spelled+"sId"), "%q", spelled+"sId")
		}
		// A run of capitals ends before its last one when a lower case letter follows.
		require.True(t, SensitiveKey(strings.ToUpper(word)+"Value"))
		// All capitals, with nothing to tell where the next word starts, is one word.
		require.False(t, SensitiveKey(strings.ToUpper(word)+"VALUE"))
		require.False(t, SensitiveKey(strings.ToUpper(word)+"SVALUE"))
	}
}

// plainKeySearch is the plain way to find a word of the lists in a key: every spelling of
// every word and of its plural, found wherever it is, kept if a word of the key ends
// where it does.
func plainKeySearch(words []string, key string) bool {
	lower := asciiLower(key)
	for _, word := range words {
		for _, spelled := range []string{word, word + "s"} {
			for from := 0; from < len(lower); {
				at := strings.Index(lower[from:], spelled)
				if at < 0 {
					break
				}
				if endsWord(key, from+at+len(spelled)) {
					return true
				}
				from += at + 1
			}
		}
	}
	return false
}

// spelledAtRandom writes word in lower case, upper case, with a capital or with every
// other letter a capital, or as it is.
func spelledAtRandom(rng *rand.Rand, word string) string {
	switch rng.IntN(4) {
	case 0:
		return strings.ToUpper(word)
	case 1:
		return strings.ToUpper(word[:1]) + word[1:]
	case 2:
		return alternatingCase(word)
	}
	return word
}

// generatedKey joins one to five pieces: fragments that make a word end or go on, and
// the words of the lists in every spelling.
func generatedKey(rng *rand.Rand, words []string) string {
	fragments := []string{
		"x", "my", "auth", "client", "a", "A", "API", "Id", "ID", "id", "name", "Name", "s", "S", "er", "less", "2", "_", "-", ".", "/", " ",
		":", "Key", "key", "KEY", "key_", "ey", "api", "access", "Api", "Access", "\u017f", "\u212a", "\u00e9", "\u65e5", "pass", "sig",
		"AKIA", "Bearer", "bearer", "ghp_", "eyJ", "xox", "kube", "Kube", "private", "Private", "set", "data", "Data", "cert", "session",
	}
	var b strings.Builder
	for range 1 + rng.IntN(5) {
		if rng.IntN(3) == 0 {
			b.WriteString(fragments[rng.IntN(len(fragments))])
		} else {
			b.WriteString(spelledAtRandom(rng, words[rng.IntN(len(words))]))
		}
	}
	return b.String()
}

// The first test, which an ordinary key does not pass, must not hide a key that the
// exact one finds. The comparison is with a plain search.
func TestSensitiveKeyAgreesWithAPlainSearchOnGeneratedKeys(t *testing.T) {
	words := sensitiveKeyWords(t)
	rng := rand.New(rand.NewPCG(20261120, 2))
	matched := 0
	for range 20000 {
		key := generatedKey(rng, words)
		want := plainKeySearch(words, key)
		if want {
			matched++
		}
		require.Equal(t, want, SensitiveKey(key), "key %q", key)
	}
	require.Greater(t, matched, 3000, "the generated keys rarely hold a word")
	require.Less(t, matched, 17000, "the generated keys nearly all hold a word")
}

func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if 'A' <= c && c <= 'Z' {
			b[i] = c + 'a' - 'A'
		}
	}
	return string(b)
}

func TestSensitiveKeyAllocatesNothing(t *testing.T) {
	keys := []string{
		"pluginID", "connectionID", "error", "durationMs", "access_token", "x-api-key", "secretName", "tokenizer",
		"cookie", "kubeconfig", "clientKeyData", "tokens", "sessionID", "certificate-authority-data",
	}
	require.Zero(t, testing.AllocsPerRun(200, func() {
		for _, key := range keys {
			_ = SensitiveKey(key)
		}
	}))
}

// The words of nameWords are looked for in a name and nowhere else. In text they are
// ordinary words: a kubeconfig error says "loading kubeconfig: stat ...", a kubectl one
// "getting credentials: exec: ...", and Redact, which apperror.PublicText shares, leaves
// them as they are. A word added to nameWords and to the text pattern would change the
// sentences the frontend shows.
func TestNameWordsAreNotLookedForInText(t *testing.T) {
	for _, text := range []string{
		"loading kubeconfig: stat /Users/jane/.kube/config: no such file or directory",
		"Unable to connect to the server: getting credentials: exec: executable aws failed with exit code 255",
		"kubeconfig=/Users/jane/.kube/config",
		"listed 42 secrets in namespace=default",
	} {
		require.Equal(t, text, Redact(text))
	}
	for _, word := range nameOnlyWords(t) {
		for _, text := range []string{word + ": value", "x_" + word + "=value", `{"` + word + `":"value"}`} {
			require.Equal(t, text, Redact(text), "the text pattern looks for %q", word)
		}
	}
}

// What an AWS call carries, by name (above) and by the shape of a key=value pair in text.
func TestRedactFindsTheSessionTokenOfAnAWSCall(t *testing.T) {
	for name, tc := range map[string]struct{ in, want string }{
		"security token header": {
			in:   "X-Amz-Security-Token: IQoJb3JpZ2luX2VjEJz",
			want: "X-Amz-Security-Token: [REDACTED]",
		},
		"session token variable": {
			in:   "AWS_SESSION_TOKEN=FwoGZXIvYXdzEBYaDExample region=us-east-1",
			want: "AWS_SESSION_TOKEN=[REDACTED] region=us-east-1",
		},
		"session token in json": {
			in:   `{"SessionToken":"FwoGZXIvYXdzEBYaDExample","Expiration":"2026-11-20T10:00:00Z"}`,
			want: `{"SessionToken":"[REDACTED]","Expiration":"2026-11-20T10:00:00Z"}`,
		},
		"session token with a hyphen": {
			in:   "session-token: FwoGZXIvYXdzEBYaDExample",
			want: "session-token: [REDACTED]",
		},
	} {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, tc.want, Redact(tc.in))
		})
	}
}

func TestPlaceholderIsWhatRedactWrites(t *testing.T) {
	require.Equal(t, "[REDACTED]", Placeholder)
	require.Contains(t, Redact("password=hunter2"), Placeholder)
}

// MayCarryCredential is the test a caller runs before it reads a document for names as
// well as for text: false has to be exact for both.
func TestMayCarryCredentialIsFalseOnlyWhenNeitherATextNorANameCanBeFound(t *testing.T) {
	fixed, words := generatedFragments(t)
	words = append(words, nameOnlyWords(t)...)
	rng := rand.New(rand.NewPCG(20261120, 3))
	found := 0
	for range 20000 {
		text := generatedText(rng, fixed, words)
		if Redact(text) != text {
			found++
			require.True(t, MayCarryCredential(text), "Redact changes %q", text)
		}
		require.True(t, !SensitiveKey(text) || MayCarryCredential(text), "SensitiveKey accepts %q", text)
	}
	require.Greater(t, found, 2000)

	for _, word := range sensitiveKeyWords(t) {
		for _, spelled := range []string{word, strings.ToUpper(word), alternatingCase(word)} {
			require.True(t, MayCarryCredential(spelled), "%q", spelled)
			require.True(t, MayCarryCredential(`{"`+spelled+`":["x"]}`), "%q", spelled)
		}
	}
	ordinary := append([]string{"", `{"name":"x","count":3,"ready":true}`, `["a","b"]`, "plain"}, ordinaryLogText()[:6]...)
	for _, text := range ordinary {
		require.False(t, MayCarryCredential(text), "ordinary text: %q", text)
	}
}

func BenchmarkSensitiveKey(b *testing.B) {
	for _, tc := range []struct{ name, key string }{
		{"ordinary key", "pluginID"},
		{"longer ordinary key", "connectionID"},
		{"near miss: a word and letters after it", "tokenizer"},
		{"sensitive key", "access_token"},
		{"sensitive camelCase key", "clientSecretName"},
		{"sensitive name-only key", "Set-Cookie"},
		{"plural", "credentials"},
	} {
		b.Run(tc.name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				_ = SensitiveKey(tc.key)
			}
		})
	}
}
