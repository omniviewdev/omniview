package gateway

import (
	"net/http"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

// This file adapts the allowlist's request and event signatures to the small
// types the rest of the package uses. It holds none of the rules: the request
// rules (method, path, query, headers, client ID, call-ID prefix, JSON shape,
// method table) and the event rules live in internal/auditgate and are applied
// there, so there is one implementation of them.

// runtimeCall is one /wails/runtime request as the allowlist sees it.
type runtimeCall struct {
	method   string
	path     string
	rawQuery string
	// header holds the request headers exactly as received; the allowlist
	// refuses what must not be forwarded, such as x-wails-window-*.
	header http.Header
	body   []byte
	// clientID is the page's own client ID, the label its events socket was
	// bound under. The request must carry exactly it in x-wails-client-id.
	clientID string
	// callIDPrefix scopes call IDs to one page. It satisfies
	// auditgate.ValidCallIDPrefix: it ends in a terminator that no call ID
	// contains.
	callIDPrefix string
}

// runtimeDecision is the allowlist's verdict on one runtime call.
type runtimeDecision struct {
	allowed bool
	reason  auditgate.Reason
	// subject names what the call would run, when it resolved to a table row.
	subject string
	// forward is the canonical body to send upstream. It is set only when
	// allowed and is never the bytes the client sent.
	forward []byte
}

// eventDecision is the allowlist's verdict on one events message.
type eventDecision struct {
	forward bool
	reason  auditgate.EventReason
}

// allowlist is what the gateway asks of the policy.
type allowlist interface {
	evaluate(call runtimeCall) runtimeDecision
	filter(kind auditgate.MessageKind, payload []byte) eventDecision
}

type policyAllowlist struct {
	policy *auditgate.Policy
}

func (a policyAllowlist) evaluate(call runtimeCall) runtimeDecision {
	verdict := a.policy.EvaluateRuntime(auditgate.RuntimeRequest{
		Method:       call.method,
		Path:         call.path,
		RawQuery:     call.rawQuery,
		Header:       call.header,
		Body:         call.body,
		ClientID:     call.clientID,
		CallIDPrefix: call.callIDPrefix,
	})
	return runtimeDecision{
		allowed: verdict.Allowed,
		reason:  verdict.Reason,
		subject: verdict.Subject,
		forward: verdict.Forward,
	}
}

func (a policyAllowlist) filter(kind auditgate.MessageKind, payload []byte) eventDecision {
	verdict := a.policy.FilterEventMessage(kind, payload)
	return eventDecision{forward: verdict.Forward, reason: verdict.Reason}
}
