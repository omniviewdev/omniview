package gateway

import "errors"

// Code is a bounded, stable audit code. The names and their CLI exit
// categories follow the B20 plan, except audit_denied, which the plan does
// not name: it exists only as the reason of an HTTP refusal and has no exit
// category. The CLI maps a Code to its exit status.
type Code string

// Audit codes the gateway produces. Remote responses carry only fixed text,
// never request data.
const (
	// CodeUnauthorized is every remote identity, authority or credential
	// denial. It never says which factor failed. (CLI exit 6.)
	CodeUnauthorized Code = "audit_unauthorized"
	// CodeDenied is an authenticated request that the route table, the origin
	// rules or the allowlist refuse. It names a bounded reason, never request
	// text.
	CodeDenied Code = "audit_denied"
	// CodeUnavailable is an authenticated request the gateway cannot serve
	// right now: over capacity, or the upstream is unreachable. (CLI exit 3.)
	CodeUnavailable Code = "audit_unavailable"
	// CodeTimeout is a bounded wait that ran out, such as the upstream not
	// answering its first verification in time. (CLI exit 7.)
	CodeTimeout Code = "audit_timeout"
	// CodeNotFound is an operation on an audit or credential that does not
	// exist or has ended. (CLI exit 3.)
	CodeNotFound Code = "audit_not_found"
	// CodeTargetChanged is the upstream no longer being the target the audit
	// started for. The audit ends. (CLI exit 4.)
	CodeTargetChanged Code = "audit_target_changed"
	// CodeShutdownIncomplete is closure of tunnels or in-flight requests that
	// could not be confirmed in time. (CLI exit 5.)
	CodeShutdownIncomplete Code = "audit_shutdown_incomplete"
	// CodeInvalidOptions is a configuration or option the gateway rejects.
	// (CLI exit 2.)
	CodeInvalidOptions Code = "invalid_audit_options"
)

// Error is an error that carries a stable [Code].
type Error struct {
	Code    Code
	Message string
}

func (e *Error) Error() string {
	return string(e.Code) + ": " + e.Message
}

// CodeOf returns the Code of the first [Error] in err's chain, or "".
func CodeOf(err error) Code {
	var coded *Error
	if errors.As(err, &coded) {
		return coded.Code
	}
	return ""
}

// Errors returned by the gateway's methods. Test with errors.Is.
var (
	// ErrAuditEnded reports that the audit has stopped, expired or failed
	// closed. Start a new audit.
	ErrAuditEnded = &Error{Code: CodeNotFound, Message: "the audit has ended"}
	// ErrCredentialNotFound reports an unknown credential ID.
	ErrCredentialNotFound = &Error{Code: CodeNotFound, Message: "no such credential"}
	// ErrCredentialEnded reports that a credential was revoked, expired or
	// lost its place before its secret could be used: its pairing code is
	// spent and the secret that was delivered is dead.
	ErrCredentialEnded = &Error{Code: CodeNotFound, Message: "the credential ended before it could be used"}
	// ErrCredentialLimit reports that the audit already has the maximum number
	// of active credentials.
	ErrCredentialLimit = &Error{Code: CodeInvalidOptions, Message: "too many active credentials"}
	// ErrPairingLimit reports that too many pairing offers are outstanding.
	ErrPairingLimit = &Error{Code: CodeInvalidOptions, Message: "too many outstanding pairing offers"}
	// ErrPairingInvalid is a pairing code that is wrong, expired, already used
	// or malformed. It never says which.
	ErrPairingInvalid = &Error{Code: CodeUnauthorized, Message: "pairing code not accepted"}
	// ErrPairingRateLimited reports too many failed pairing attempts. The code
	// was not examined.
	ErrPairingRateLimited = &Error{Code: CodeUnauthorized, Message: "too many failed pairing attempts"}
	// ErrDelivery reports that the secret channel failed. The pairing code is
	// spent and no credential exists; pair again.
	ErrDelivery = &Error{Code: CodeUnavailable, Message: "credential delivery failed"}
	// ErrTargetChanged reports that the upstream is not the verified target.
	ErrTargetChanged = &Error{Code: CodeTargetChanged, Message: "the upstream is not the verified target"}
	// ErrTargetUnavailable reports that the upstream could not be verified:
	// it did not answer, or its control plane failed. It is not a verdict
	// that the target changed.
	ErrTargetUnavailable = &Error{Code: CodeUnavailable, Message: "the upstream could not be verified"}
	// ErrTimeout reports that the upstream did not answer in time.
	ErrTimeout = &Error{Code: CodeTimeout, Message: "the upstream did not answer in time"}
	// ErrShutdownIncomplete reports that closure of tunnels or in-flight
	// requests could not be confirmed before the deadline.
	ErrShutdownIncomplete = &Error{Code: CodeShutdownIncomplete, Message: "closure could not be confirmed in time"}
)

func invalidOption(message string) error {
	return &Error{Code: CodeInvalidOptions, Message: message}
}

// EndReason says why an audit ended. The values are bounded codes safe for
// diagnostics.
type EndReason string

// Reasons an audit ends.
const (
	EndNone              EndReason = ""
	EndStopped           EndReason = "stopped"
	EndExpired           EndReason = "expired"
	EndTargetChanged     EndReason = "target_changed"
	EndTargetUnavailable EndReason = "target_unavailable"
	EndClockJump         EndReason = "clock_jump"
)

// Denial is the bounded category of a refused request. It appears in
// diagnostics and counters only; remote responses never reveal it.
type Denial string

// Denial categories.
const (
	// DenialPeer is a refused identity step: lookup failure, ambiguous or
	// incomplete answer, tagged node, other owner, or an unpermitted self peer.
	DenialPeer Denial = "peer"
	// DenialAuthority is a wrong or missing TLS version, SNI, Host or request
	// target form.
	DenialAuthority Denial = "authority"
	// DenialCredential is a missing, malformed, unknown, wrong, expired,
	// revoked or foreign-node credential.
	DenialCredential Denial = "credential"
	// DenialRateLimited is too many failed credential attempts.
	DenialRateLimited Denial = "rate_limited"
	// DenialEnded is a request after the audit ended.
	DenialEnded Denial = "ended"
	// DenialRoute is an authenticated request for a route or method outside
	// the route table.
	DenialRoute Denial = "route"
	// DenialOrigin is an authenticated request whose Origin or Fetch Metadata
	// is not the configured same-origin page.
	DenialOrigin Denial = "origin"
	// DenialPolicy is an authenticated runtime call the allowlist refuses.
	DenialPolicy Denial = "policy"
	// DenialCapacity is an authenticated request over a concurrency limit.
	DenialCapacity Denial = "capacity"
	// DenialUpstream is an authenticated request the upstream could not serve
	// acceptably.
	DenialUpstream Denial = "upstream"
)
