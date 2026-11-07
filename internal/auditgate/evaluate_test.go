package auditgate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

const (
	pluginPkg = "github.com/omniviewdev/omniview/backend/pkg/plugin"

	fqnAllowed        = "main.AppService.GetInstanceInfo"
	fqnAllowedLogs    = pluginPkg + "/logs.ServiceWrapper.CreateSession"
	fqnDeniedTerminal = pluginPkg + "/exec.ServiceWrapper.CreateTerminal"

	noArgs = `"args":[]`
)

func defaultPolicy(t testing.TB) *Policy {
	t.Helper()
	policy, err := Default()
	require.NoError(t, err)
	return policy
}

// post builds a well-formed runtime request around body.
func post(body string) RuntimeRequest {
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	return RuntimeRequest{
		Method:       http.MethodPost,
		Path:         "/wails/runtime",
		RawQuery:     "",
		Header:       header,
		Body:         []byte(body),
		CallIDPrefix: "",
	}
}

func byID(id uint32) string { return `"methodID":` + strconv.FormatUint(uint64(id), 10) }

func byName(name string) string { return `"methodName":` + strconv.Quote(name) }

// callWith builds a Call body whose call options are the given JSON members.
func callWith(members ...string) string {
	return `{"object":0,"method":0,"args":{"call-id":"c1",` + strings.Join(members, ",") + `}}`
}

func callByID(fqn, args string) string {
	return callWith(byID(MethodID(fqn)), `"args":`+args)
}

func callByName(fqn, args string) string {
	return callWith(byName(fqn), `"args":`+args)
}

// canonicalCall is the body the evaluator must forward for a call of fqn.
func canonicalCall(fqn, args string) string {
	return `{"object":0,"method":0,"args":{"call-id":"c1","methodName":` + strconv.Quote(fqn) + `,"args":` + args + `}}`
}

func TestEvaluateRuntimeAllowsAndCanonicalizesBoundCalls(t *testing.T) {
	policy := defaultPolicy(t)

	t.Run("id and name resolve to one canonical body", func(t *testing.T) {
		byIDVerdict := policy.EvaluateRuntime(post(callByID(fqnAllowed, "[]")))
		byNameVerdict := policy.EvaluateRuntime(post(callByName(fqnAllowed, "[]")))
		require.True(t, byIDVerdict.Allowed, byIDVerdict.Reason)
		require.Equal(t, byIDVerdict, byNameVerdict)
		require.Equal(t, ReasonAllowed, byIDVerdict.Reason)
		require.Equal(t, fqnAllowed, byIDVerdict.FQN)
		require.Equal(t, fqnAllowed, byIDVerdict.Subject)
		require.Equal(t, 0, byIDVerdict.Object)
		require.Equal(t, 0, byIDVerdict.Method)
		require.Equal(t, canonicalCall(fqnAllowed, "[]"), string(byIDVerdict.Forward))
	})

	t.Run("forwarded bytes are rebuilt, never the original", func(t *testing.T) {
		original := "{ \"method\" : 0 ,\n \"args\" : { \"args\" : [ {\"a\" : [1, 2.50, \"x y\"] } , \"s\" , null ],\n" +
			"\"methodID\" : " + strconv.FormatUint(uint64(MethodID(fqnAllowed)), 10) +
			", \"call-id\" : \"c1\" } , \"object\" : 0 }\n"
		verdict := policy.EvaluateRuntime(post(original))
		require.True(t, verdict.Allowed, verdict.Reason)
		want := canonicalCall(fqnAllowed, `[{"a":[1,2.50,"x y"]},"s",null]`)
		require.Equal(t, want, string(verdict.Forward))
		require.NotEqual(t, original, string(verdict.Forward))
		require.NotContains(t, string(verdict.Forward), "methodID")
	})

	t.Run("a call-id prefix covers calls and cancellations", func(t *testing.T) {
		request := post(callByName(fqnAllowedLogs, "[]"))
		request.CallIDPrefix = "s1/"
		verdict := policy.EvaluateRuntime(request)
		require.True(t, verdict.Allowed, verdict.Reason)
		require.Contains(t, string(verdict.Forward), `"call-id":"s1/c1"`)

		cancel := post(`{"object":10,"method":0,"args":{"call-id":"c1"}}`)
		cancel.CallIDPrefix = "s1/"
		verdict = policy.EvaluateRuntime(cancel)
		require.True(t, verdict.Allowed, verdict.Reason)
		want := `{"object":10,"method":0,"args":{"call-id":"s1/c1"}}`
		require.Equal(t, want, string(verdict.Forward))
	})

	t.Run("argument payloads pass through compacted but otherwise untouched", func(t *testing.T) {
		args := `["a\u00e9\n",{"n":12345678901234567890,"f":1e3,"t":true},[],{}]`
		verdict := policy.EvaluateRuntime(post(callByName(fqnAllowed, " "+args+" ")))
		require.True(t, verdict.Allowed, verdict.Reason)
		require.Equal(t, canonicalCall(fqnAllowed, args), string(verdict.Forward))
	})

	t.Run("the body limit is inclusive", func(t *testing.T) {
		head := callWith(byName(fqnAllowed), `"args":["`)
		head = head[:len(head)-len(`}}`)]
		const tail = `"]}}`
		body := head + strings.Repeat("x", MaxRuntimeBodyBytes-len(head)-len(tail)) + tail
		require.Len(t, body, MaxRuntimeBodyBytes)
		require.True(t, policy.EvaluateRuntime(post(body)).Allowed)
		require.Equal(t, ReasonBodyTooLarge, policy.EvaluateRuntime(post(body+" ")).Reason)
	})
}

func TestEvaluateRuntimeRuntimeObjectCalls(t *testing.T) {
	policy := defaultPolicy(t)
	// An allowed row forwards its own body (already canonical) unless forward
	// says otherwise.
	tests := []struct {
		name    string
		body    string
		reason  Reason
		subject string
		forward string
	}{
		{"window name", `{"object":6,"method":18}`, ReasonAllowed, "Window.Name", ""},
		{"window name with null args", `{"object":6,"method":18,"args":null}`, ReasonAllowed,
			"Window.Name", `{"object":6,"method":18}`},
		{"window is fullscreen", `{"object":6,"method":13}`, ReasonAllowed, "Window.IsFullscreen", ""},
		{"window is maximised", `{"object":6,"method":14}`, ReasonAllowed, "Window.IsMaximised", ""},
		{"system dark mode", `{"object":8,"method":0}`, ReasonAllowed, "System.IsDarkMode", ""},
		{"system environment", `{"object":8,"method":1}`, ReasonAllowed, "System.Environment", ""},
		{"system capabilities", `{"object":8,"method":2}`, ReasonAllowed, "System.Capabilities", ""},
		{"cancel call", `{"object":10,"method":0,"args":{"call-id":"abc_1-Z"}}`, ReasonAllowed, "CancelCall.Cancel", ""},

		{"allowed read with arguments", `{"object":6,"method":18,"args":{"x":1}}`, ReasonArgsForbidden, "Window.Name", ""},
		{"application quit", `{"object":2,"method":2}`, ReasonRuntimeDenied, "Application.Quit", ""},
		{"application hide", `{"object":2,"method":0}`, ReasonRuntimeDenied, "Application.Hide", ""},
		{"browser open url", `{"object":9,"method":0,"args":{"url":"https://example.com"}}`,
			ReasonRuntimeDenied, "Browser.OpenURL", ""},
		{"events emit", `{"object":3,"method":0,"args":{"name":"mcp/confirmation/resolved","data":{}}}`,
			ReasonRuntimeDenied, "Events.Emit", ""},
		{"clipboard text", `{"object":1,"method":1}`, ReasonRuntimeDenied, "Clipboard.Text", ""},
		{"clipboard set text", `{"object":1,"method":0,"args":{"text":"x"}}`, ReasonRuntimeDenied, "Clipboard.SetText", ""},
		{"system flags", `{"object":8,"method":3}`, ReasonRuntimeDenied, "System.Flags", ""},
		{"window close is unlisted", `{"object":6,"method":2}`, ReasonRuntimeDenied, "", ""},
		{"window set title is unlisted", `{"object":6,"method":34,"args":{"title":"x"}}`, ReasonRuntimeDenied, "", ""},
		{"dialog object has no allowed method", `{"object":5,"method":0}`, ReasonRuntimeDenied, "", ""},
		{"context menu object", `{"object":4,"method":0}`, ReasonRuntimeDenied, "", ""},
		{"screens object", `{"object":7,"method":0}`, ReasonRuntimeDenied, "", ""},
		{"ios object", `{"object":11,"method":0}`, ReasonRuntimeDenied, "", ""},
		{"android object", `{"object":12,"method":0}`, ReasonRuntimeDenied, "", ""},
		{"call object only has method 0", `{"object":0,"method":1,"args":{"call-id":"c1"}}`, ReasonRuntimeDenied, "", ""},
		{"cancel call has only method 0", `{"object":10,"method":1,"args":{"call-id":"c1"}}`, ReasonRuntimeDenied, "", ""},
		{"unknown object", `{"object":13,"method":0}`, ReasonUnknownObject, "", ""},
		{"far unknown object", `{"object":99,"method":0}`, ReasonUnknownObject, "", ""},
		{"cancel without call-id", `{"object":10,"method":0,"args":{}}`, ReasonCallID, "CancelCall.Cancel", ""},
		{"cancel without args", `{"object":10,"method":0}`, ReasonCallArgs, "CancelCall.Cancel", ""},
		{"cancel with extra key", `{"object":10,"method":0,"args":{"call-id":"c1","x":1}}`,
			ReasonUnknownKey, "CancelCall.Cancel", ""},
		{"cancel with a non-string id", `{"object":10,"method":0,"args":{"call-id":7}}`,
			ReasonCallID, "CancelCall.Cancel", ""},
		{"cancel with a hostile id", `{"object":10,"method":0,"args":{"call-id":"a b"}}`,
			ReasonCallID, "CancelCall.Cancel", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			verdict := policy.EvaluateRuntime(post(tt.body))
			require.Equal(t, tt.reason, verdict.Reason)
			require.Equal(t, tt.subject, verdict.Subject)
			if tt.reason != ReasonAllowed {
				require.False(t, verdict.Allowed)
				require.Nil(t, verdict.Forward)
				return
			}
			require.True(t, verdict.Allowed)
			want := tt.forward
			if want == "" {
				want = tt.body
			}
			require.Equal(t, want, string(verdict.Forward))
		})
	}
}

// TestRuntimeObjectSweep tries every small object and method number and
// checks that exactly the reviewed read-only calls get through.
func TestRuntimeObjectSweep(t *testing.T) {
	policy := defaultPolicy(t)
	allowed := map[[2]int]bool{{6, 13}: true, {6, 14}: true, {6, 18}: true, {8, 0}: true, {8, 1}: true, {8, 2}: true}
	for object := range 40 {
		for method := range 100 {
			body := fmt.Sprintf(`{"object":%d,"method":%d}`, object, method)
			verdict := policy.EvaluateRuntime(post(body))
			require.Equal(t, allowed[[2]int{object, method}], verdict.Allowed, body)
		}
	}
}

// TestEvaluateRuntimeMethodSelection covers the by-name and by-ID forms of a
// method, including the precedence trap in Wails: it prefers methodName when
// it is non-empty and silently falls back to methodID.
func TestEvaluateRuntimeMethodSelection(t *testing.T) {
	policy := defaultPolicy(t)
	allowedID := MethodID(fqnAllowed)
	deniedID := MethodID(fqnDeniedTerminal)
	tests := []struct {
		name   string
		body   string
		reason Reason
		fqn    string
	}{
		{"denied method by name", callByName(fqnDeniedTerminal, "[]"), ReasonMethodDenied, fqnDeniedTerminal},
		{"denied method by id", callByID(fqnDeniedTerminal, "[]"), ReasonMethodDenied, fqnDeniedTerminal},
		{"denied method with malformed arguments is still denied",
			callWith(byID(deniedID), `"args":7`), ReasonMethodDenied, fqnDeniedTerminal},
		{"unknown name", callWith(byName("main.AppService.Nope"), noArgs), ReasonUnknownMethod, ""},
		{"name differing in case", callWith(byName("main.appservice.getinstanceinfo"), noArgs), ReasonUnknownMethod, ""},
		{"name with surrounding space", callWith(byName(" "+fqnAllowed), noArgs), ReasonMethodName, ""},
		{"empty name", callWith(`"methodName":""`, noArgs), ReasonMethodName, ""},
		{"null name", callWith(`"methodName":null`, noArgs), ReasonMethodName, ""},
		{"numeric name", callWith(`"methodName":5`, noArgs), ReasonMethodName, ""},
		{"overlong name", callWith(byName(strings.Repeat("a", maxMethodNameBytes+1)), noArgs), ReasonMethodName, ""},
		{"non-ascii name", callWith(`"methodName":"`+fqnAllowed+`\u00e9"`, noArgs), ReasonMethodName, ""},
		{"control character in name", callWith(`"methodName":"main.AppService.Get\tInstanceInfo"`, noArgs),
			ReasonMethodName, ""},
		{"lone surrogate in name", callWith(`"methodName":"`+fqnAllowed+`\ud800"`, noArgs), ReasonMethodName, ""},
		{"unknown id", callWith(`"methodID":1`, noArgs), ReasonUnknownMethodID, ""},
		{"id zero", callWith(`"methodID":0`, noArgs), ReasonUnknownMethodID, ""},
		{"maximum id", callWith(`"methodID":4294967295`, noArgs), ReasonUnknownMethodID, ""},
		{"id above uint32", callWith(`"methodID":4294967296`, noArgs), ReasonMethodID, ""},
		{"negative id", callWith(`"methodID":-1`, noArgs), ReasonMethodID, ""},
		{"fractional id", callWith(byID(allowedID)+`.0`, noArgs), ReasonMethodID, ""},
		{"exponent id", callWith(`"methodID":6.78226073e8`, noArgs), ReasonMethodID, ""},
		{"string id", callWith(`"methodID":"`+strconv.FormatUint(uint64(allowedID), 10)+`"`, noArgs), ReasonMethodID, ""},
		{"null id", callWith(`"methodID":null`, noArgs), ReasonMethodID, ""},
		{"boolean id", callWith(`"methodID":true`, noArgs), ReasonMethodID, ""},
		{"leading zero id", callWith(`"methodID":0`+strconv.FormatUint(uint64(allowedID), 10), noArgs),
			ReasonMalformedJSON, ""},
		{"neither name nor id", callWith(noArgs), ReasonMethodSelector, ""},
		{"both name and id", callWith(byName(fqnAllowed), byID(allowedID), noArgs), ReasonMethodSelector, ""},
		{"safe name with a denied id", callWith(byName(fqnAllowed), byID(deniedID), noArgs), ReasonMethodSelector, ""},
		{"empty name with an id", callWith(`"methodName":""`, byID(deniedID), noArgs), ReasonMethodSelector, ""},
		{"id then empty name", callWith(byID(deniedID), `"methodName":""`, noArgs), ReasonMethodSelector, ""},
		{"missing argument array", callWith(byID(allowedID)), ReasonCallArgs, fqnAllowed},
		{"null argument array", callWith(byID(allowedID), `"args":null`), ReasonCallArgs, fqnAllowed},
		{"object argument array", callWith(byID(allowedID), `"args":{}`), ReasonCallArgs, fqnAllowed},
		{"unknown call option", callWith(byID(allowedID), noArgs, `"timeout":5`), ReasonUnknownKey, ""},
		{"call options with a non-canonical key", callWith(`"MethodID":`+strconv.FormatUint(uint64(allowedID), 10), noArgs),
			ReasonUnknownKey, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			verdict := policy.EvaluateRuntime(post(tt.body))
			require.False(t, verdict.Allowed, "request must be denied")
			require.Equal(t, tt.reason, verdict.Reason)
			require.Equal(t, tt.fqn, verdict.FQN)
			require.Nil(t, verdict.Forward)
		})
	}
}

func TestEvaluateRuntimeCallEnvelope(t *testing.T) {
	policy := defaultPolicy(t)
	idMember := byID(MethodID(fqnAllowed))
	withCallID := func(callID string) string {
		return `{"object":0,"method":0,"args":{"call-id":` + callID + `,` + idMember + `,` + noArgs + `}}`
	}
	tests := []struct {
		name   string
		body   string
		reason Reason
	}{
		{"call without args", `{"object":0,"method":0}`, ReasonCallArgs},
		{"call with null args", `{"object":0,"method":0,"args":null}`, ReasonCallArgs},
		{"call with array args", `{"object":0,"method":0,"args":[]}`, ReasonCallArgs},
		{"call with string args", `{"object":0,"method":0,"args":"x"}`, ReasonCallArgs},
		{"missing call id", `{"object":0,"method":0,"args":{` + idMember + `,` + noArgs + `}}`, ReasonCallID},
		{"numeric call id", withCallID(`1`), ReasonCallID},
		{"object call id", withCallID(`{}`), ReasonCallID},
		{"empty call id", withCallID(`""`), ReasonCallID},
		{"overlong call id", withCallID(strconv.Quote(strings.Repeat("a", maxCallIDBytes+1))), ReasonCallID},
		{"call id with a slash", withCallID(`"a/b"`), ReasonCallID},
		{"call id with unicode", withCallID(`"\u00e9"`), ReasonCallID},
		{"unknown envelope key", `{"object":0,"method":0,"extra":1,"args":{"call-id":"c1",` + idMember + `,` + noArgs + `}}`,
			ReasonUnknownKey},
		{"missing object", `{"method":0}`, ReasonEnvelope},
		{"missing method", `{"object":6}`, ReasonEnvelope},
		{"empty envelope", `{}`, ReasonEnvelope},
		{"array body", `[]`, ReasonEnvelope},
		{"null body", `null`, ReasonEnvelope},
		{"string body", `"x"`, ReasonEnvelope},
		{"number body", `7`, ReasonEnvelope},
		{"fractional object", `{"object":0.0,"method":0}`, ReasonEnvelope},
		{"exponent object", `{"object":1e0,"method":0}`, ReasonEnvelope},
		{"string object", `{"object":"0","method":0}`, ReasonEnvelope},
		{"negative zero object", `{"object":-0,"method":0}`, ReasonEnvelope},
		{"negative object", `{"object":-1,"method":0}`, ReasonEnvelope},
		{"boolean object", `{"object":true,"method":0}`, ReasonEnvelope},
		{"null object", `{"object":null,"method":0}`, ReasonEnvelope},
		{"array object", `{"object":[0],"method":0}`, ReasonEnvelope},
		{"huge object", `{"object":99999999999999999999,"method":0}`, ReasonEnvelope},
		{"fractional method", `{"object":6,"method":18.0}`, ReasonEnvelope},
		{"exponent method", `{"object":6,"method":1.8e1}`, ReasonEnvelope},
		{"string method", `{"object":6,"method":"18"}`, ReasonEnvelope},
		{"negative method", `{"object":6,"method":-1}`, ReasonEnvelope},
		{"leading zero object", `{"object":00,"method":0}`, ReasonMalformedJSON},
		{"hex object", `{"object":0x0,"method":0}`, ReasonMalformedJSON},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			verdict := policy.EvaluateRuntime(post(tt.body))
			require.False(t, verdict.Allowed, "request must be denied")
			require.Equal(t, tt.reason, verdict.Reason)
			require.Nil(t, verdict.Forward)
		})
	}
}

func TestEvaluateRuntimeRejectsParserDifferentials(t *testing.T) {
	policy := defaultPolicy(t)
	id := MethodID(fqnAllowed)
	deniedID := MethodID(fqnDeniedTerminal)
	idMember := byID(id)
	withArgs := func(args string) string { return callWith(idMember, `"args":`+args) }
	nested := func(depth int) string {
		return withArgs("[" + strings.Repeat("[", depth) + strings.Repeat("]", depth) + "]")
	}
	tests := []struct {
		name   string
		body   string
		reason Reason
	}{
		// Go's decoder keeps the last duplicate; a first-wins reader would
		// authorize one method while Wails runs the other.
		{"duplicate object", `{"object":0,"object":2,"method":0}`, ReasonDuplicateKey},
		{"duplicate method", `{"object":2,"method":0,"method":2}`, ReasonDuplicateKey},
		{"duplicate args", `{"object":6,"method":18,"args":null,"args":{}}`, ReasonDuplicateKey},
		{"duplicate method name", callWith(byName(fqnAllowed), byName(fqnDeniedTerminal), noArgs), ReasonDuplicateKey},
		{"duplicate method id", callWith(idMember, byID(deniedID), noArgs), ReasonDuplicateKey},
		{"duplicate call id", `{"object":0,"method":0,"args":{"call-id":"a","call-id":"b",` + idMember + `,` + noArgs + `}}`,
			ReasonDuplicateKey},
		{"duplicate inside an argument", withArgs(`[{"k":1,"k":2}]`), ReasonDuplicateKey},
		{"duplicate deep inside an argument", withArgs(`[[{"a":{"b":[{"k":1,"k":1}]}}]]`), ReasonDuplicateKey},
		{"duplicate via escape", `{"object":0,"\u006fbject":2,"method":0}`, ReasonDuplicateKey},
		// Go matches keys case-insensitively, so these collide in the upstream.
		{"case folded object", `{"object":0,"Object":2,"method":0}`, ReasonCaseFoldedKey},
		{"case folded method id", callWith(idMember, `"MethodID":`+strconv.FormatUint(uint64(deniedID), 10), noArgs),
			ReasonCaseFoldedKey},
		{"case folded method name", callWith(byName(fqnAllowed), `"METHODNAME":`+strconv.Quote(fqnDeniedTerminal), noArgs),
			ReasonCaseFoldedKey},
		{"case folded inside an argument", withArgs(`[{"name":1,"Name":2}]`), ReasonCaseFoldedKey},
		{"kelvin sign folds to k", withArgs(`[{"k":1,"\u212a":2}]`), ReasonCaseFoldedKey},
		{"long s folds to s", `{"object":6,"method":18,"args":null,"arg\u017f":1}`, ReasonCaseFoldedKey},
		// A lone non-canonical spelling is not a collision but is still unknown.
		{"non-canonical object key", `{"Object":0,"method":0}`, ReasonUnknownKey},
		{"non-canonical args key", `{"object":6,"method":18,"ARGS":null}`, ReasonUnknownKey},
		{"kelvin sign as an unknown key", `{"object":6,"method":18,"args":null,"\u212a":1}`, ReasonUnknownKey},
		{"unknown envelope key", `{"object":6,"method":18,"x":1}`, ReasonUnknownKey},
		{"escaped canonical key is the same key", `{"\u006fbject":6,"method":18}`, ReasonAllowed},
		// Syntax and encoding.
		{"invalid utf-8 in a string", "{\"object\":6,\"method\":18,\"args\":null,\"x\":\"\xff\"}", ReasonInvalidUTF8},
		{"invalid utf-8 in a key", "{\"object\":6,\"method\":18,\"\xc3\x28\":1}", ReasonInvalidUTF8},
		{"truncated utf-8", "{\"object\":6,\"method\":18}\xe2\x82", ReasonInvalidUTF8},
		{"byte order mark", "\xef\xbb\xbf{\"object\":6,\"method\":18}", ReasonMalformedJSON},
		{"trailing value", `{"object":6,"method":18}{"object":2,"method":2}`, ReasonTrailingData},
		{"trailing garbage", `{"object":6,"method":18} x`, ReasonTrailingData},
		{"trailing comma", `{"object":6,"method":18,}`, ReasonMalformedJSON},
		{"missing colon", `{"object" 6,"method":18}`, ReasonMalformedJSON},
		{"single quotes", `{'object':6,'method':18}`, ReasonMalformedJSON},
		{"truncated body", `{"object":6,"method":`, ReasonMalformedJSON},
		{"unclosed object", `{"object":6,"method":18`, ReasonMalformedJSON},
		{"comment", `{"object":6,/* x */"method":18}`, ReasonMalformedJSON},
		{"nan", `{"object":NaN,"method":18}`, ReasonMalformedJSON},
		{"raw control character in a string", "{\"object\":6,\"method\":18,\"args\":null,\"x\":\"a\nb\"}",
			ReasonMalformedJSON},
		{"invalid escape", `{"object":6,"method":18,"args":null,"x":"\q"}`, ReasonMalformedJSON},
		{"lone surrogate escape in an argument is only data", withArgs(`["\ud800"]`), ReasonAllowed},
		{"whitespace around the document", " \n\t{\"object\":6,\"method\":18}\r\n ", ReasonAllowed},
		// Depth: an argument may nest to the limit and no further.
		{"deepest accepted nesting", nested(maxJSONDepth - 3), ReasonAllowed},
		{"nesting one level too deep", nested(maxJSONDepth - 2), ReasonTooDeep},
		{"absurd nesting", nested(5000), ReasonTooDeep},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			verdict := policy.EvaluateRuntime(post(tt.body))
			require.Equal(t, tt.reason, verdict.Reason)
			require.Equal(t, tt.reason == ReasonAllowed, verdict.Allowed)
			if !verdict.Allowed {
				require.Nil(t, verdict.Forward)
			}
		})
	}
}

// requestChange edits a well-formed request.
type requestChange func(*RuntimeRequest)

func withMethod(method string) requestChange { return func(r *RuntimeRequest) { r.Method = method } }
func withQuery(query string) requestChange   { return func(r *RuntimeRequest) { r.RawQuery = query } }
func withBody(body string) requestChange     { return func(r *RuntimeRequest) { r.Body = []byte(body) } }

func setHeader(key, value string) requestChange {
	return func(r *RuntimeRequest) { r.Header.Set(key, value) }
}

func addHeader(key, value string) requestChange {
	return func(r *RuntimeRequest) { r.Header.Add(key, value) }
}

// rawHeader stores a header under key exactly as given, bypassing the
// canonicalization of http.Header.Set.
func rawHeader(key, value string) requestChange {
	return func(r *RuntimeRequest) { r.Header[key] = []string{value} }
}

func TestEvaluateRuntimeRequestFraming(t *testing.T) {
	policy := defaultPolicy(t)
	good := callByID(fqnAllowed, "[]")
	callInQuery := "object=0&method=0&args=" +
		"%7B%22call-id%22%3A%22c1%22%2C%22methodID%22%3A678226073%2C%22args%22%3A%5B%5D%7D"
	tests := []struct {
		name   string
		change requestChange
		reason Reason
	}{
		{"get", withMethod(http.MethodGet), ReasonHTTPMethod},
		{"put", withMethod(http.MethodPut), ReasonHTTPMethod},
		{"empty method", withMethod(""), ReasonHTTPMethod},
		{"lowercase post", withMethod("post"), ReasonHTTPMethod},

		// The Wails protocol falls back to the query string when the body is
		// empty; the gateway must make that form unreachable.
		{"empty body with the call in the query string", func(r *RuntimeRequest) {
			withBody("")(r)
			withQuery(callInQuery)(r)
		}, ReasonQuery},
		{"empty body with application quit in the query string", func(r *RuntimeRequest) {
			withBody("")(r)
			withQuery("object=2&method=2")(r)
		}, ReasonQuery},
		{"valid body with a query string", withQuery("object=2&method=2"), ReasonQuery},
		{"valid body with a bare query", withQuery("x"), ReasonQuery},
		{"empty body", withBody(""), ReasonEmptyBody},
		{"nil body", func(r *RuntimeRequest) { r.Body = nil }, ReasonEmptyBody},
		{"oversized body", withBody(strings.Repeat(" ", MaxRuntimeBodyBytes+1)), ReasonBodyTooLarge},
		{"huge body", withBody(strings.Repeat("a", 4*MaxRuntimeBodyBytes)), ReasonBodyTooLarge},

		{"chunk id", setHeader("X-Wails-Chunk-Id", "abc"), ReasonChunked},
		{"chunk index", setHeader("X-Wails-Chunk-Index", "0"), ReasonChunked},
		{"chunk total of one", setHeader("X-Wails-Chunk-Total", "1"), ReasonChunked},
		{"chunk header with an empty value", setHeader("X-Wails-Chunk-Id", ""), ReasonChunked},
		{"chunk header with a non-canonical key", rawHeader("x-wails-chunk-id", "abc"), ReasonChunked},
		{"chunk header with an upper-case key", rawHeader("X-WAILS-CHUNK-ID", "abc"), ReasonChunked},
		{"unknown future chunk header", setHeader("X-Wails-Chunk-Token", "t"), ReasonChunked},

		{"missing content type", func(r *RuntimeRequest) { r.Header.Del("Content-Type") }, ReasonContentType},
		{"text content type", setHeader("Content-Type", "text/plain"), ReasonContentType},
		{"form content type", setHeader("Content-Type", "application/x-www-form-urlencoded"), ReasonContentType},
		{"json lookalike", setHeader("Content-Type", "application/jsonp"), ReasonContentType},
		{"json with a boundary", setHeader("Content-Type", "application/json; boundary=x"), ReasonContentType},
		{"json with another charset", setHeader("Content-Type", "application/json; charset=latin1"), ReasonContentType},
		{"two content types", addHeader("Content-Type", "application/json"), ReasonContentType},
		{"malformed content type", setHeader("Content-Type", "application/json; =x"), ReasonContentType},

		{"overlong client id", setHeader("X-Wails-Client-Id", strings.Repeat("a", maxClientIDBytes+1)), ReasonClientID},
		{"client id with a space", setHeader("X-Wails-Client-Id", "a b"), ReasonClientID},
		{"client id with a slash", setHeader("X-Wails-Client-Id", "a/b"), ReasonClientID},
		{"client id with unicode", setHeader("X-Wails-Client-Id", "caf\u00e9"), ReasonClientID},
		{"two client ids", func(r *RuntimeRequest) {
			addHeader("X-Wails-Client-Id", "a")(r)
			addHeader("X-Wails-Client-Id", "b")(r)
		}, ReasonClientID},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := post(good)
			tt.change(&request)
			verdict := policy.EvaluateRuntime(request)
			require.False(t, verdict.Allowed, "request must be denied")
			require.Equal(t, tt.reason, verdict.Reason)
			require.Nil(t, verdict.Forward)
		})
	}

	t.Run("a nil header is a missing content type", func(t *testing.T) {
		request := post(good)
		request.Header = nil
		require.Equal(t, ReasonContentType, policy.EvaluateRuntime(request).Reason)
	})

	t.Run("accepted content types and client id", func(t *testing.T) {
		for _, contentType := range []string{
			"application/json", "application/json; charset=utf-8", "Application/JSON;Charset=UTF-8",
		} {
			request := post(good)
			request.Header.Set("Content-Type", contentType)
			request.Header.Set("X-Wails-Client-Id", "kV9_-aZ0")
			verdict := policy.EvaluateRuntime(request)
			require.True(t, verdict.Allowed, contentType)
			require.Equal(t, "kV9_-aZ0", verdict.ClientID)
		}
	})

	t.Run("window selection headers are not part of the verdict", func(t *testing.T) {
		request := post(good)
		request.Header.Set("X-Wails-Window-Id", "1")
		request.Header.Set("X-Wails-Window-Name", "main")
		verdict := policy.EvaluateRuntime(request)
		require.True(t, verdict.Allowed)
		require.Empty(t, verdict.ClientID)
	})
}

func TestEvaluateRuntimeRoutes(t *testing.T) {
	policy := defaultPolicy(t)
	body := callByID(fqnAllowed, "[]")
	tests := []struct {
		path   string
		reason Reason
	}{
		{"/wails/runtime/", ReasonRoute},
		{"/wails/runtime.js", ReasonRoute},
		{"/wails/runtime?x=1", ReasonRoute},
		{"/wails%2Fruntime", ReasonRoute},
		{"/wails%2fruntime", ReasonRoute},
		{"/wails/%72untime", ReasonRoute},
		{"//wails/runtime", ReasonRoute},
		{"/wails//runtime", ReasonRoute},
		{"/wails/./runtime", ReasonRoute},
		{"/wails/x/../runtime", ReasonRoute},
		{"/Wails/Runtime", ReasonRoute},
		{"/wails/runtime;x=y", ReasonRoute},
		{"/wails/runtime%00", ReasonRoute},
		{"wails/runtime", ReasonRoute},
		{"", ReasonRoute},
		{"/", ReasonRoute},
		{"/wails/events", ReasonRoute},
		{"/wails/custom.js", ReasonRoute},
		{"/wails/eventpayload/0123456789abcdef0123456789abcdef", ReasonRoute},
		{"/wails/streamer", ReasonRoute},
		{"/wails/stream", ReasonStream},
		{"/wails/stream/ws", ReasonStream},
		{"/wails/stream/poll", ReasonStream},
		{"/wails/stream/send", ReasonStream},
		{"/wails%2Fstream/ws", ReasonStream},
		{"/wails/%73tream/ws", ReasonStream},
		{"/WAILS/STREAM/ws", ReasonStream},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			request := post(body)
			request.Path = tt.path
			verdict := policy.EvaluateRuntime(request)
			require.False(t, verdict.Allowed)
			require.Equal(t, tt.reason, verdict.Reason)
			require.Nil(t, verdict.Forward)
		})
	}
}

func TestClassifyPath(t *testing.T) {
	require.Equal(t, PathRuntime, ClassifyPath("/wails/runtime"))
	require.Equal(t, PathEvents, ClassifyPath("/wails/events"))
	require.Equal(t, PathStream, ClassifyPath("/wails/stream/ws"))
	others := []string{"/", "/wails/events/", "/wails/Events", "/_/plugins/x/assets/a.js", "/wails/runtime.js"}
	for _, path := range others {
		require.Equal(t, PathOther, ClassifyPath(path), path)
	}
}

func TestValidClientID(t *testing.T) {
	valid := []string{"a", "A", "0", "_", "-", "V1StGXR8_Z5jdHi6B-myT", strings.Repeat("a", maxClientIDBytes)}
	for _, id := range valid {
		require.True(t, ValidClientID(id), id)
	}
	invalid := []string{"", " ", "a b", "a/b", "a.b", "a:b", "a\n", "a\u00e9", strings.Repeat("a", maxClientIDBytes+1)}
	for _, id := range invalid {
		require.False(t, ValidClientID(id), id)
	}
}

// TestEveryMethodResolvesToOneFQN checks the whole table: each method is
// reachable by name and by ID, both forms give the same verdict, and only
// allow rows ever produce a forwardable body.
func TestEveryMethodResolvesToOneFQN(t *testing.T) {
	policy := defaultPolicy(t)
	for _, rule := range policy.Methods() {
		byNameVerdict := policy.EvaluateRuntime(post(callByName(rule.FQN, "[1]")))
		byIDVerdict := policy.EvaluateRuntime(post(callByID(rule.FQN, "[1]")))
		require.Equal(t, byNameVerdict, byIDVerdict, rule.FQN)
		require.Equal(t, rule.FQN, byNameVerdict.FQN, rule.FQN)
		if rule.Decision == Allow {
			require.True(t, byNameVerdict.Allowed, rule.FQN)
			require.Equal(t, canonicalCall(rule.FQN, "[1]"), string(byNameVerdict.Forward), rule.FQN)
			continue
		}
		require.False(t, byNameVerdict.Allowed, rule.FQN)
		require.Equal(t, ReasonMethodDenied, byNameVerdict.Reason, rule.FQN)
		require.Nil(t, byNameVerdict.Forward, rule.FQN)
	}
}

func TestVerdictsNeverEchoRequestText(t *testing.T) {
	policy := defaultPolicy(t)
	const marker = "SECRET-MARKER-7f3a"
	for _, body := range []string{
		callWith(byName(marker), noArgs),
		callWith(byName("main.AppService.Nope"), `"args":["`+marker+`"]`),
		`{"object":0,"method":0,"args":{"call-id":"` + marker + `","methodID":1,"args":[]}}`,
		`{"object":0,"` + marker + `":1}`,
		`{"object":9,"method":0,"args":{"url":"` + marker + `"}}`,
	} {
		verdict := policy.EvaluateRuntime(post(body))
		require.False(t, verdict.Allowed)
		require.NotContains(t, fmt.Sprintf("%+v", verdict), marker, body)
	}
}

// wailsCall is what Wails would run for a body.
type wailsCall struct {
	object int
	method int
	fqn    string
}

// wailsView mirrors how Wails v3 reads a /wails/runtime body: encoding/json
// into the transport and call option structs (case-insensitive keys, last
// duplicate wins), methodName preferred over methodID.
func wailsView(policy *Policy, body []byte) (wailsCall, bool) {
	var request struct {
		Object *int            `json:"object"`
		Method *int            `json:"method"`
		Args   json.RawMessage `json:"args"`
	}
	if err := json.Unmarshal(body, &request); err != nil || request.Object == nil || request.Method == nil {
		return wailsCall{}, false
	}
	call := wailsCall{object: *request.Object, method: *request.Method}
	if call.object != 0 || call.method != 0 {
		return call, true
	}
	var options struct {
		MethodName string            `json:"methodName"`
		Args       []json.RawMessage `json:"args"`
		MethodID   uint32            `json:"methodID"`
	}
	if err := json.Unmarshal(request.Args, &options); err != nil {
		return call, false
	}
	if options.MethodName != "" {
		rule, found := policy.Method(options.MethodName)
		call.fqn = rule.FQN
		return call, found
	}
	rule, found := policy.MethodByID(options.MethodID)
	call.fqn = rule.FQN
	return call, found
}

// FuzzEvaluateRuntime states the property that makes the gateway safe: for any
// body the evaluator allows, the method Wails would run from the original
// bytes, the method it would run from the forwarded bytes, and the method the
// evaluator authorized are one and the same allow row, and the forwarded body
// is a fixed point of the evaluator.
func FuzzEvaluateRuntime(f *testing.F) {
	policy := defaultPolicy(f)
	id := MethodID(fqnAllowed)
	deniedID := MethodID(fqnDeniedTerminal)
	for _, seed := range []string{
		callByID(fqnAllowed, "[]"),
		callByName(fqnAllowed, `[{"a":[1,2]}]`),
		callByID(fqnDeniedTerminal, "[]"),
		`{"object":6,"method":18}`,
		`{"object":10,"method":0,"args":{"call-id":"c1"}}`,
		`{"object":2,"method":2}`,
		`{"object":0,"Object":2,"method":0}`,
		callWith(`"methodName":""`, byID(deniedID), noArgs),
		callWith(byID(id), byID(deniedID), noArgs),
		callWith(byID(id), `"MethodID":`+strconv.FormatUint(uint64(deniedID), 10), noArgs),
		callWith(byID(id), `"args":[{"k":1,"\u212a":2}]`),
		"\xef\xbb\xbf{}",
		`{}`,
	} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, body []byte) {
		verdict := policy.EvaluateRuntime(post(string(body)))
		if !verdict.Allowed {
			require.Nil(t, verdict.Forward)
			return
		}
		original, ok := wailsView(policy, body)
		require.True(t, ok, "Wails cannot read a body the gateway allowed: %q", body)
		forwarded, ok := wailsView(policy, verdict.Forward)
		require.True(t, ok, "Wails cannot read the forwarded body: %q", verdict.Forward)
		require.Equal(t, original, forwarded, "original and forwarded bodies differ for Wails: %q", body)
		require.Equal(t, wailsCall{object: verdict.Object, method: verdict.Method, fqn: verdict.FQN}, original)
		if original.fqn != "" {
			rule, found := policy.Method(original.fqn)
			require.True(t, found)
			require.Equal(t, Allow, rule.Decision, "allowed a body that runs %s", original.fqn)
		}
		again := policy.EvaluateRuntime(post(string(verdict.Forward)))
		require.True(t, again.Allowed, "forwarded body is not accepted: %q", verdict.Forward)
		require.True(t, bytes.Equal(verdict.Forward, again.Forward),
			"forwarded body is not canonical: %q vs %q", verdict.Forward, again.Forward)
	})
}
