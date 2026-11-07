// Package auditgate is the deny-by-default allowlist behind the remote audit
// gateway. It decides which Wails calls and which backend events a remote,
// view-only browser may reach, and nothing else: it opens no listener, dials no
// network and depends only on the standard library.
//
// The decisions live in policy.json, embedded in the binary and loaded with
// [Default]. A [Policy] answers three questions:
//
//   - [Policy.EvaluateRuntime] checks one POST /wails/runtime request and, when
//     the request may pass, returns the canonical body to forward upstream. The
//     bytes the client sent are never forwarded.
//   - [Policy.FilterEventFrame] checks one frame of the /wails/events socket.
//   - [Policy.Verify] checks that every method Wails would bind for a set of
//     service instances is classified, so a new method cannot become reachable
//     unreviewed.
//
// docs/development-audit-gateway.md describes the table and how to classify a
// new method or event.
package auditgate
