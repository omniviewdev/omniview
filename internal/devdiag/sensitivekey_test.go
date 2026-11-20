package devdiag

import (
	"math/rand/v2"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// SensitiveKey tells a field called token from a field called tokenizer. It shares its
// words with the key=value pattern of Redact (keyWords), and these tests hold it to
// the definition written on it: the table is the definition by example, the rest
// builds keys from every word of the list, and compares the two-step test with a
// plain search.

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
	} {
		require.True(t, SensitiveKey(key), "%q names a credential", key)
	}
}

func TestSensitiveKeyLeavesOtherNamesAlone(t *testing.T) {
	for _, key := range []string{
		"", "id", "pluginID", "connectionID", "sessionID", "error", "errorClass", "durationMs", "count", "name",
		"namespace", "resource", "op", "trigger", "status", "details", "url", "path", "version", "component",
		// A bare key is not a credential: it is not in the list, and the host logs it as the key of a map entry or
		// of a resource. The same goes for the other ways to say key that the list does not have.
		"key", "Key", "KEY", "resourceKey", "cache_key", "primary_key", "partitionKey", "object_key", "s3_key",
		"private_key", "client_key", "ssh_key", "encryptionKey", "signing_key",
		// A word with letters after it is another word, and a plural is not the word.
		"keyboard", "monkey", "donkey", "tokenizer", "tokenize", "tokenization", "tokens", "secretary", "secrets",
		"secretive", "passwordless", "passwordless_enabled", "passwords", "authorizations", "credentials",
		"signatures", "apikeys", "api_keys", "access_keys", "accessKeys",
		// Half a word.
		"author", "autho", "pass", "passw", "sig", "sign", "cred", "toke", "accesss", "api", "access",
	} {
		require.False(t, SensitiveKey(key), "%q does not name a credential", key)
	}
}

// Every word of the list, in four spellings of its letters, with what can come before
// it (nothing is required) and after it (a word ends where the key ends or goes on).
func TestSensitiveKeyMatchesEveryWordOfTheListAndOnlyWhereAWordEnds(t *testing.T) {
	for _, word := range keyValueWords(t) {
		for _, spelled := range []string{word, strings.ToUpper(word), strings.ToUpper(word[:1]) + word[1:], alternatingCase(word)} {
			for _, key := range []string{
				spelled, "x_" + spelled, "x-" + spelled, "x." + spelled, "my" + spelled, "X" + spelled,
				spelled + "_id", spelled + "-id", spelled + ".id", spelled + "2", spelled + "/x", spelled + " x",
			} {
				require.True(t, SensitiveKey(key), "%q ends with the word %q", key, word)
			}
			for _, key := range []string{spelled + "s", spelled + "er", spelled + "less", spelled + "ize"} {
				require.False(t, SensitiveKey(key), "%q goes on after the word %q", key, word)
			}
		}
		// A capital after a lower case letter starts a new word.
		for _, spelled := range []string{word, strings.ToUpper(word[:1]) + word[1:]} {
			require.True(t, SensitiveKey(spelled+"Id"), "%q", spelled+"Id")
			require.True(t, SensitiveKey(spelled+"ID"), "%q", spelled+"ID")
		}
		// A run of capitals ends before its last one when a lower case letter follows.
		require.True(t, SensitiveKey(strings.ToUpper(word)+"Value"))
		// All capitals, with nothing to tell where the next word starts, is one word.
		require.False(t, SensitiveKey(strings.ToUpper(word)+"VALUE"))
	}
}

// plainKeySearch is the plain way to find a word of the list in a key: every spelling of
// every word, found wherever it is, kept if a word of the key ends where it does.
func plainKeySearch(words []string, key string) bool {
	lower := asciiLower(key)
	for _, word := range words {
		for from := 0; from < len(lower); {
			at := strings.Index(lower[from:], word)
			if at < 0 {
				break
			}
			if endsWord(key, from+at+len(word)) {
				return true
			}
			from += at + 1
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
// the words of the list in every spelling.
func generatedKey(rng *rand.Rand, words []string) string {
	fragments := []string{
		"x", "my", "auth", "client", "a", "A", "API", "Id", "ID", "id", "name", "Name", "s", "er", "less", "2", "_", "-", ".", "/", " ",
		":", "Key", "key", "KEY", "key_", "ey", "api", "access", "Api", "Access", "\u017f", "\u212a", "\u00e9", "\u65e5", "pass", "sig",
		"AKIA", "Bearer", "bearer", "ghp_", "eyJ", "xox",
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
	words := keyValueWords(t)
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
	keys := []string{"pluginID", "connectionID", "error", "durationMs", "access_token", "x-api-key", "secretName", "tokenizer"}
	require.Zero(t, testing.AllocsPerRun(200, func() {
		for _, key := range keys {
			_ = SensitiveKey(key)
		}
	}))
}

func TestPlaceholderIsWhatRedactWrites(t *testing.T) {
	require.Equal(t, "[REDACTED]", Placeholder)
	require.Contains(t, Redact("password=hunter2"), Placeholder)
}

func BenchmarkSensitiveKey(b *testing.B) {
	for _, tc := range []struct{ name, key string }{
		{"ordinary key", "pluginID"},
		{"longer ordinary key", "connectionID"},
		{"near miss: a word and letters after it", "tokenizer"},
		{"sensitive key", "access_token"},
		{"sensitive camelCase key", "clientSecretName"},
	} {
		b.Run(tc.name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				_ = SensitiveKey(tc.key)
			}
		})
	}
}
