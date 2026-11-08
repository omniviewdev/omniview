package auditgate

import (
	"bytes"
	"encoding/json"
	"mime"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
)

const (
	// MaxRuntimeBodyBytes bounds a /wails/runtime request body the evaluator
	// inspects. Wails accepts 64 MiB; a read-only audit has no use for that.
	// Callers must read at most MaxRuntimeBodyBytes+1 bytes of the body.
	MaxRuntimeBodyBytes = 1 << 20

	maxMethodNameBytes = 256
	maxCallIDBytes     = 64
	maxClientIDBytes   = 64
	// maxCallIDPrefixBytes bounds a call-id prefix including its terminator.
	maxCallIDPrefixBytes = 32
	// callIDPrefixTerminators are the characters a call-id prefix must end in.
	// Client call-ids are limited to [A-Za-z0-9_-], so none of these can occur
	// inside one.
	callIDPrefixTerminators = "/:."
	// maxIndexDigits bounds an object or method number. Wails has a few dozen
	// of each; nine digits cannot overflow an int.
	maxIndexDigits = 9
	// maxUint32Digits is the length of the largest uint32, 4294967295.
	maxUint32Digits = 10
	// canonicalOverhead is spare buffer capacity for the fixed envelope text
	// around a canonical call.
	canonicalOverhead = 96

	runtimePath        = "/wails/runtime"
	eventsPath         = "/wails/events"
	streamPathPrefix   = "/wails/stream"
	chunkHeaderPrefix  = "x-wails-chunk-"
	windowHeaderPrefix = "x-wails-window-"
	jsonWhitespace     = " \t\r\n"

	objectCall       = 0
	methodCallBound  = 0
	objectCancelCall = 10
	methodCancelCall = 0
)

// Reason explains an evaluator outcome. Values are stable machine codes that
// never contain request data, so they are safe to log and to return.
type Reason string

// Evaluator outcomes. Everything except ReasonAllowed is a denial.
const (
	ReasonAllowed Reason = "allowed"

	// Request line, headers and body framing.

	ReasonHTTPMethod   Reason = "http_method_not_allowed"
	ReasonRoute        Reason = "route_not_runtime"
	ReasonStream       Reason = "stream_denied"
	ReasonQuery        Reason = "query_forbidden"
	ReasonChunked      Reason = "chunked_forbidden"
	ReasonWindowHeader Reason = "window_header_forbidden"
	ReasonContentType  Reason = "content_type"
	ReasonClientID     Reason = "client_id"
	ReasonCallIDPrefix Reason = "call_id_prefix"
	ReasonEmptyBody    Reason = "empty_body"
	ReasonBodyTooLarge Reason = "body_too_large"

	// JSON syntax and parser-differential defenses.

	ReasonInvalidUTF8   Reason = "invalid_utf8"
	ReasonMalformedJSON Reason = "malformed_json"
	ReasonTrailingData  Reason = "trailing_data"
	ReasonTooDeep       Reason = "too_deep"
	ReasonDuplicateKey  Reason = "duplicate_key"
	ReasonCaseFoldedKey Reason = "case_folded_key"

	// Envelope shape.

	ReasonEnvelope      Reason = "envelope"
	ReasonUnknownKey    Reason = "unknown_key"
	ReasonArgsForbidden Reason = "args_forbidden"

	// Runtime object policy.

	ReasonUnknownObject Reason = "unknown_object"
	ReasonRuntimeDenied Reason = "runtime_denied"

	// Bound-method calls.

	ReasonCallID          Reason = "call_id"
	ReasonCallArgs        Reason = "call_args"
	ReasonMethodSelector  Reason = "method_selector"
	ReasonMethodName      Reason = "method_name"
	ReasonMethodID        Reason = "method_id"
	ReasonUnknownMethod   Reason = "unknown_method"
	ReasonUnknownMethodID Reason = "unknown_method_id"
	ReasonMethodDenied    Reason = "method_denied"
)

// RuntimeRequest is the part of an inbound HTTP request the evaluator needs,
// plus the two facts about the session that only the gateway knows.
type RuntimeRequest struct {
	// Method is the HTTP method.
	Method string
	// Path is the request path exactly as received on the request line, with
	// no decoding or cleaning: the request target cut at "?", never the
	// decoded URL.Path.
	Path string
	// RawQuery is the raw query string, without the leading "?".
	RawQuery string
	// Header holds the request headers.
	Header http.Header
	// Body is the complete request body, at most MaxRuntimeBodyBytes+1 bytes.
	Body []byte
	// ClientID is the Wails client ID that the gateway bound to this session
	// and that this request must carry. The page, not the gateway, chooses
	// its client ID: the Wails runtime generates one at load and sends it in
	// x-wails-client-id and as the clientId query parameter of its events
	// socket. The gateway binds a session to the IDs that appear on the
	// session's own sockets, and passes here the bound ID the request names.
	// The request must carry exactly this value in x-wails-client-id; an
	// absent or different header is denied, and so is a ClientID that fails
	// ValidClientID.
	ClientID string
	// CallIDPrefix is prepended to the call-id of every forwarded call and of
	// every CancelCall, so one remote session cannot cancel or collide with
	// another session's in-flight calls. It is required and must satisfy
	// ValidCallIDPrefix: the evaluator denies every request of a session
	// whose prefix does not.
	CallIDPrefix string
}

// Verdict is the outcome of evaluating one runtime request.
type Verdict struct {
	Allowed bool
	Reason  Reason
	// Object and Method are the Wails runtime object and method numbers, or
	// -1 when the body did not get that far.
	Object int
	Method int
	// Subject names what the request would run: the bound method's fully
	// qualified name for a call, or "Object.Method" for a runtime object
	// call. It is set only when it resolved to an entry of the policy table,
	// so it never echoes unvetted request text.
	Subject string
	// FQN is the resolved bound method of a Call request, allowed or denied.
	FQN string
	// Forward is the canonical request body to send upstream. It is set only
	// when Allowed, and it is rebuilt from the parsed values: it never
	// contains the original bytes.
	Forward []byte
}

func deny(reason Reason) Verdict {
	return Verdict{
		Allowed: false, Reason: reason, Object: -1, Method: -1,
		Subject: "", FQN: "", Forward: nil,
	}
}

func rejected(verdict Verdict, reason Reason) Verdict {
	verdict.Allowed = false
	verdict.Reason = reason
	verdict.Forward = nil
	return verdict
}

func accepted(verdict Verdict, forward []byte) Verdict {
	verdict.Allowed = true
	verdict.Reason = ReasonAllowed
	verdict.Forward = forward
	return verdict
}

// EvaluateRuntime decides whether one POST /wails/runtime request may reach
// the host and, when it may, returns the canonical body to forward.
//
// The evaluation fails closed at every step. In order it enforces:
//   - POST to exactly /wails/runtime, with no query string (the empty-body
//     query-string form of the Wails protocol is thereby unreachable);
//   - a configured session: req.ClientID passes ValidClientID and
//     req.CallIDPrefix passes ValidCallIDPrefix;
//   - no x-wails-chunk-* header (a chunked call cannot be inspected in
//     pieces) and no x-wails-window-* header (those choose the window Wails
//     runs the call as, which only the gateway-assigned client ID may do);
//   - a JSON content type and exactly one x-wails-client-id header, equal to
//     req.ClientID;
//   - a non-empty body of at most MaxRuntimeBodyBytes;
//   - strict JSON: valid UTF-8, one value, bounded depth, no duplicate or
//     case-folded duplicate keys at any depth;
//   - an envelope of exactly {object, method[, args]};
//   - the runtime object table: unknown objects and unlisted methods are
//     denied, and Call is gated per bound method by the method table, where
//     the method may be named by methodName or methodID but never both, and
//     both forms resolve to the same fully qualified name.
//
// Header names are matched case-insensitively across every key of req.Header.
// Which window Wails runs an allowed call as depends on the upstream events
// socket the gateway holds for req.ClientID; the evaluator cannot see that,
// so the gateway must (see docs/development-audit-gateway.md).
func (p *Policy) EvaluateRuntime(req RuntimeRequest) Verdict {
	if req.Method != http.MethodPost {
		return deny(ReasonHTTPMethod)
	}
	switch ClassifyPath(req.Path) {
	case PathRuntime:
	case PathStream:
		return deny(ReasonStream)
	case PathOther, PathEvents:
		return deny(ReasonRoute)
	}
	if req.RawQuery != "" {
		return deny(ReasonQuery)
	}
	if !ValidClientID(req.ClientID) {
		return deny(ReasonClientID)
	}
	if !ValidCallIDPrefix(req.CallIDPrefix) {
		return deny(ReasonCallIDPrefix)
	}
	if reason := checkRuntimeHeaders(req.Header, req.ClientID); reason != "" {
		return deny(reason)
	}
	switch {
	case len(req.Body) == 0:
		return deny(ReasonEmptyBody)
	case len(req.Body) > MaxRuntimeBodyBytes:
		return deny(ReasonBodyTooLarge)
	}
	if reason := checkStrictJSON(req.Body); reason != "" {
		return deny(reason)
	}
	return p.evaluateEnvelope(req.Body, req.CallIDPrefix)
}

// Route classifies a request path.
type Route int

// Request path classes.
const (
	// PathOther is any path the evaluator does not handle itself.
	PathOther Route = iota
	// PathRuntime is exactly /wails/runtime.
	PathRuntime
	// PathEvents is exactly /wails/events, the backend event WebSocket.
	PathEvents
	// PathStream is anything under /wails/stream, the Wails stream
	// transport. The host registers no stream handler, so it is denied.
	PathStream
)

// ClassifyPath classifies the raw request path. Only the exact, undecoded
// spellings of /wails/runtime and /wails/events match those routes; encoded,
// cleaned or differently cased variants are PathOther. Stream paths are
// recognized under percent-decoding and case folding too, so denial reasons
// stay accurate for disguised requests; they are denied either way.
//
// PathOther is a classification, not a decision: the evaluator forwards
// nothing for it, and the gateway serves it only from its own static-route
// allowlist (see docs/development-audit-gateway.md) or answers 404/405.
func ClassifyPath(rawPath string) Route {
	switch rawPath {
	case runtimePath:
		return PathRuntime
	case eventsPath:
		return PathEvents
	}
	candidate := rawPath
	if decoded, err := url.PathUnescape(rawPath); err == nil {
		candidate = decoded
	}
	candidate = strings.ToLower(candidate)
	if candidate == streamPathPrefix || strings.HasPrefix(candidate, streamPathPrefix+"/") {
		return PathStream
	}
	return PathOther
}

// ValidClientID reports whether s is acceptable as a Wails client identifier:
// 1 to 64 characters of A-Z, a-z, 0-9, "_" and "-". The runtime generates
// nanoid values, which use exactly that alphabet. The same rule applies to the
// x-wails-client-id header and to the clientId query parameter of the event
// socket.
func ValidClientID(s string) bool {
	return validIdentifier(s, maxClientIDBytes)
}

// ValidCallIDPrefix reports whether s is acceptable as RuntimeRequest.
// CallIDPrefix: one or more characters of A-Z, a-z, 0-9, "_" and "-", then
// exactly one terminator from "/", ":" and ".", at most 32 bytes in all. The
// terminator cannot occur in a client call-id, so one prefix can never be a
// prefix of another session's forwarded IDs: with "s1/" and "s12/" the IDs
// "s1/2x" and "s12/x" stay distinct, which "s1" and "s12" would not keep.
func ValidCallIDPrefix(s string) bool {
	if len(s) < 2 || len(s) > maxCallIDPrefixBytes {
		return false
	}
	terminator := s[len(s)-1]
	if !strings.ContainsRune(callIDPrefixTerminators, rune(terminator)) {
		return false
	}
	return validIdentifier(s[:len(s)-1], maxCallIDPrefixBytes)
}

func validIdentifier(s string, limit int) bool {
	if s == "" || len(s) > limit {
		return false
	}
	for i := range len(s) {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '_', c == '-':
		default:
			return false
		}
	}
	return true
}

// checkRuntimeHeaders applies the header rules. Names are matched
// case-insensitively across every key, so a non-canonical spelling cannot hide
// from a check. The chunk check runs before the window check so the reported
// reason does not depend on map order.
func checkRuntimeHeaders(header http.Header, clientID string) Reason {
	if hasHeaderPrefix(header, chunkHeaderPrefix) {
		return ReasonChunked
	}
	if hasHeaderPrefix(header, windowHeaderPrefix) {
		return ReasonWindowHeader
	}
	types := headerValues(header, "Content-Type")
	if len(types) != 1 || !isJSONContentType(types[0]) {
		return ReasonContentType
	}
	ids := headerValues(header, "X-Wails-Client-Id")
	if len(ids) != 1 || ids[0] != clientID {
		return ReasonClientID
	}
	return ""
}

// hasHeaderPrefix reports whether any header name starts with prefix, which
// must be lower case.
func hasHeaderPrefix(header http.Header, prefix string) bool {
	for name := range header {
		if strings.HasPrefix(strings.ToLower(name), prefix) {
			return true
		}
	}
	return false
}

// headerValues returns every value of the named header across all keys that
// match it case-insensitively.
func headerValues(header http.Header, name string) []string {
	var values []string
	for key, entries := range header {
		if strings.EqualFold(key, name) {
			values = append(values, entries...)
		}
	}
	return values
}

// isJSONContentType accepts application/json, optionally with a UTF-8 charset
// and no other parameter.
func isJSONContentType(value string) bool {
	mediaType, params, err := mime.ParseMediaType(value)
	if err != nil || mediaType != "application/json" {
		return false
	}
	for name, v := range params {
		if name != "charset" || !strings.EqualFold(v, "utf-8") {
			return false
		}
	}
	return true
}

// decodeObject decodes raw as a JSON object whose keys are all among allowed.
// A value that is not an object yields shape, and an unexpected key yields
// ReasonUnknownKey. The text has passed checkStrictJSON, so it has no repeated
// keys and the decoded map is unambiguous.
func decodeObject(raw json.RawMessage, shape Reason, allowed ...string) (map[string]json.RawMessage, Reason) {
	if firstByte(raw) != '{' {
		return nil, shape
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, shape
	}
	for key := range fields {
		if !slices.Contains(allowed, key) {
			return nil, ReasonUnknownKey
		}
	}
	return fields, ""
}

func (p *Policy) evaluateEnvelope(body []byte, callIDPrefix string) Verdict {
	top, reason := decodeObject(bytes.TrimLeft(body, jsonWhitespace), ReasonEnvelope, "object", "method", "args")
	if reason != "" {
		return deny(reason)
	}
	object, okObject := parseIndex(top["object"])
	method, okMethod := parseIndex(top["method"])
	if !okObject || !okMethod {
		return deny(ReasonEnvelope)
	}
	verdict := Verdict{
		Allowed: false, Reason: ReasonEnvelope, Object: object, Method: method,
		Subject: "", FQN: "", Forward: nil,
	}

	objectRule, known := p.objects[object]
	if !known {
		return rejected(verdict, ReasonUnknownObject)
	}
	methodRule, listed := objectRule.methods[method]
	if listed {
		verdict.Subject = objectRule.rule.Name + "." + methodRule.Name
	}
	if !listed || methodRule.Decision != Allow {
		return rejected(verdict, ReasonRuntimeDenied)
	}

	args := top["args"]
	switch {
	case object == objectCall && method == methodCallBound:
		return p.evaluateCall(verdict, args, callIDPrefix)
	case object == objectCancelCall && method == methodCancelCall:
		return evaluateCancel(verdict, args, callIDPrefix)
	default:
		// Other allowed runtime methods take no arguments; the real runtime
		// omits args for them.
		if args != nil && string(args) != "null" {
			return rejected(verdict, ReasonArgsForbidden)
		}
		return accepted(verdict, []byte(`{"object":`+strconv.Itoa(object)+`,"method":`+strconv.Itoa(method)+`}`))
	}
}

// evaluateCall resolves a bound-method call to one fully qualified name and
// applies the method table.
func (p *Policy) evaluateCall(verdict Verdict, rawArgs json.RawMessage, prefix string) Verdict {
	fields, reason := decodeObject(rawArgs, ReasonCallArgs, "call-id", "methodName", "methodID", "args")
	if reason != "" {
		return rejected(verdict, reason)
	}
	callID, ok := stringValue(fields["call-id"])
	if !ok || !validIdentifier(callID, maxCallIDBytes) {
		return rejected(verdict, ReasonCallID)
	}
	rule, reason := p.resolveMethod(fields)
	if reason != "" {
		return rejected(verdict, reason)
	}
	verdict.FQN = rule.FQN
	verdict.Subject = rule.FQN
	if rule.Decision != Allow {
		return rejected(verdict, ReasonMethodDenied)
	}
	elements, ok := argumentList(fields["args"])
	if !ok {
		return rejected(verdict, ReasonCallArgs)
	}
	forward, ok := rebuildCall(prefix+callID, rule.FQN, elements)
	if !ok {
		return rejected(verdict, ReasonCallArgs)
	}
	return accepted(verdict, forward)
}

// resolveMethod maps the method selector of a call to one table row. Wails
// prefers methodName when it is non-empty and silently falls back to methodID
// otherwise, so a body carrying both keys, or neither, is rejected outright.
func (p *Policy) resolveMethod(fields map[string]json.RawMessage) (*MethodRule, Reason) {
	rawName, hasName := fields["methodName"]
	rawID, hasID := fields["methodID"]
	switch {
	case hasName == hasID:
		return nil, ReasonMethodSelector
	case hasName:
		name, ok := stringValue(rawName)
		if !ok || !validMethodName(name) {
			return nil, ReasonMethodName
		}
		rule, known := p.methods[name]
		if !known {
			return nil, ReasonUnknownMethod
		}
		return rule, ""
	default:
		id, ok := parseUint32(rawID)
		if !ok {
			return nil, ReasonMethodID
		}
		fqn, known := p.ids[id]
		if !known {
			return nil, ReasonUnknownMethodID
		}
		return p.methods[fqn], ""
	}
}

// argumentList decodes the argument array of a call into its elements.
func argumentList(raw json.RawMessage) ([]json.RawMessage, bool) {
	if firstByte(raw) != '[' {
		return nil, false
	}
	var elements []json.RawMessage
	if err := json.Unmarshal(raw, &elements); err != nil {
		return nil, false
	}
	return elements, true
}

// rebuildCall rebuilds a Call request around the resolved method name. The
// arguments pass through json.Compact, so they are the caller's values with
// insignificant whitespace removed and nothing else.
func rebuildCall(callID, fqn string, elements []json.RawMessage) ([]byte, bool) {
	var out bytes.Buffer
	out.Grow(len(callID) + len(fqn) + canonicalOverhead)
	out.WriteString(`{"object":0,"method":0,"args":{"call-id":`)
	writeJSONString(&out, callID)
	out.WriteString(`,"methodName":`)
	writeJSONString(&out, fqn)
	out.WriteString(`,"args":[`)
	for i, element := range elements {
		if i > 0 {
			out.WriteByte(',')
		}
		if err := json.Compact(&out, element); err != nil {
			return nil, false
		}
	}
	out.WriteString(`]}}`)
	return out.Bytes(), true
}

// evaluateCancel validates a CancelCall request: its only argument is the
// call-id of the call to cancel.
func evaluateCancel(verdict Verdict, rawArgs json.RawMessage, prefix string) Verdict {
	fields, reason := decodeObject(rawArgs, ReasonCallArgs, "call-id")
	if reason != "" {
		return rejected(verdict, reason)
	}
	callID, ok := stringValue(fields["call-id"])
	if !ok || !validIdentifier(callID, maxCallIDBytes) {
		return rejected(verdict, ReasonCallID)
	}
	var out bytes.Buffer
	out.WriteString(`{"object":10,"method":0,"args":{"call-id":`)
	writeJSONString(&out, prefix+callID)
	out.WriteString(`}}`)
	return accepted(verdict, out.Bytes())
}

func validMethodName(name string) bool {
	if name == "" || len(name) > maxMethodNameBytes {
		return false
	}
	for i := range len(name) {
		if c := name[i]; c <= ' ' || c >= 0x7F {
			return false
		}
	}
	return true
}

// stringValue decodes a JSON string literal; null, a missing value and every
// other type fail.
func stringValue(raw json.RawMessage) (string, bool) {
	if firstByte(raw) != '"' {
		return "", false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false
	}
	return s, true
}

func writeJSONString(out *bytes.Buffer, s string) {
	encoded, _ := json.Marshal(s)
	out.Write(encoded)
}

func firstByte(raw []byte) byte {
	if len(raw) == 0 {
		return 0
	}
	return raw[0]
}

// plainDigits reports whether raw is a run of at most limit ASCII digits with
// no sign, fraction, exponent or leading zero (a lone zero is fine).
func plainDigits(raw []byte, limit int) bool {
	if len(raw) == 0 || len(raw) > limit || (raw[0] == '0' && len(raw) > 1) {
		return false
	}
	for _, c := range raw {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// parseIndex reads an object or method number.
func parseIndex(raw json.RawMessage) (int, bool) {
	if !plainDigits(raw, maxIndexDigits) {
		return 0, false
	}
	n, err := strconv.Atoi(string(raw))
	return n, err == nil
}

// parseUint32 reads a binding ID: plain digits that fit uint32.
func parseUint32(raw json.RawMessage) (uint32, bool) {
	if !plainDigits(raw, maxUint32Digits) {
		return 0, false
	}
	n, err := strconv.ParseUint(string(raw), 10, 32)
	if err != nil {
		return 0, false
	}
	return uint32(n), true
}
