# PF3: the host consumes `local_host` (plugin-sdk v0.23.0): the Ports tool shows the stated host, Open and Copy address for loopback only

State 2026-11-25: complete and proven locally (below); the pull request's own checks are `PR Checks` only (docs/ui-next/AGENTS.md rule 39), the probes and the seam run nightly and were run here. Closes W-PF7 of `PF2.md`.

## 1. What this does

1. **The SDK pin, v0.23.0** (commit `9d5baaf9192d90233b74c823e66e89e8d9d294db`): `SDK1/bump.sh v0.23.0` (root module and `e2e/fixtures/workspace-probe`), `FloorVersion` v0.23.0 and its reviewed row (module `h1:VG9cWxXZ1vaOjP3qYbg04gaKK7jkUqTBuiVajnf1yXU=`, go.mod `h1:4y3rIPpRzF3N1SvC73cjJX1jcp+cnJ4dikaXuKlZs7E=`), `docs/development-cli.md`. `SDK3/derive-sums.sh v0.23.0` exit 0: git, the proxy, the checksum database, both `go.sum` and the row agree. `task bindings`: the only change is `PortForwardSession.local_host?: string`.
2. **The Ports tool reads the host a forward states** (`ui-next/shell/panel/ports/model.ts`, `PortsStore.ts`). A stated host is kept only when it is one the SDK could have stated: `localhost` in any case, or a strict IP address (IPv6 may carry a zone of `[A-Za-z0-9._-]{1,64}`), nothing trimmed; anything else reads as unstated. Loopback is the SDK's rule (`ForwarderResult.LocalHost` in plugin-sdk): `localhost`, 127.0.0.0/8, `::1` and `::ffff:127.x.y.z` in any textual form. **Loopback**: the Mapping shows the host as stated, Open in browser is offered at `http://<connect host>:<port>` (the IPv4 as stated, a mapped IPv4 unmapped, `[::1]`, or `localhost`; a zone dropped), Copy is Copy address (`<host>:<port>`). **Every interface** (`0.0.0.0`, `::`) **or another address** (LAN, link-local): the Mapping shows the host as stated, a running row says on its second line `Reachable from other computers: it listens on every network interface.` (or `... it listens on <host>.`), Open is disabled with `This forward listens beyond this computer, so it is not opened from here.`, Copy is Copy port (the number), and the Open URL is never built from `0.0.0.0` or `::` (`browserUrlOf` is `undefined` for any non-loopback row). **Unstated** (a producer that says none, or text that is not a host): `port N`, Open disabled (`Where this forward listens is not stated, ...`), Copy port.
3. **The fixture's Go forwarder states where it listens** (`networker.LocalHostOf(listener.Addr())`: `127.0.0.1`), so the real chain (fixture forwarder, SDK manager, plugin gRPC, host binding, Ports tool) carries `local_host` for real.
4. **`ctx.panel.ports.forward` answers `localHost`** when the session states it, as stated and unread, and leaves the member absent when it is empty; the contract's comment carries the reader's rule.
5. **The seam, scenario `w`**, is back on the stated-loopback truth (`127.0.0.1:<local> → :8080/TCP`, Open makes one `Browser.OpenURL` of `http://127.0.0.1:<local>`, Copy address `Address copied`, the host's list carries `local_host`); `open-disabled`, `open-asks-nothing` and `menu-open-no-call` are dropped with their controls (the fixture always states now; the unstated and exposed branches are the probe's). **The probe family** has the fake host's pages for every class (`hosts`, `exposed`, `reaches`) with three new controls (`exposed-line-dropped`, `exposed-copy-label`, `exposed-copy-address`); `reach-unstated` and `endpoint-guessed` moved to the new `reaches` page.

## 2. Proof (laptop, clean environment, WebKit 27.2 and Chromium 156, both viewports for the probes)

| Command | Result |
|---|---|
| `task local:seam -- ports,controls-ports` | exit 0, 302 s: scenario `w` 64.4 s (WebKit) and 61.6 s (Chromium), its table of 62 controls detected in both (72.5 s and 72.4 s); the 15 changed controls also pass undetected with their assertion removed in both engines (30 of 30) |
| `task local:probes -- --changed` | exit 0, 514 s, 11 units in both engines (ports-a to e and six control units); one `NEGATIVE_CONTROL=all` sweep: 63 controls, each detected by its own assertion and undetected with it removed |
| `go test -short ./...` (whole module) | every package ok except `backend/pkg/terminal` `TestZshXtraceNeverPrintsTheNonce` (`unconfirmed`, not `on`), which fails identically on a plain `origin/main` checkout (`816e3b2a0`): not this change |
| `SDK1/bump.sh --check v0.23.0` (the pin's dependent packages in full) | ok, except `internal/devworkspace` `TestWatchRecoveryCannotDeclareReadyWithUnrebuiltSDKBackend`, which hit its own context deadline at load 34 and passed on its one rerun (1.8 s, load 21): a watcher timing test, not the pin |
| `go test -race ./ui-next/plugins/fixture/...` | ok (two new tests seen red first) |
| `vitest run` (root) | 451 files, 9,943 tests; the ports directory 8 files, 480 tests (94 red before any product code); the contract answer 7 new cases (5 red first) |
| `tsc` app, test and node; `pnpm lint` (ui-audit); kit `verify`; `node --test scripts/ci/` (440); `seam-shards check` (29 phases, 204 controls); `probe-shards check` (432 controls) | pass |

## 3. Order rule and a compatibility finding

**A host on SDK v0.22.1 or older REFUSES every forward of a plugin that states `local_host`.** The old SDK's resource-wire admission rejects any message with an unknown field (`pkg/resource/v2/adapter_admission.go:47`: `UNSUPPORTED`, `unknown resource protobuf field`, HTTP 422 at the host), so the note of plugin-sdk #94 that an old host ignores field 10 holds for the protobuf decoder only. Measured on a real host built from `origin/main` (SDK v0.22.1) with the Kubernetes plugin on v0.23.0 stating `localhost`: refused; the same plugin without `LocalHost` forwards. The plugin may also keep a running tunnel the host never hears of. **So the host that pins v0.23.0 merges first and the Kubernetes plugin PR after it**; an SDK-side negotiation (a wire version or a capability, so that an old host refuses the plugin at load with words) would be a separate SDK change (W-PF12).

## 4. Differences from the mock

| Difference | Approval |
|---|---|
| A running forward that listens beyond this computer has a second line of words (the mock has none); it is drawn as the mock draws a two-line row (40 px, same type) | the lead's PF3 order ("shown as exposed with words") |
| Open in browser is dimmed for `0.0.0.0` and `::` although this computer reaches them at `127.0.0.1` | the lead's PF3 order (loopback only); offering Open through `127.0.0.1` for them is a one-line change |
| Copy is Copy port for an unstated or exposed forward | the lead's PF2 and PF3 orders |

## 5. Catalogue

| Id | Finding | Class | State |
|---|---|---|---|
| W-PF7 | the SDK states `local_host` (v0.23.0) and the tool and the contract read it | SDK | **closed here** |
| W-PF12 | an old host refuses every forward of a plugin that states `local_host` (section 3) | SDK | open; the order rule is the answer for now |
| W-PF13 | the floor moves with the pin: the Kubernetes plugin on SDK v0.22.1 is refused in a published-mode dev workspace until its own bump (`SDK4.md` section 4); an installed plugin is not affected; `KUBERNETES_PLUGIN_REF` (a plugin commit on v0.22.1) stays and moves after the plugin PR merges | host | open |

## 6. Screenshots (WebKit, void, 1440x900, beside the mock) and what is wrong

`/Users/joshuapare/Notes/omniview/ui-migration/status/PF3-assets/` (`compare-exposed`, `ports-hosts`, `k8s-*` for the real host with the Kubernetes plugin). Looked at: (1) the exposed line is the same muted grey as a cause line, with no glyph or warning colour, so only the sentence marks it; (2) a long mapped-IPv6 Mapping such as `[::ffff:127.0.0.1]:8085 → :8080/TCP` widens the column and pushes Connection and Status right (no clipping); (3) the PF1 differences from the mock remain (`PF1.md` section 3).

## 7. Not verified

Linux and Windows CI (the seam and the probes ran on macOS only); the nightly runners' seconds for the new units (the table says the laptop's times x1.3); an engine older than WebKit 27.2 or Chromium 156; the Menu key on the row menu.
