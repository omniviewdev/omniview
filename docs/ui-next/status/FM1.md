# Status: FM1 (the form field model)

**State (2026-11-20): READY FOR REVIEW (PR #562, not merged).** Logic and tests only; nothing imports the model and the `next` bundle is byte-identical to the one without it (proved below). Not built, on purpose: the oracle file (see "Not verified"), the kit parts, the Settings page and its search, an adapter from the SDK's `Setting`.

- Agent: FieldModel
- Goal: the framework-free FIELD MODEL for forms, driven by declared data and not by components: a schema as plain serialisable data (kinds from a closed list, conditions as expressions, options static or from a cancellable provider, sections, `sensitive`), a form store (immutable snapshot, dirty and touched, sync and async validation, host errors mapped onto fields, submit with a double-submit guard, revert, apply-on-change and explicit-apply modes), secrets that reach nothing but the submit callback, unknown kinds degraded to a read-only entry, schema versioning and a migration hook, a 500-field performance bound, and the README (schema reference, what the kit's form parts will need per kind, open questions for the credential track).
- Owns: `ui-next/shell/core/fields/**` (new) and this file. Nothing else.
- Worktree: `~/Repos/omniviewdev/worktrees/ui-next-fm1-field-model`
- Branch: `ui-next/fm1-field-model` (rebased on `origin/main` d5ecf57c; first built on 1a7bd5f9)
- PR: https://github.com/omniviewdev/omniview/pull/562

## Sources read

Everything below was read, not recalled. Mock paths are under `~/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock/` (lab repository at `91da149`, 2026-11-16); `ch16` is `research/int-ui/16-ide-shell.md`, `ch04` is `04-controls-forms-dialogs.md`, `ch14` is `14-consistency-scales.md`.

### The mock: the written rules (what the model must keep)

| Rule | Where | The words that matter |
|---|---|---|
| S125 one save model | `ch16:593` | "Settings apply on change; this is the one model. A setting is a value: there is no Save, Apply, Done or *unsaved changes* state, no guard dialog for a value, and no draft that outlives its field. Toggles, selects, segmented values, choices and sliders apply at once. Text, number, path, URL, secret and token fields commit on `Enter` or blur, never per keystroke: illegal characters are refused immediately, a complete value is validated on commit, an async check runs on commit, and a value that fails stays in the field with its error while the *applied* value stays in effect … `Escape` reverts the field to the applied value. A record (connection profile, preset, install options) is not a setting; it is a form with `H.formActions` (A6), and the tab guards its draft (S27)." |
| A6 two kinds of thing | `ch16:34` | "A *setting* (a value) applies on change and has no Apply, OK, Cancel or Save. A *record* (connection profile, preset, install options) is a form committed with `H.formActions` in a dialog or page footer." |
| S126 the row | `ch16:595` | the reset button "shows only when the value differs from the default; its slot is reserved … and it is the modified marker (not color alone). A value set by an environment variable shows `H.status` *Set by environment variable* and a read-only control (ch 14 F-4)." |
| S127 the message lane | `ch16:597` | "One message at a time, in priority: *invalid*; *warning* (never blocks apply); *Checking…* (muted, 16px loader after 1s); *Couldn't check · Retry* (… the value is not applied); *Saved* (muted check for 2s after a validated field commits); *Restart required to apply* (info glyph, until restart); else the hint. Messages are at most 80 characters, written *Problem. Fix.* … Focus never moves on blur … A new error or warning raised on commit is announced once through the shell's polite live region as *{Field}: {message}* (S86)." |
| S128 page states | `ch16:599` | *Loading*, *Could not load*, *Plugin not running* ("rows keep their cached values, every control `aria-disabled` with *Start {plugin} to change this*"), *Plugin schema unavailable*, *Settings can't be saved* (store unavailable: controls `aria-disabled`, never silent). |
| S129 restart | `ch16:601` | "A setting that needs a restart shows *Restart required to apply* in its lane after a change and joins the *Restart required* widget." |
| S131 three shapes | `ch16:605` | "the generic schema (rows); a custom editor for one row (the host owns the row frame, the plugin supplies the control); a custom page." |
| S27 the draft guard | `ch16:206` | "A page that edits a record registers its draft with `Shell.draft.set(tabId, { dirty, save(), discard() })` … `save()` resolves `saved`, `invalid` or `failed`; on `invalid` or `failed` the guard stays open, the draft is kept and the reason shows in the guard's own message." |
| A18 | `ch16:46` | "A setting must keep an invalid value, show the error and not apply it." |
| Validation timing | `ch04:127-140` | "Illegal characters / exceeded maximum: Validate immediately … Do not send remote requests per character. Do not interfere with IME composition." "Fully entered disallowed value: Validate on blur or submit, whichever occurs first; not while the value is still being formed. Blur must not steal focus back." "Empty required value, simple dialog: Focus the first required field and disable confirmation until filled" (the reason is visible text, DR1). "Empty required value, complex form: A complex form has more than three inputs/combos, or any other kind of control. Keep confirmation enabled … Never mark untouched empty fields invalid on opening or blur." "Remote validation: Validate on submission … Keep entered values." "Non-blocking warning: Warn without preventing a valid apply." |
| VL1 | `ch04:315` | "An invalid submit keeps the dialog open, marks the field in its reserved message lane (visible text, no layout shift) and focuses the first invalid field, and the typed draft stays. A rejection after dispatch reopens the draft with the reason in that lane." |
| DR1 | `ch04:317` | "A disabled command shows its reason as visible text beside it or in its lane." |
| A4 | `ch16:32` | one 16 px lane per field that has a hint, a validator or a restart note; "An error, a warning, *Checking* or *Saved* replaces it in place." |
| Apply | `ch04:175` | "Saves/previews changes without closing; disabled when nothing changed." |
| F-3, F-4, F-5 | `ch14:118-120` | a read-only value is `readonly`, never `disabled`; "A setting committed with the form is a checkbox field"; a setting that applies on change is a settings row. |

### The mock: the implementation (what the rules were built from)

| What | Where | Notes |
|---|---|---|
| The model, in the file's own header | `shell-page-settings.js:2-24` | "Every row passes through ONE pipeline (commit): parse, synchronous validation, asynchronous check, apply and persist, then side effects." Drafts are runtime data, "no draft outlives its field". |
| The row contract | `shell-page-settings.js:75-79` | `control: switch \| seg \| select \| slider \| number \| text \| path \| url \| endpoint \| secret \| color \| tokens \| paths \| keybinding \| app \| theme \| choice \| mute \| action \| status \| token \| snippet \| custom`; options `min max step unit marks placeholder mono hint restart (true or 'plugin') requires { key, reason } (or a list) gate 'developer' env NAME sensitive`, and FUNCTIONS `parse sync check note apply`. The new schema replaces the functions with declared data. |
| Unknown control | `shell-page-settings.js:298-300`, `:752` | `CONTROL_ALIAS[r.control] \|\| 'unsupported'`; drawn as `Type "<raw>"`. The old app already says "Unsupported setting type" (`ui/pages/settings/SettingsEntry.tsx:105`). |
| Why a row cannot change | `shell-page-settings.js:355-395` | `unmetRequirement` (a list, in order, each with a reason; `equals`, `not` or truthy) and `lockOf`: the order is the store, the plugin, an environment variable, a managed value, a dependency. |
| Modified marker | `shell-page-settings.js:349` | differs from the default, and not under an environment variable or managed. |
| Sync validation by control | `shell-page-settings.js:416-455` | number range and grid (`Out of range. Use a value from 1 to 300.`), options membership, path, URL, endpoint, colour; messages "Problem. Fix.". |
| The pipeline | `shell-page-settings.js:954-989` | a lock check; a generation counter per field (`live()`); sync validation (`invalid` keeps the text); no change is `same: true`; the async check with `Checking…` and stale drop; `retry` (could not check) and `invalid`; apply; `failed` with Retry; `Saved` for 2 s. |
| Revert and reset | `shell-page-settings.js:990-1003` | Escape bumps the generation (a pending check is dropped) and clears drafts; reset commits the default and skips the check; "a secret committed empty is ignored". |
| Message order | `shell-page-settings.js:758-776` | `messageFor`: what became of the value just entered, then Saved, then a standing warning or note, then the hint. |
| The `allow` filter | `shell-page-settings.js:1283-1303` | named character classes (`digits hex color header hostport dns`) refuse an inserted character in `beforeinput`: a view rule, so the model offers a pure check. |
| The secret control | `shell-page-settings.js:725-728` | placeholder "Saved · hidden" or "Not set", `autocomplete="new-password"`, the Show button disabled while nothing is typed ("A saved secret is never shown again."). |
| Records | `shell-page-kit.js:60-70`, `:590-690` | `H.recordDialog`: `fields [{ id, label, type, value, options, hint, required, validate(value, values) }]`; `onConfirm(values, api)` answers `undefined \| true \| false \| { error, errors: { fieldId: message } }` or a promise; a busy draft ignores a second confirm; "once submitted the messages follow the draft"; the first invalid field takes focus. |
| The states of a row | `core.js:5775-5788` | default, modified, invalid, warning, checking, retry, saved, apply failed, restart, set by environment, disabled, read-only. |
| Other form engines | the mock's manifest-editor form host (`*-editor-form-host.js:1-60`) and its native forms (`*-forms-native.js`) | a resource-manifest form host (paths, sequences, `sensitivePaths`, `readonly` shown as facts, `lookup` with a signal). Domain-specific: not a model for this step; its `lookup(signal)` is the shape of the option provider below. |

### The mock: the harness

`tests/shell-model-harness/` holds `R2Store/unit.cjs`, `ShellStore/unit.cjs` and `ShellStore2/ShellStore2-unit.cjs`. **No unit tests the settings model or a record form.** The cases that bear on forms are the draft guard of S27, `R2Store/unit.cjs:437-510`: `draft.set(tab, { dirty: () => dirty, save: async () => 'saved' \| { result: 'invalid', reason }, discard })`; a dirty draft asks once; `save()` that answers `invalid` keeps the reason and the draft; a clean tab and a tab with no draft are never guarded; `draft.set(a, 5)` throws and `{ save: 5 }` throws "save must be a function". They are ported in `oracle.test.ts` as the contract of `store.draft()` (below).

### The current app: how settings are declared today

| What | Where | Notes |
|---|---|---|
| The types | `plugin-sdk@v0.20.0 settings/types.go:6-25` | `text select multiselect integer float toggle color datetime password`. |
| One setting | `settings/setting.go:16-44` | `id label description type value default options[{label,description,value}] fileSelection{enabled,allowFolders,extensions,multiple,relative,defaultPath} sensitive devOnly requiresRestart pendingRestart`, and a Go `Validator` that is never serialised. |
| A validation answer | `settings/setting.go:83-88` | `{ valid, code, message }`, "safe to show in settings forms". |
| The host's service | `backend/pkg/settings/service.go:24-37`, `:217-256`, `:257-275`, `:276-332` | `Scope{kind host\|plugin, pluginId}`; `GetSnapshot` blanks a sensitive setting's value, default and options (`:244-250`); `Validate(scope, id, value)`; `Commit(scope, values)` answers `{ snapshot, applied, uncertain, message }`; a failure is `CommitError{Validation}` with the fixed text "Settings could not be saved. Check the values and try again." |
| The host's categories | `internal/settings/{general,appearance,editor,terminal,developer,telemetry}.go` | `Text` with `Options` is a select (`general.go:14-25`, `appearance.go:33-70`); `Integer` with no range (`editor.go`, `terminal.go`); `Toggle`; `Password` with `Sensitive` (`telemetry.go:173-178`, `:205-210`, `:228-233`); `Text` with `FileSelection` (`developer.go:75-117`); `RequiresRestart` (`developer.go:25-58`); a slow Go validator (`validation.go:41-93` runs `go version`, 5 s). **Every validation today is server side.** |
| Plugin declarations | three plugins' own repositories: `pkg/main.go:56-128`, `pkg/main.go:21-135`, `main/pkg/main.go:15-25` | a `Text` setting with an ARRAY default and `FileSelection{Multiple}` is a list of paths (a plugin's list of config files); `MultiSelect` with options; `Select`; `Integer`. |
| The old page | `ui/hooks/settings/useSettingsForm.ts:23-111`, `ui/pages/settings/SettingsEntries.tsx`, `SettingsEntry.tsx:45-140`, `SettingsFormShell.tsx` | the EXPLICIT model: drafts, 400 ms debounced `validate(id, value)` per draft (`:45-63`), Save checks everything again then `commit(values)` (`:68-102`); "Unsaved change"; `devOnly` rows hidden unless developer mode (`SettingsEntries.tsx:104`); "Saved · Restart pending" (`:136`) and "Unsaved change" (`:140`); options select or multi-select; toggle checkbox; array value as one textarea line per item; text, password, number, colour, datetime inputs; a file button (`SettingsEntry.tsx:115-136`); unknown type "Unsupported setting type". |
| Plugin-side seams | `packages/omniviewdev-runtime/src/settingsEditors.ts:1-40`, `ui/features/settings-editors/index.tsx` | a plugin may replace the CONTROL of one existing field ("Host owns drafts, validation, save/reset, labels and focus. Editors only propose values."); the field keeps its kind, so this is a view seam. Plugin setting ids are opaque and may contain dots. |
| The hook | `packages/omniviewdev-runtime/src/hooks/settings/useScopedSettings.ts` | `validate(id, value)` and `commit(values)` are the two calls a form needs. |
| Host errors | `backend/pkg/apperror/apperror.go:14-28`, `docs/ui-next/status/E0-1.md:51-82`, `packages/omniviewdev-runtime/src/errors/{types,parseAppError}.ts` | `{ type, title, status, detail, instance?, suggestions?, actions?, code?, requestId?, recovery?, location? }`; Wails gives a `RuntimeError` whose `message` is that JSON. **There is no per-field member.** |

What the existing settings need, and the schema's answer (the full table is in the README): every type above has a kind; `Text`+`Options` is `select`; `Text`+array default+`FileSelection{Multiple}` is `list` of `path`; `Password` and `Sensitive` are `secret`; `DevOnly` is a condition on a host context flag; `RequiresRestart` is `restart`; the Go `Validator` is `validate.remote` (the host's `validate(id, value)`); `Integer` and `Float` are `number`; `DateTime` is `text` with a `datetime` format.

### The conventions of `core/tabs` and `core/palette`

Read: `core/tabs/README.md`, `core/palette/README.md`, `core/palette/{types,store,runner,recents,saver,testing,purity.test,perf.test}.ts`, `core/saver.ts`, `core/tabs/json.ts`. Followed here:

- Pure TypeScript, no React, no DOM, no timer but the scheduler the store is given; `purity.test.ts` reads every source file and fails on a framework import, a browser global or a bare timer.
- `types.ts` is the contract; `index.ts` the public surface; `testing.ts` is test support (a manual clock and fixtures) that nothing in the model imports.
- One immutable, frozen snapshot with a `version`; `getSnapshot`, `subscribe` and `subscribeTo(select, listener, equals)`; a `noop` changes nothing and notifies nobody; objects that did not change keep their identity.
- A `Scheduler { now, setTimeout, clearTimeout }` and an `ErrorHook`; a request that is superseded is aborted and its answer is never delivered (`runner.ts`).
- A versioned saved form with an empty `MIGRATIONS` at version 1 and a `restore` that repairs rather than discards.
- Tests: a manual clock, an oracle file that lists what it ported and what it did not, a performance file whose bound is generous and compares the fastest of three runs.

## Log

- 2026-11-20: worktree from `origin/main` 1a7bd5f9; install and `task packages`; read AGENTS, decisions, the tab and palette models, chapters 04, 14 and 16 and the mock's settings and form code, the host's settings service, the SDK's `settings` package, the old settings pages and the three plugins' declarations.
- 2026-11-20: first piece, tests first and seen red (the modules did not exist): `types.ts` (the contract), `text.ts` (cleaning and the secret scrubber), `expr.ts` (conditions as data, with what they read listed), `values.ts`, `schema.ts` (the compiler: closed kinds, `unsupported`, defaults, constraints, options, conditions and their reverse index, schema versions and the migration hook), `constraints.ts` (the local checks and when each is told). 119 tests. PR opened as partial.
- 2026-11-20: second piece: `runner.ts` (keyed asynchronous work; its tests were seen red against a stub, 12 of 13), `errors.ts` (the host error on the form), `persist.ts` (the saved draft), `store.ts` and `testing.ts`, with the store's test files (`store` `validation` `async` `modes` `submit` `errors` `secrets` `persist`). The store and its tests were written in one sitting, not test-first: the first full run was 10 red and 322 green; the reds were three store faults (a host error was scrubbed AFTER the secret was dropped, so a secret echoed in a rejection was shown; the id lists were not frozen; an announcement was not repeated for an error raised again after an edit) and five test expectations (a key that is absent is not `undefined` for `toMatchObject`; a title that is over its bound is not an envelope; a listener that threw after the secret was gone). All fixed; none by weakening an assertion.
- 2026-11-20: `purity.test.ts`, `perf.test.ts`, `fuzz.test.ts`, `index.ts`, `README.md`; negative controls (six mutations of a copy of the folder, below); bundle identity; the CI commands.
- 2026-11-20 (after CI of the first push): the kit's vocabulary guard (decision A13, `packages/kit/eslint/vocabulary.test.mjs`) failed on plugin words in this folder's tests and README (21 hits, found by running the guard's own scanner over the folder); neutral words now, and the purity test's own word list is gone (the kit's guard holds that rule for all of `ui-next/`). The lead's ruling on secrets applied test first: 9 of the new secret tests red against the old store, green after the change.

## What was built

All under `ui-next/shell/core/fields/`; 356 tests in 16 files.

| File | What |
| --- | --- |
| `types.ts` | The contract: the schema as written (closed `FIELD_KINDS`), the snapshot (`FormState`, `FieldState`), the seams (`FormOptions`, `Scheduler`, validators, providers), `LIMITS`, `TIMING`, `ISSUE_CODES`, `SCHEMA_VERSION`, `FORM_VERSION`. |
| `schema.ts`, `expr.ts`, `values.ts`, `constraints.ts`, `text.ts` | The compiler (never throws: problems are data), conditions as data with a reverse index, what a value is by kind, the local checks and when each is told (ch04), cleaning and the scrubber. |
| `runner.ts` | Keyed work: debounce, abort when replaced, a stale answer is never delivered, at most four in flight, a time limit. Used for remote checks, option providers, the saved marker. |
| `errors.ts` | The host's apperror read as data (the same reading as `parseAppError`), put on the form and on fields by id, cleaned and scrubbed; a non-host error gets a generic sentence. |
| `store.ts` | `createFormStore`: one frozen snapshot with identity kept for what did not change, `subscribe` and `subscribeTo`, `setValue blur commit retry revert reset submit draft setContext setFieldLock setFormLock queryOptions rebase serialise stats dispose`; both modes of the mock (apply-on-change, explicit); sensitive values in a closure-private vault. |
| `persist.ts` | The saved draft: `FORM_VERSION`, `DRAFT_MIGRATIONS`, `restoreDraft` (repairs, never restores a secret, bounded against a hostile draft). |
| `index.ts`, `README.md` | The surface; the schema reference, what the kit's form parts will need per kind, the mock's rules and where each is kept, the open questions of the credential track. |
| `testing.ts` | Test support only (see Dev tools). |

## Decisions and deviations from the mock (for the lead)

1. **A secret IS kept after the host rejects a submit** (the lead's ruling, applied after the first review; the first build dropped it when it was handed over, which departed from the lab's VL1 "the typed draft stays"). It is held in memory from typing until the host takes it: kept through a rejection (a form that applies on change keeps it too, so Retry sends it again), dropped on success, revert, a hidden field and dispose. It is in no snapshot, saved draft, message, announcement, count or log, and the host's text is scrubbed of it for as long as it is held. Found while writing its tests: a success `notice` of the host was shown as given; it is now cleaned and scrubbed like the host's other texts.
2. **A condition that cannot be read holds** (fail-open: an unknown field or operator is a problem in `schema.problems`, the field stays shown and enabled); a note that cannot be read is left out. The alternative, hiding a field the build cannot judge, would hide a setting for good.
3. **"Couldn't check" is a third outcome, not "invalid"** (ch04): a check that throws, times out or answers `retry` says "Couldn't check. Try again.", offers Retry, and blocks applying (apply-on-change) and submitting until it is answered.
4. **The mock's row functions (`parse sync check note apply`) are declared data**: `parse` and `check` are `constraints` and `validate.remote` (a name the host registers), `note` is `notes[{ when, kind, text }]`, `requires { key, reason }` is `enabledWhen` with `reason`, `gate: 'developer'` is `visibleWhen: { ctx: 'developer' }`, `env NAME` and a managed value are `setFieldLock`, `apply` is the `submit` callback.
5. **Nine kinds, not the mock's twenty-four controls** (`text number boolean select multiselect path url color secret list`): `seg` `slider` `switch` `choice` are views of `select` `number` `boolean` (a `display` hint); `endpoint` is `url`, `tokens` and `paths` are `list`; `keybinding`, `theme`, `app`, `action`, `status`, `snippet`, `custom` are the lab's own and not in the existing settings.
6. **`sensitive` may be set on any kind** (the vault holds JSON), not only on `secret`; a secret has no `default`, takes no remote check, and a condition can only ask whether it is `empty`.
7. **A host error is shown only when it is the host's**: an error that is not an apperror gets "The change could not be applied."; its raw message is never shown.
8. **A submit that succeeds makes what was sent the applied values** (the draft is not left dirty); `send: 'changed'` sends only changed fields, `send: 'all'` every field.
9. **`testing.ts` has its own manual clock**; it does not import the palette's (a model does not depend on another model's test support). `Promise.withResolvers` is not used (the app's `lib` is ES2023).
10. **The performance bound is generous** (1,500 ms for 200 keystrokes in a 500-field form, fastest of three); the real assertions are counts: one keystroke in a controller reads exactly its 5 conditions, runs one check and builds at most 6 fields, and a field nothing reads builds one.

## Backend catalog

Items for the lead to record in `docs/ui-next/backend-catalog.md` (this step does not edit it; the catalog on `origin/main` d5ecf57c ends at B-14, so B-34, the number the assignment gives, is not in it yet):

- **B-34, WIRE-free, host runtime:** `@omniviewdev/runtime/ui/v1` has no one-shot, uncached call that hands a value to its caller and leaves nothing in the QueryClient or the activity lane (the same primitive as Secret reveal: `docs/ui-next/status/SEC1.md:76,113`; `useResourceActions.ts:48-61` caches the result, invalidates every resource query and raises a notification). Manual credential entry needs it for its submit. The model's `submit` callback is where it plugs in.
- **The apperror envelope has no per-field member.** A rejection per field needs a `fields` member (a list or a map of field id and sentence); the model reads one when it exists, and a validation-class error whose `instance` is a field's id.
- **The host's `CommitError` is plain text, not an apperror** (`backend/pkg/settings/service.go:39-49`) and names no field.
- **The settings snapshot blanks a sensitive value and carries no "is set" flag** (`service.go:244-250`), so a page cannot say "Saved · hidden" or "Not set"; the form takes `presence` until the host sends it.

## Verification

Run in the worktree on the final tree, rebased on `origin/main` d5ecf57c, BEFORE the push, with the commands of CI's "UI checks" job that apply to what this step touches. (The first push skipped the kit's `verify`, which holds the plugin-vocabulary guard, and CI failed there.) The sandbox is the real repository; no mocks of the model.

- `pnpm exec vitest run ui-next/shell/core/fields`: 16 files, 356 tests pass.
- **The kit's `verify` whole** (`pnpm --filter @omniviewdev/kit run verify`: generate:check, typecheck, lint:css, test, build, api:check): exit 0. Its test step (87 files, 2,234 tests) holds `eslint/vocabulary.test.mjs`, the plugin-vocabulary guard of decision A13. The guard's own scanner over this folder, its README and this file: 0 hits.
- `pnpm test` (the root command): exit 0; 245 files passed, 1 skipped; 3,415 tests passed, 3 skipped.
- `pnpm lint`: exit 0; 0 errors, 8 warnings (none names this folder).
- `pnpm exec tsc -p tsconfig.app.json --noEmit` and `-p tsconfig.test.json --noEmit`: exit 0 (the kit's typecheck is part of `verify`).
- `node --test scripts/react-compiler.test.mjs`: 13 pass. `node scripts/check-tracked-outputs.mjs`: ok.
- `node --test scripts/ui-flavour.test.mjs`: 7 pass, after `pnpm build` (CI builds first; without a stable build its first test fails with "no stable frontend build").
- **The `next` bundle is byte-identical.** `OMNIVIEW_UI=next` `vite build` of this tree and of the same tree with `ui-next/shell/core/fields` moved aside, to two output directories outside the repository. `git diff origin/main` outside this folder and this file is empty (docs are not bundled). `diff -r` of the two outputs is empty; both have 9 files and the same digest of the file list with their hashes (`2f593221…`). The folder was put back after.
- **Negative controls**, each a mutation of a COPY of the folder run with the real test files (the copy was removed; the repository sources were not touched). The store:
  - a secret's value goes into the snapshot: 24 tests fail (`secrets.test.ts` 20, `fuzz.test.ts` 4); with `secrets.test.ts` removed the 4 fuzz tests still fail; **with both removed the same leak passes the other 14 files (316 tests): undetected**, so the two sentinel searches are what catch it;
  - the store does not scrub what the host says back: 6 fail, all in `secrets.test.ts`;
  - a running submit can be started again: 1 fails (`submit.test.ts`, "is not run twice");
  - an untouched empty required field is told when it is only passed: 1 fails (`validation.test.ts`, "is never told when the form opens…");
  - an old verdict stays when the value changes (the check is not cancelled): 3 fail (`async.test.ts` 2, `modes.test.ts` 1);
  - a value is applied while its check is wrong: 7 fail (`async.test.ts` 3, `modes.test.ts` 4).
- **The kept secret (the lead's ruling), test first.** Against the store as it was, 9 of the 36 tests of `secrets.test.ts` failed (the count of secrets held while a call runs, the success notice, the three kinds of rejection, revert and dispose after a rejection, the tab guard, Retry of an apply); the test that a newer secret typed while an older one is applied is not dropped passed before and after (it guards the new conditional drop). After the change all pass. Controls:
  - a success does not drop the secret: 6 fail (`secrets.test.ts`);
  - an apply drops a newer secret typed while it ran: 1 fails ("does not drop a newer secret that was typed while an older one was being applied");
  - a kept secret leaks into the snapshot after a rejection only (the failure puts it in the form's notice): the explicit assertion asked for, `holds(JSON.stringify(state), SENTINEL)` in "keeps what was typed after …", trips at `secrets.test.ts:274`. With those two assertions removed, `expectClean` (it searches the same snapshot and everything else the model said) trips instead, so this leak has two detectors. A leak in the field's own `secret` object is caught earlier, by the `toEqual` on it (a first try at this control showed that).
- `fuzz.test.ts`: four seeds of 400 random operations (set, blur, commit, revert, reset, context, locks, submit, rebase, options, clock) with every snapshot checked (frozen, JSON-shaped, `dirtyIds` and `invalidIds` consistent, no value on a sensitive field) and a sentinel searched for in every snapshot, saved draft, count, announcement and reported error. Its first run failed for a reason in the test (the sentinel was also typed into plain text fields, and a host echoed it when none was sent); after that fix it passes.

## Not verified

- **No oracle file.** The tab and palette models have a second, slow implementation to compare with; this step has none. The mock's rules (ch04, S125 to S127, S27's draft guard) were ported as test cases from reading the lab's code and chapters, not by running the lab's code against the model.
- No browser, no screen reader, no UI: there is none in this step. The kit form parts that will consume the model are not written; the README lists what they need.
- No real host or plugin run: the shape of the host's `ValidationResult` and apperror is from reading the SDK and `E0-1.md`; nothing was called. The `fields` member and the `instance` rule of the envelope are the model's proposal, not the host's behaviour.
- The platform scheduler (the store's default) has one test, on fake timers (`async.test.ts`, last block); it is not run in real time or under load. Performance numbers are Node on one laptop; the bound is generous on purpose.
- CodeRabbit did not review this pull request: it reported its free review limit reached (0 review comments; one notice). The first push's `UI checks` failed at the kit's vocabulary guard (reported by the lead; fixed here); the other jobs of either push were not read, and CI of the final head had not finished when this was written.

## Dev tools

`testing.ts` (excluded from the purity rules, imported by tests only): `manualClock` (`advance`, `flush`, `pending`), `deferred`, `after(clock, ms, value, signal)` (a value that arrives later and rejects on abort), `SENTINEL`, `makeForm(schema, options)` (a store over a recording submit; returns `{ store, clock, submits, announced, errors, seen }`), `schemaOf`, `valuesOf`, `committed`, `succeeded`. `store.stats()` counts what a keystroke did (`built`, `conditions`, `validations`, `remote`, `notified`, `secrets`) so a test asserts work, not time. `README.md` is the reference for a person writing a schema.
