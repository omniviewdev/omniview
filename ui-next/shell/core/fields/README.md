# The form field model

The state and rules of a form, as pure TypeScript: no React, no DOM (`purity.test.ts` fails the build if one is imported), no timer but the scheduler it is given. It backs the Settings pages, a plugin's settings and, for a separate track, connection and credential entry. It is driven by DECLARED DATA (a schema a plugin or the host writes as plain JSON), never by components. Rules come from the design lab: chapter 16 S124 to S132 and S27, chapter 04 "Validation timing and outcome", VL1, DR1, chapter 14 F-3 to F-5 (the lab's `shell-page-settings.js` and `shell-page-kit.js` `H.recordDialog` are the implementations the model was read against). **Step FM1: logic and tests only. Nothing imports this folder; the `next` bundle does not change.** `docs/ui-next/status/FM1.md` lists everything read.

| File | What |
| --- | --- |
| `types.ts` | The contract: the schema (as written), the snapshot, the seams, the limits and the timing. |
| `schema.ts` | The compiler: a schema becomes a frozen, indexed form; kinds, defaults, constraints, options, conditions, versions, `migrations`. Never throws. |
| `expr.ts` | Conditions as data (`field`, `ctx`, `all`, `any`, `not`), compiled once, with what they read listed. |
| `constraints.ts`, `values.ts`, `text.ts` | The local checks and when each is told; what a value is by kind; cleaning plugin text and scrubbing secrets. |
| `runner.ts` | Keyed asynchronous work: debounced, aborted when replaced, stale answers never delivered, bounded in flight, a time limit. |
| `errors.ts` | The host's apperror read as data and put on the form and the fields, cleaned and scrubbed of secrets. |
| `store.ts` | The store: one frozen snapshot, `subscribe`, the operations. `persist.ts`: the saved draft. `index.ts`: the surface. |
| `testing.ts` | Test support: a manual clock, a fixture over a recording submit callback. Nothing in the model imports it. |

## The schema (plain JSON, no functions)

```json
{ "version": 1, "id": "plugin:demo/settings", "sections": [
  { "id": "connection", "label": "Connection", "fields": [
    { "id": "url", "kind": "url", "label": "API URL", "help": "Address of the API.", "constraints": { "required": true },
      "validate": { "remote": "reachable", "checking": "Contacting the server…" } },
    { "id": "token", "kind": "secret", "label": "API token", "constraints": { "minLength": 8 } },
    { "id": "verify", "kind": "boolean", "default": true,
      "notes": [{ "when": { "field": "verify", "equals": false }, "kind": "warning", "text": "Certificates aren't checked." }] },
    { "id": "port", "kind": "number", "default": 9090, "constraints": { "min": 1, "max": 65535, "integer": true },
      "visibleWhen": { "ctx": "developer", "equals": true }, "restart": true }
  ] } ] }
```

**Kinds (closed): `text number boolean select multiselect path url color secret list`.** A kind that is not on the list (a newer plugin) becomes an `unsupported` entry: read-only, never submitted, never a crash, and it says "Not supported in this version." A member the build does not know is ignored; JSON `null` is "nothing" (how a Go struct with no value says it).

| Field member | Meaning |
| --- | --- |
| `id` (unique, opaque, may contain dots), `kind`, `label`, `help` (one sentence), `hint` (the lane's default line), `placeholder`, `unit`, `keywords` | What the view says. All text is cleaned and bounded. |
| `default` | A value that fits the kind; dropped (a problem) when it does not. Never kept for a secret. |
| `constraints` | `required minLength maxLength pattern allowedChars format('datetime') min max step integer minItems maxItems unique item pathKind absolute extensions schemes sameAs messages`. A pattern is anchored and run only on inputs up to 4,096 characters. |
| `options` | A list of `{ value, label, description?, disabled? }`, or `{ "provider": "name", "params", "limit" }` for a set too large to list: the host registers the provider by name; it is asked after 150 ms of quiet, aborted when the query moves on, at most 200 rows kept. |
| `validate` | `{ remote: "name", on: "commit"\|"change", debounce, timeout, dependsOn, checking }`: the host's own check (the SDK's `ValidationResult`); never for a secret. |
| `visibleWhen`, `enabledWhen`, `notes[{ when, kind, text }]` | Conditions over other fields' values and the host's flags (`ctx`). Leaves take `equals notEquals in notIn has empty gt gte lt lte startsWith`; `reason` on a node is what a disabled field says (DR1). A condition that cannot be read holds; a note that cannot be read is left out. A secret can only be asked `empty`. |
| `sensitive`, `readonly`, `restart` (`true`, `app`, `plugin`), `display`, `mono` | A secret's value reaches only the submit callback; a fact is `readonly`, never `disabled` (F-4); `display` is a hint the view may ignore. |

**Sections** (`id`, `label`, `help`, `collapsed`, `visibleWhen`, `fields`) are the form's groups. **Versions:** `version` absent is 1; a newer one is `foreign-version` (never half used); an older one is brought up by `migrations` (a step per version, keyed by the version it starts from; `MIGRATIONS` is empty at 1). A new kind is a MINOR addition (older builds degrade it); a changed meaning is a new version.

What the existing settings need, and the schema's answer: `Text` is `text`; `Text`+`Options` and `Select` are `select`; `MultiSelect` is `multiselect`; `Integer`/`Float` are `number` (`integer`); `Toggle` is `boolean`; `Color` is `color`; `DateTime` is `text` with `format: "datetime"`; `Password`/`Sensitive` is `secret`; `FileSelection` is `path` (`pathKind`, `extensions`), and `FileSelection{Multiple}` with an array default (a plugin's list of config files) is `list` with `item: "path"`; `DevOnly` is `visibleWhen: { ctx: "developer" }`; `RequiresRestart` is `restart`; the Go `Validator` is `validate.remote` (the host's `validate(id, value)`).

## The store

`createFormStore({ schema, mode, send, initial, presence, draft, context, pendingRestart, submit, validators, providers, scheduler, announce, onError })` returns `getSnapshot`, `subscribe`, `subscribeTo`, `field(id)` and the operations `setValue blur commit retry revert reset submit draft setContext setFieldLock setFormLock queryOptions rebase serialise stats dispose`. The snapshot is a frozen, JSON-shaped `FormState`: one `FieldState` per field (value, `dirty`, `touched`, `edited`, `modified` (the reset marker), `visible`, `enabled`, `readonly`, `lock`, the ONE `message` of the lane, `issues`, `validation`, `pendingRestart`, `options`, `selected`) that keeps its identity while it does not change, and the sections, `dirtyIds`, `invalidIds`, `class`, `canSubmit` with `submitBlocked` (its reason as visible text), `firstInvalid`, `submit`, `issues` (the host's sentence for the form).

**Two models (A6).** `apply-on-change` (a setting): a switch, a choice, a list and a slider apply the moment they are set; text, number, path, URL and secret fields commit on `commit`/`blur`; a value that fails stays in the field with its error while the applied value stays in effect; `revert` is Escape; "Saved" shows for 2 s; a value the host could not apply says so with Retry; conditions read the APPLIED values. `explicit` (a record): the draft is kept; `submit` checks everything, tells every lane, sends nothing when something is wrong and names the first field to focus; a submit already running is the same submit (one host call, one answer); the host's rejection goes on the fields and the form and the draft stays; `draft()` is the tab guard of S27 (`dirty`, `save`, `discard`).

**When a check is told (ch04).** An illegal character and a value past its maximum at once; everything else about a value once it was committed or a submit was tried, then live as the value changes; a missing required value only after a submit, or after the field was edited and committed, never for a field that was merely opened or passed. A form of up to three inputs and nothing else is `simple` (confirmation waits for the required values); anything else is `complex` (confirmation stays enabled so a submit can say what is missing).

**The message lane (S127):** the lowest rank first: error, warning, checking (the loader only after 1 s), couldn't check · Retry, saved, info (a note, a lock's reason, a restart), hint. A field that is disabled says why and nothing else.

**Asynchronous work.** A remote check is asked on commit (or, debounced, while the value changes), once per value (the answer is remembered), aborted when the value changes, never asked about a value the local checks refuse; "couldn't check" (a throw, a timeout, the host's `retry`) is not "invalid", and a value that could not be checked is not applied or submitted; at most four run at once.

**Host errors.** The apperror JSON (the shape in `docs/ui-next/status/E0-1.md`) is read like `parseAppError` reads it; its title, sentence, suggestions, actions (a closed list with safe targets), recovery, request id and code go on the form as data. The envelope has no member for a field today (Backend catalog), so a `fields` member (list or map) and a validation error whose `instance` is a field's id are accepted for when the host sends one. An error that is not the host's gets a generic sentence; the raw message is never shown.

## Secrets

A secret reaches NOTHING but the submit callback. The snapshot says only `{ presence: 'set' | 'unset', changed }`; there is no `value` and no `default` member. A secret is never in a saved draft, a message, an announcement, a count, a log or a check's `values`; it is not asked of the host (a check declared on one is not kept); a condition can only ask whether it is empty. It is held in memory from the moment it is typed until the host has taken it: a rejection keeps it (the lead's ruling), so the user fixes the other field and sends again without typing it, and a form that applies on change keeps it too, so Retry hands the same value over again; a success, a revert, a hidden field and a dispose drop it. A host that echoes it in an error or in a success notice is scrubbed from every text of the answer (as typed, as cleaned, and for as long as the call is in flight or the secret is held). `stats().secrets` is a count. `secrets.test.ts` plants a sentinel and searches every snapshot the store ever made (as JSON and as JSON escapes it), what it would save, announce and report, and the console, after a rejection as before one; its last block shows the search itself finds a leak.

## What the kit's form parts will need (a later step)

Per kind: **text** a labelled input (mono, multiline for `display: "multiline"`, `maxLength`, a view that refuses a character with `allows(field, text)` before it takes it, never during IME composition); **number** a stepper that keeps the typed text (`value` is a string until it is a number) and commits on Enter or blur, a slider for `display: "slider"`; **boolean** a switch in a settings row, a checkbox in a record; **select** a native select for a few options, segmented or cards by `display`, a searchable entity picker when `optionsState` exists (the part calls `queryOptions` and reads `selected` for the label of what is chosen); **multiselect** checkboxes or cards; **path** an input with a Browse button (`pathKind`, `extensions`), and a Test action when it is remote-checked; **url** an input; **color** an input with a swatch; **secret** an UNCONTROLLED password input that never renders a value, shows "Saved · hidden" or "Not set" from `presence`, clears its own text when `changed` becomes false, and has a Reveal that works only for what is being typed; **list** tokens with add and remove, each applying at once. Every row needs: the label as `label[for]`, `help` (two lines, the rest as a tooltip), the 16 px message lane (`message.kind` picks the glyph, `retry` a link, `slow` the loader), the reserved reset slot shown when `modified`, `aria-invalid`/`aria-describedby` from `issues`, the lock's reason, `restart`; plus a page footer (`canSubmit`, `submitBlocked`) and a status slot (`lock`).

## Open questions for the credential track

1. **B-34** (`@omniviewdev/runtime/ui/v1` has no one-shot, uncached action call): manual credential entry and prompts need the same primitive as Secret reveal. The `submit` callback is where it plugs in; it must not go through the main entry's mutation cache (`useResourceActions.ts:48-61`), the activity lane, or any logger. Design it once.
2. **Decided by the lead:** after the host rejects a submit, the typed secret is KEPT in memory in the live form (the lab's VL1: the typed draft stays). A view shows it as typed (`secret.changed: true`, `presence` as it was) and never its value; it is dropped on success, revert, a hidden field and dispose, and it appears in no snapshot, `serialise()`, announcement, log or error text.
3. Presence: the host's settings snapshot blanks a sensitive setting's value (`backend/pkg/settings/service.go:244-250`) and sends no "is set" flag, so the page cannot say "Saved · hidden" or "Not set": pass `presence`.
4. The host's `CommitError` is not an apperror (`service.go:39-49`) and names no field; for a rejection per field the envelope needs a `fields` member.
5. Plugin-declared slots: the model is plugin-agnostic, so a credential manager is driven by the schema a plugin declares; who validates a credential (the host through `validators`, or the plugin) is open.

## Not built, on purpose

The kit parts and any UI; the Settings page, its search over rows and the palette's `setting` provider (a schema lists `keywords`); an adapter from the SDK's `Setting` to a schema; a custom editor for one row (a view seam: the field keeps its kind); repeating groups of fields (a list of objects); the `keybinding`, `theme` and `app` controls of the lab (the lab's own, not in the existing settings); the oracle file the tab and palette models have (a second, slow implementation to compare with).
