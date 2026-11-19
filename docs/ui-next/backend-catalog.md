# Backend and SDK catalog (found during the UI migration)

Purpose: every time UI work shows that the proper fix, or a large gain, lies in the plugin SDK, a plugin's backend or the host's Go side, it is recorded here instead of being worked around silently. Entries are batched into the right release-channel branch (`feature/ui-next` in each repo) and, for wire changes, into ONE SDK cohort bump.

Class: **BLOCKER** = the new UI cannot behave properly without it (an interim exists and is named). **TANGENTIAL** = a real gain or correctness fix that can land independently. **WIRE** = changes the plugin protocol: batch into the single cohort bump.

"The lead's notes" are the lead's private working notes (reviews, proposals, verified facts); they are not part of this repository. A path under a repository other than this one names that repository.

| ID | Class | Where | What | Evidence | Interim in the UI | Status |
|---|---|---|---|---|---|---|
| B-01 | BLOCKER | k8s plugin backend | Declare `name` as a query dimension with `sourceUpdates` so a detail page can open a live source view for ONE object (generic for every kind if possible). Host already admits a name dimension. | `omniview-plugin-kubernetes` `native_catalog.go:111-115` (only `namespace`); host: the R1 status file (`docs/ui-next/status/R1.md`, on the branch of draft PR #538, not on `main`) | Pod detail watches its whole namespace (`ui/src/pod/data/usePod.ts` in the plugin repository) | todo (step D1c) |
| B-02 | BLOCKER, WIRE? | plugin SDK + host | Plugin-authored error text never reaches the host: dropped in the SDK codec and overwritten by the host normaliser; 10 of 13 Kubernetes codes arrive as "resource operation failed". Status details need no wire bump (strictness applies to message bodies). | `plugin-sdk` `codec.go:164-165,192`; host `backend/pkg/apperror/resource.go:169-171`; lead's notes (`reviews/F09-review.md`) | UI shows generic cause sentences | todo (error phase E0) |
| B-03 | BLOCKER | host | Governance codes (`GRANT_DENIED` and three others) reach the UI as `INTERNAL`. | lead's notes (`reviews/F09-review.md`) | none | todo (E0) |
| B-04 | TANGENTIAL | host | The host emits no rows before `snapshotEnd`; partial snapshots would make first paint fast without the extra first page. | `docs/ui-next/optimisations.md`; `docs/ui-next/status/1a.2.md` | explicit first page of 256 beside the collection | todo |
| B-05 | TANGENTIAL | host | Single-object read is one-shot with no deletion signal. A live single read by reference would serve editors and detail pages for plugins that cannot declare a name dimension. | `packages/omniviewdev-runtime/src/hooks/resource/useResource.ts:49-56`; `backend/pkg/plugin/resource/finite_operations.go:130-208`; draft PR #538 | see B-01 | parked (#538 draft) |
| B-06 | TANGENTIAL | host | `startConnectionUpdates` registers an interest from a catalogue read before acquiring, without re-check: a policy withdrawal in that window is missed until the next observation. | `backend/pkg/plugin/resource/connection_updates.go:98,137`; PR #505 notes | none | todo |
| B-07 | TANGENTIAL | host + plugins | Raw `%v` error text leaks through `ConnectionStatus.Details`, unsanitised. | lead's notes (`reviews/F09-review.md`) | none | todo (E0) |
| B-08 | TANGENTIAL | host | Activity session refuses Attach/Heartbeat/Unsubscribe with 422 in server mode (window-identity race at startup). | `backend/pkg/activity/frontend.go:105`; `docs/ui-next/status/N19b.md` | ignored in browser checks | todo |
| B-09 | TANGENTIAL | host | A failed task keeps severity `info`; a write that times out after dispatch is recorded `failed`, not `unknown`. | lead's notes (`proposals/P5-errors-and-feedback.md`) | none | todo (E0) |
| B-10 | TANGENTIAL | plugin backend / metrics | Metric history for CPU and memory trends (the mock shows sparklines). | `docs/ui-next/slices/1a-pods-list.md` §6 | current values only | todo (row N18) |
| B-11 | TANGENTIAL | host | Flaky Go tests: `internal/devworkspace` (two tests), `backend/pkg/plugin/resource` on Windows. | `docs/ui-next/TRACKER.md` log | rerun once | todo |
| B-12 | TANGENTIAL | host shared runtime | Raw `Call` and `Clipboard` exported from the plugin-shared `/runtime` module (remaining MCP-token path). | PR #504 | none | todo (row N15) |
| B-13 | WIRE | plugin SDK | Batch all wire changes into one cohort bump: environment fingerprints (plugin-sdk #78 → host #499 → k8s #261) + the four error items of P5. A pending SDK branch adds a proto field without a wire bump: the gate must compare a descriptor digest. | lead's notes (`reviews/RT2-platform-and-errors.md`) | n/a | todo |
| B-14 | TANGENTIAL | plugin repos | Flux 0.5.0 and Proxmox 0.4.0 are on their `main` but unreleased; the marketplace serves builds host 0.36 rejects. | lead's notes (`03-verified-facts.md`) | n/a | owner |

How to add an entry: next free id, class, exact location (file:line), the evidence, the interim the UI uses meanwhile, status. One line. Agents propose entries in their status file under "Backend catalog" (working rule 22 of `AGENTS.md`); the lead adds them here.
