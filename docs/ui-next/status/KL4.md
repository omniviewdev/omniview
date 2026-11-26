# KL4: the plugin's landing acts on its connections (verbs, labels, the host's confirmation)

Goal: round 2 of the plugin landing. `context.connections` (KL2) listed a plugin's connections and opened one; a landing could not show their labels, start one without opening a page, check, stop or remove one, or reload the list from the backend. This adds those generically (the host stays plugin-agnostic: the vocabulary guard is green) and puts the confirmation of what is destructive in the HOST, so no plugin can run a disconnect or a removal without the question.

- Worktree: `~/Repos/omniviewdev/worktrees/landing-verbs`
- Branch: `feat/landing-verbs`, rebased onto `origin/main` 90efcd202 (the sidebar slice, #780: `SidebarContextV1.connections` is the same handle, so it carries the verbs too). Nothing pushed or opened as a PR: the lead does that.

## What changed

Contract (`ui-next/plugins/contract/v1.ts`, minor and additive; each member sits by the type it extends):

- `ConnectionV1.labels: Readonly<Record<string, string>>` (the backend's labels whose value is text, `{}` when none, the same object while they do not change) and `ConnectionV1.busy?: ConnectionBusyV1` (`'connecting' | 'checking' | 'disconnecting' | 'removing'`).
- `ConnectionVerbResultV1 = { ok: true } | { ok: false; reason: string; cancelled?: true }`.
- `ConnectionsHostV1`: `connect(key)`, `check(key)`, `disconnect(key)`, `remove(key)`, each `Promise<ConnectionVerbResultV1>` and never rejecting; `refresh()` now asks the backend to load its connections (`LoadConnections`) and reads the list.
- `ConnectionStateV1` gains `'certificate'` (word `Certificate problem`, role `error`).

Host:

- `connections/api.ts`: `StateRecord.connection.labels`; `ConnectionsApi` gains `check`, `stop`, `remove`, `load`, bound in `productionApi` to `CheckConnection`, `StopConnection`, `RemoveConnection`, `LoadConnections`. The four bindings and the Go service wrapper methods exist: no Go, no regenerated bindings.
- `connections/store.ts`: `labels` in the list (frozen, compared by value in `reuse`, so a read that says the same labels leaves the connection the same object); `busy` on `HostConnection`; `hold(plugin, key, busy)` (the lock) and `reload(plugin)`; `connect` is refused while a verb holds the connection.
- `connections/verbs.ts` (new): the verbs, one at a time on a connection; `questions.ts` (new): the one open question, its answer and its retry; `ConnectionQuestion.tsx` (new): the kit `ConfirmDialog`, mounted by `PluginHost` next to the terminal's prompt; `reach.ts` (new): the tabs and live panel sessions of a connection.
- `connectionsHost.ts`: `labels`, `busy`, the four verbs bound to the handle's plugin, a window with no connection data refuses each in words.
- `connections/words.ts`: the `certificate` class (the host sends CERTIFICATE_ERROR as a failed connection, a 502 and `reconnect`, which was drawn "Not responding"; the code tells it apart), `refusalOf`, `unhealthyReason`, `verbFailure`, `labelsOf`, `sameLabels`. `conditions.ts`: `certificate` is an error in Problems.
- `PluginHost.tsx` (small): `Host.verbs`, made with the connections; one line draws the question.
- Fixture landing variant: the card's menu has Connect, Check, Disconnect… and Remove…, a notice says each answer, the card says `busy` over the state's word and draws labels; the connections process puts labels on `north` (two text, one number). `plugins/README.md`: rules 12 and 13, file rows.

## Behaviour

- **Confirmation (the host's).** `disconnect` and `remove` open the kit `ConfirmDialog`: subject (name, "Connection", description, state in the host's word); remove says "Removes X from your connection list. Nothing it points to is changed."; disconnect says "N open tabs and M sessions of X will lose the connection." (counted from the tab model and the live panel sessions whose route names the connection) or "Stops browsing X." when none. Cancel answers `{ ok: false, reason: 'Cancelled.', cancelled: true }`. A yes runs the call INSIDE the dialog (kit `busy`); a failure keeps it open with the host's line; leaving after a failure answers that failure; leaving while it runs leaves it running and answers what it comes to. One question at a time ("Another question is waiting for an answer."). A verb that would be refused is refused before anything is asked.
- **Lock.** While a verb holds a connection the list says `busy` and every other verb on it, `open` and `connect` included, is answered "X is being checked. Try again when it has finished." (also "disconnecting", "being removed", "connecting"). A connection the host says is `connecting`, here or in another window, is not checked, disconnected or removed (the host's stop waits behind a start that does not end: B-56). A hold goes after the list was read again, like a start's mark. A start that overlaps a start still shares it, as before.
- **check** answers ok for CONNECTED and a sentence otherwise (UNAUTHORIZED, FORBIDDEN, not connected, still connecting, the status's own safe line); the host's list is read again.
- **refresh** a load that failed makes the view `failed: true` until a read lands that no failed load came before (the host clears the plugin's list for it).

## Checks (clean environment, after the last edit; load average 5 to 14)

- Kit `verify`: 125 files, 3,100 tests, vocabulary guard, API report, dist check: pass. `tsc` app, test and kit: 0 errors. `eslint ui-next packages/kit --report-unused-disable-directives`, `lint:ui-policy`, `lint:css`: exit 0. `node --test scripts/react-compiler.test.mjs`: 13 of 13. Full root `pnpm test`: 457 files passed, 1 skipped; 10,167 tests passed, 3 skipped (KL2's run: 454 / 10,045).
- New or changed tests: `verbs.test.ts` (9), store (labels, hold x2, reload x2), words (certificate row, check words, refusals, labels), `connectionsHost.test.ts`, `PluginHost.landing.test.tsx` (the host's dialog through a plugin's button), fixture `landing.test.tsx` (menu verbs, labels). Nine test fakes of `ConnectionsApi` spread `unusedVerbs` (`homeTesting.ts`); `connectionName.test.ts` names `reach.ts` as a reader of a route's connection.
- Real host, real browser (`OMNIVIEW_UI=next task build:server`, the fixture written with the landing, the `hang` mode for south): 50 of 50 checks, WebKit and Chromium at 1440 x 900 (25 each). Labels from the real backend (two text, the number left out, south's null draws none); connect starts south and opens no page (Connecting… on the card); a check, a disconnect (no dialog asked) and a remove while it connects are each refused with the sentence; check of a connection not connected and of a healthy one; connect north; disconnect: the dialog names north, Connected and "1 open tab of north will lose the connection", Cancel answers cancelled and north stays, yes stops it (list says Disconnected); remove: the dialog, yes closes it, the plugin is answered ok, south leaves the list and STAYS removed after Refresh, which sends `LoadConnections`; no page or console error. A first run of the driver reported 4 failures that were its own timing (it read the dialog before the removal ended); fixed, and the second run is the one above.

## Not verified

- The native WKWebView and Windows; the Kubernetes Pods cluster check (`scripts/ui-next-pods`) and the real plugin; the seam check and the kit, shell, strip and rail probes (CI runs them at night).
- In a real engine: a lock held by a check or a stop (the fixture's are instant: unit-tested), the dialog's busy state during a slow stop, focus return and axe on the dialog, a refused remove (a plugin with no overlay: the host's line in the dialog is unit-tested), a failed `LoadConnections` (`failed: true`: unit-tested). No negative control was run for the new tests.

## Choices to confirm

- `cancelled?: true` on the failure arm (reason `Cancelled.`) rather than the string `'cancelled'`: a plugin tells a no from a failure without comparing text.
- Disconnect is in the danger tone as well as remove: the mock's K58.2 draws both so (the lead's text named remove). One word in `verbs.ts` flips it.
- `open` and `connect` are locked like the other verbs (refused while checking, disconnecting, removing); `labels` is required on `ConnectionV1`, so a plugin's fabricated `ConnectionV1` needs `labels: {}`.

## Backend catalog

- TANGENTIAL, `controller.go:714-749` (`CheckConnection`): it answers the caller and changes nothing the host lists (no event, no `c.connections` update), and `GetAllConnectionStates` is the registered state, not health, so a check that finds UNAUTHORIZED cannot show on a card through the list. Interim: the answer is given to the page that asked, as `{ ok: false, reason }`.
- TANGENTIAL, `connection_change.go:166-176` (`loadConfiguredConnections`): a failed `LoadConnections` sets the plugin's list to nil, so "could not load" reads as "no connections". Interim: the store says `failed: true` after a failed load.
- TANGENTIAL, `connection_profiles.go:633-636` (`RemoveConnection` of a plugin's own connection): it only disables it (`DisabledIDs`); the new UI has no way back. Interim: the dialog says "from your connection list".
- B-56 (existing): a stop, a check, a load and a remove wait behind a start that never ends. Interim: refused with a sentence while connecting.

## How a plugin adopts it

Vendor the contract and kit at a host commit that has this (`hack/vendor-host.sh`). Draw `busy` over the state's word and disable what would be refused; call `connect`, `check`, `disconnect` and `remove` from a person's action and show `reason` unless `cancelled`; never draw a confirmation of its own; treat an unknown state as `failed`; call `refresh()` only from a person's action (it loads); read `labels`. A plugin's test double of `ConnectionV1` needs `labels`, and of `ConnectionsHostV1` the four verbs.

## Dev tools

- `/tmp/kl4/verify.mjs` (scratch, not committed): builds the connections process, writes the landing variant and the `hang` mode file into a temporary state root, starts `bin/Omniview-server` (`OMNIVIEW_CHANNEL=feature-ui-next`, a free port, a temporary `HOME`) and drives WebKit and Chromium; `ENGINES=webkit` runs one. Shots in `/tmp/kl4/shots`.
