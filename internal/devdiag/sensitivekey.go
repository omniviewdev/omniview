package devdiag

import "strings"

// SensitiveKey reports whether key is the name of a credential: whether the value
// of a log field, a map entry or a JSON member with this name should be hidden
// whatever it looks like. Most secrets have no shape that Redact can find (a
// database password, an opaque API token); the name is what gives them away.
//
// The names are those of Redact's key=value pattern (keyWords): what hides the value
// in "password=hunter2" hides the value of a field called password. A few words only
// a name can mean are looked for as well (nameWords): a private key, the key or the
// certificate of a kubeconfig user, a whole kubeconfig, a cookie. A word matches
// without regard to the case of its letters, in the plural as well as in the singular,
// and ends where a word of the key ends: at the end of the key, before anything that
// is not a letter (a separator such as '_', '-' or '.', a digit) and where a camelCase
// word starts. Nothing is required of what comes before it, so authtoken matches as
// authtoken=... does in text.
//
//	matches    token, Token, auth_token, accessToken, X-Api-Key, apikey, API_KEY,
//	           accessKeyId, clientSecret, secret2, db.password, password_hash,
//	           proxy-authorization, x-amz-signature, awsCredential, authtoken,
//	           tokens, secrets, credentials, apiKeys, private_key, privateKey,
//	           client-key-data, client-certificate-data, kubeconfig, cookie, Set-Cookie,
//	           session_token, SessionToken, X-Amz-Security-Token
//	no match   tokenizer, secretary, passwordless_enabled, keyboard, monkey, key,
//	           primary_key, client_key, certificate-authority-data, id, pluginID,
//	           session, sessionID
//
// A bare "key" is not a credential here: it is not in the list, and the host logs
// it as the key of a map entry or of a resource. client_key and ssh_key are not in the
// list either, and neither is certificate-authority-data, which is public. A word
// with letters after it is another word (tokenizer), and so is a plural with letters
// after it (secretsmanager). The letters are matched as ASCII; the long s and the
// Kelvin sign that the text pattern also folds are not looked for in names. Words with
// a sensitive name and a harmless value (token_type, secretName) match all the same:
// the name is all that is looked at.
//
// A session is not a word of the list. The host's own handles for an exec, a log and a
// terminal session are called session and sessionID: they correlate the lines of one
// session and are not credentials, and hiding them would cost debugging for no gain.
// What a session holds that is one has a name that matches: session_token, a cookie,
// X-Amz-Security-Token.
//
// A key is looked at only if it holds the start of one of the words (the same first
// test Redact runs on text, with the words of nameWords added), so an ordinary key
// costs a few nanoseconds and no allocation.
func SensitiveKey(key string) bool {
	return containsNameStart(key) && hasKeyWord(key)
}

// hasKeyWord is the exact test SensitiveKey runs on a key that passed its first one.
func hasKeyWord(key string) bool {
	for i := range len(key) {
		if !startsKeyWord(key[i:]) {
			continue
		}
		if n := keyWordLen(key[i:]); n > 0 && (endsWord(key, i+n) || endsPlural(key, i+n)) {
			return true
		}
	}
	return false
}

// keyWordLen returns the length of the word of keyWords or nameWords that s starts
// with, in any ASCII case, or 0.
func keyWordLen(s string) int {
	for _, list := range [...]string{keyWords, nameWords} {
		for words := list; words != ""; {
			var word string
			word, words, _ = strings.Cut(words, "|")
			if n := wordLen(s, word); n > 0 {
				return n
			}
		}
	}
	return 0
}

// wordLen returns the length of the prefix of s that is word, in any ASCII case, or
// 0. Each optionalSeparator in word is an underscore, a hyphen or nothing.
func wordLen(s, word string) int {
	n := 0
	for {
		before, after, optional := strings.Cut(word, optionalSeparator)
		if !hasPrefixFold(s[n:], before) {
			return 0
		}
		n += len(before)
		if !optional {
			return n
		}
		if n < len(s) && (s[n] == '_' || s[n] == '-') {
			n++
		}
		word = after
	}
}

// endsWord reports whether a word of key ends at end, an index of key after the last
// letter of a word of keyWords. It does at the end of the key, before anything that is
// not a letter, before a capital that follows a lower case letter (accessToken|Id) and
// before the last capital of a run of capitals when a lower case letter follows it
// (TOKEN|Value, written TOKENValue); it does not before a lower case letter (tokenizer).
func endsWord(key string, end int) bool {
	if end >= len(key) {
		return true
	}
	next := key[end]
	if isLower(next) {
		return false
	}
	if !isUpper(next) {
		return true
	}
	if !isUpper(key[end-1]) {
		return true
	}
	return end+1 < len(key) && isLower(key[end+1])
}

// endsPlural reports whether the word that ends at end is followed by an s that ends
// the word of the key: tokens, accessKeys, TOKENS, credentials_id.
func endsPlural(key string, end int) bool {
	return end < len(key) && (key[end] == 's' || key[end] == 'S') && endsWord(key, end+1)
}

func isLower(c byte) bool { return 'a' <= c && c <= 'z' }

func isUpper(c byte) bool { return 'A' <= c && c <= 'Z' }
