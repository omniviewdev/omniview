# Status: T7-opener (#696, the host validates the URLs it opens: the Go half)

- Branch `feat/host-url-opener` on `origin/main` `892ff4bc5`. Not pushed. Page migration is a later PR (after step 1 of #696 merges: it touches `links.ts` and `openExternal.ts`).
- Red: `420aab934` (tests against the platform validator alone: 8 tests fail by assertion). Green: the commit after it.

## The call

`AppService.OpenExternalURL(address) -> { opened: boolean, reason?: 'scheme'|'userinfo'|'own-server'|'malformed'|'too-long' }` (bound; `packages/omniviewdev-runtime/src/bindings/.../appservice.ts`). A refusal is an answer, never an error; the call fails only when the system's browser cannot be started, with a message that holds no address. Code: `backend/pkg/opener`; wired in `app.go` and `main.go`.

## Decisions

1. **Where.** `main.AppService`, the existing bound service for host-level actions (file dialogs); the logic is a pure package so it is testable without Wails. Wails' `Browser.OpenURL` stays (policy: denied to plugins) but the page should stop calling it.
2. **Not capability-bound.** A capability names a terminal and guards that terminal's data; this call takes no terminal state, reads nothing of the user's, and its effect (open a browser tab) is the same for any caller. The risk is a hostile address, which the checks answer, and a plugin iframe calling it, which the audit gate answers (pinned `deny` in `internal/auditgate/policy.json` and listed in `main_audit_policy_test.go`).
3. **Checks, in order:** over 2,083 bytes `too-long`; not `http://` or `https://` (case-insensitive, no leading space, `http:/\x`, `http:x`) `scheme`; invalid UTF-8, a backslash, a space, any control character (tab and newline too: a browser drops them and hides what it names) `malformed`; no host `malformed`; userinfo, found in the parsed address and in the raw authority, `userinfo`; port out of range `malformed`; host read as a browser reads it (percent escapes refused: `127%2e0.0.1` and zone ids are `malformed`; non-ASCII mapped with IDNA, so full-width and circled digits and the ideographic dot become ASCII; trailing dots dropped; a last label that is a number but not an IPv4 address is `malformed`); own server `own-server`; then the platform validator (`application.ValidateAndSanitizeURL`).
4. **Own server.** Every spelling of this machine (`localhost`, `*.localhost`, 127/8 and 0/8 in decimal, hex, octal and short forms, `::1`, `::`, `::ffff:127.0.0.1`, `::127.0.0.1`) at a port a server of the host listens on, and an address a server listens on (a non-loopback interface). Other loopback ports are allowed: the Ports tool opens a forward at `http://localhost:<port>`, so refusing every loopback would break it. The servers are asked at each call: the server-mode port (34115), the diagnostics endpoint (`HTTPServer.Address`), the MCP relay (`Relay.ListenAddress`, its configured port even while not listening). Not caught as text: a name that resolves to loopback (`127.0.0.1.nip.io`, `localhost.localdomain`); the server build answers those with a 403 (host-header policy).
5. **`;` and the other shell characters** (`; | backtick $ < >`): refused as `malformed`, before the platform. Wails refuses them anyway; saying so as a typed reason lets the page word it, and no address needs them (the cost: an old-style `a=1;b=2` query is not opened; the page could re-encode it).
6. **No shell.** The platform program is started with an argument array (`xdg-open`, `open`, `rundll32 url.dll,FileProtocolHandler`: the same programs Wails starts), the address one element. Test: a program of the test's own stands where `xdg-open` does and writes what it was given; an address with `& ' ( ) * ~ ! &touch&pwned` arrives as exactly one argument, whole, and nothing is created.
7. **Canary.** No log line; reasons and errors hold no address (test: a secret in the address is in no result and no error, and is in what the opener is handed).

## Commands

See the final run in the pull request description; results are in the hand-off message. Not verified: macOS and Windows openers (the program names are the same as Wails'); the page (not changed here).
