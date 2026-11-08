// Package gateway is the HTTP core of the remote audit gateway: one audit's
// http.Handler, its credentials and its lifecycle. It opens no listener of its
// own choosing, depends on no Tailscale code and starts no process. The
// supervisor, the Tailscale daemon adapter and the CLI plug into it through
// the small interfaces declared here.
//
// One [Gateway] is one audit generation. It never recovers: after it ends
// (stop, expiry, a changed target or clock) the owner builds a new Gateway,
// with a new audit ID, realm and credentials.
//
// # Request order
//
// [Gateway.ServeHTTP] runs these steps for every request, before any route is
// chosen and before a byte of the request reaches the upstream:
//
//  1. Peer identity. [PeerIdentity] resolves the accepted socket's remote
//     address to a node and its owner. A lookup error, an ambiguous or
//     incomplete answer, a tagged node or an owner other than the audit's is
//     denied.
//  2. Authority. TLS 1.3, the SNI and the Host header must equal the
//     configured name and port, and the request target must be origin-form.
//  3. Credentials. Exactly one well-formed HTTP Basic Authorization header
//     must name an active, unexpired credential of this audit and carry its
//     secret. A credential is pinned to the first node that authenticates
//     with it.
//
// Every denial in these steps produces the same audit_unauthorized response,
// so a remote party cannot tell which factor failed. Only then does the
// gateway classify the route (using [auditgate.ClassifyPath]) and either
// evaluate a /wails/runtime call, tunnel the events WebSocket through the
// event filter, or relay one of a small set of static GET routes.
//
// # Secrets
//
// A credential secret exists in memory only for the moment it is generated and
// handed to a [SecretChannel] by [Gateway.Exchange]. The gateway keeps a
// keyed digest. Diagnostics carry opaque IDs and fixed codes, never headers,
// URLs, usernames or secrets, and the package never writes a log line.
package gateway
