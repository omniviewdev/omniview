# Status: FM2a (kit form parts, first slice)

**State (2026-11-21): PARTLY DONE, NO PULL REQUEST.** The six parts, their examples, their unit tests (seven new test files), the glyphs and the API report are built and green; the kit probe section, its negative controls, the shard-table entries, the screenshots and the CI-equivalent runs are NOT done (the run hit its request budget). Resume from "What is left".

- Agent: FormParts
- Goal: the first six kit parts of a form, plain controlled components that the shell binds to the field model (`ui-next/shell/core/fields/`, FM1) in a later step: `Field`, `TextInput`, `NumberInput`, `Toggle`, `Select`, `SecretInput`. Not in this step: multiselect, file path, colour, the form layout and page, the binding to the model.
- Owns: the new directories of `packages/kit/src/components/` named above (and `FormControl/`, internal to them), their examples (the parts page lists them from the examples registry), the kit probe's form section and its controls, the kit API reports, and this file.
- Worktree: `~/Repos/omniviewdev/worktrees/ui-next-fm2a-form-parts`
- Branch: `ui-next/fm2a-form-parts` (from `origin/main` 20679a1b); the work is saved on `wip/ui-next/fm2a-form-parts` (no pull request).
- PR: not opened.

## Log

- 2026-11-21: worktree from `origin/main` 20679a1b; `pnpm install`, `task packages`; read AGENTS, decisions, TRACKER, FM1 and its README, the kit's parts, probes and shard table, and the mock's settings page, `H.field`, `H.settingRow`, `H.stepper`, `H.switch`, `H.select` and the chapters. Load average 20 to 44 while reading, so no timing was taken.
- 2026-11-21: the lead approved three glyphs outside the owned paths (`minus`, `eye`, `eye-off`, in `Icon/glyphs.ts`). Another agent (`ui-next/o1b2-notice-centre`) adds six to the same files (`glyphs.ts`, `glyphs.test.ts` names list and byte budget, `Icon.examples.tsx`, `kit.api.md`): whoever merges second rebases, keeps both sets, re-derives the names list and the byte budget from the real total (here 16,281 bytes: the budget is 16,300) and REGENERATES the API report.
- 2026-11-21: tests first and seen red: the seven new test files (Field, TextInput, NumberInput, Toggle, Select, SecretInput, FormControl) all failed to run (the modules did not exist: "Failed to resolve import"; 7 failed files, no test ran). Then the parts: the first full run was 321 of 328 green; the 7 reds were five test mistakes (jsdom's label click does not focus; a name with no space between a label and its aside, which is a real defect and was fixed in `Field`; a description helper; a regex; two tests that assumed the wrong initial state) and no fault of a part. Final: the kit's `verify` exits 0 (97 test files, 2,611 tests).

## What the mock does (read, quoted; the lead asked for file:line)

Mock tree c8e44a44, `app/OmniviewNativeLab/frontend/mock/` (lab repository at 91da149). Chapters under `research/int-ui/`.

- **Label placement.** `base.css:1065` `.field, .fld { display: grid; grid-template-columns: minmax(96px, 140px) minmax(0, 1fr); align-items: center; gap: 6px; margin: 0 0 12px }`; stacked (`.stacked`, a textarea, below 760 px) one track, `base.css:1069-1071`, `2077-2080`. `core.js:645-650` (`H.field`: "persistent label, the control, then hint and error ... layout 'aligned' puts the label in a track beside the control; 'stacked' puts it above"), `14-consistency-scales.md:118` (F-3: "the layout is aligned (a 96-140px label track) or stacked"), `04-controls-forms-dialogs.md:95` ("Put the label on the left when space allows; above only when the field is long or constrained"), `12-workspace-components.md:539-545`.
- **Help text.** `base.css:1512-1513` `.field__hint` 12/16 muted, wrapping; `04:123` ("At most five lines, about 70 characters wide ... associate descriptions through `aria-describedby`").
- **Error text and the lane.** `base.css:1516-1523` (`.field__message`: one line, 16 px, glyph 16 px, text clipped, error in `--int-error-fg`, warning and retry in `--int-warning-fg`, the loader after 1 s), `core.js:161-187` (`laneKinds`, `lanePick`, `laneHtml`: one message at a time, rank error, warning, checking, retry, saved, info, hint; `aria-live="off"`), `16-ide-shell.md:597` (S127), `04:133-140` (when a check is told), `04:315` (VL1), `04:140` (an error is never only a tooltip).
- **Required mark.** `base.css:1509` `.field__required { margin-inline-start: 4px; color: var(--int-error-fg) }`, `core.js:650-660` (an asterisk, `aria-hidden`, and `required` on the control), `12-workspace-components.md:541`. Optional: no mark; `aside` ("optional") `base.css:1510`, `12:541`.
- **Disabled with a reason.** `14:104` (P2: "stays focusable with `aria-disabled` and shows the reason as visible text beside the control or in its lane"), `04:317` (DR1), `core.js:188-199` (`lockControls`: a text input becomes `readonly` and `aria-disabled`, any other control `aria-disabled`), `core.js:662-705` (`H.settingRow { disabled: reason }` prints the reason in the lane).
- **Read-only.** `14:119` (F-4: readonly, never disabled), `base.css:1499`.
- **Density.** `base.css:858-866`: compact density changes rows and the 22 px row target only; "Controls (28px), icons, the shell chrome and type keep their sizes". The parts hold the control height whatever the density.
- **Text input.** `base.css:1015-1044` (`:where(input, select, textarea, .inp)`: 28 px, `4px 6px 4px 9px`, 1 px `--int-border-control`, radius 4, island fill, 13/16; focus ring, `[aria-invalid]`, warning, disabled), `shell-page-settings.css:45-47` (112, 280, 320 px), `shell-page-settings.js:674` (`textInput`), `:1283-1303` (the `allow` filter in `beforeinput`), `:1313-1330` (Enter and focusout commit, Escape reverts only when there is a draft).
- **Number input.** `core.js:1025-1044` (`H.stepper`), `base.css:1815-1819` (`.stepper`: 2 px padding, 24 px buttons, a field of `6ch` that measures 180 px in both engines, centred, tabular), `core.js:5594-5651` (commit, reject, Escape, arrows, Page Up and Down by a tenth of the range), `16:593` (S125, A18).
- **Switch.** `core.js:963-967` (`H.switch`), `base.css:1148-1159` (`.sw` 26 x 16, knob 12, moved 10 px by transform), `1674-1677` (`.switch-button` 34 x 24).
- **Select.** `core.js:1139-1140` (`H.select`: "a themed native select"), `base.css:1046-1055` (28 px arrow area), `shell-page-settings.css:48` (`min-width: 200px`), `04:80`, `14:122` (F-6: "A bare quantity is a native `<select>`").
- **Secret.** `shell-page-settings.js:725-728` (a password input, placeholder "Saved · hidden" or "Not set", `autocomplete="new-password"`, a Show button disabled while nothing is typed with the reason "A saved secret is never shown again."), `FM1.md` ("only set, not set and changed is ever shown").

## What was built

All under `packages/kit/src/components/`; every part has `<Part>.tsx`, `<Part>.module.css`, `<Part>.examples.tsx`, `<Part>.test.tsx`, `index.ts`.

| Part | What |
| --- | --- |
| `Field` | label (a real `<label for>`), the control, a help line, the one 16 px message lane (kinds: error, warning, checking with the loader after 1 s, retry with Retry, saved, info, hint; glyph and a word for assistive technology, never colour alone; `aria-live="off"`, the model announces), `required` (the asterisk is `aria-hidden`), `aside`, `layout` aligned or stacked, `lane` (reserve the 16 px), `disabledReason` and `readOnly` (the control is locked, the lane prints the reason), `aria-describedby` = help then lane, `aria-invalid` from an error, a warning paints the control and is not invalid. It gives its control a context (`FormControl/fieldContext.ts`). |
| `TextInput` | `value`/`onValueChange`, Enter `onCommit(value)`, `onBlur` (not during a composition), Escape `onRevert` only while `dirty` (stops there; otherwise goes on), `allows(text)` refused in `beforeinput` (a key, a paste, a drop; never composing, never a deletion), `mono`, widths 112/280/320/fill, `invalid`, `readOnly`, `disabledReason` (focusable, `readonly`, `aria-disabled`, described). |
| `NumberInput` | the mock's stepper: a `role=spinbutton` text input, `aria-value*` and `aria-valuetext` with the unit, the text kept as typed and never corrected, arrows and Page keys step and apply (a step past a bound does nothing), two 24 px step buttons that are not tab stops, take no focus, name the field ("Decrease Font size") and say "Minimum is 8" at a bound, `unit`, the same states. |
| `Toggle` | `role=switch` on a native button, 34 x 24 with a 26 x 16 track, one name for both states, `aria-readonly`, `aria-disabled` with a reason. |
| `Select` | a native select with the face of an input and a glyph arrow in a theme role (a native select is used because the mock uses one; `RowMenu` is an action menu, role menu, and is not a value control), placeholder, `readOnly` and `disabledReason` do not open and do not change (Tab and Escape stay). |
| `SecretInput` | `presence` and `changed` only; no `value` prop (a test asserts the type error); one uncontrolled `<input type=password>` that is empty in every state, read-only with the placeholder "Set" for a stored secret, "Not set", "Changed"; Replace unlocks it, Cancel and Escape lock it and tell the model only if something was typed; Show/Hide only for typed text and not drawn for a stored secret; paste untouched; `autocomplete="new-password"`; focus leaving to a button of the part is not a blur. **Cleared when `changed` turns false** (a render-phase reset of three booleans plus one layout effect that empties the input); the part keeps no copy in state, markup or attribute, and a 200-step walk plus a sentinel search over every attribute and text node finds none. |
| `FormControl/` (internal) | `fieldContext.ts`, `useFieldControl.ts` (name, description, lock, reason), `FieldButton.tsx` (the shared command face on a native button with a scoped name and a press that keeps the focus in the field), `control.module.css` (the one face of the mock's `input`: states are a paint, never a size). |
| `Icon` (outside the owned paths, approved) | `minus` (Int UI `general/remove_dark.svg`), `eye` (`general/show_dark.svg`), `eye-off` (Lucide); `glyphs.test.ts` names list and budget (16,300), `Icon.examples.tsx`. |

Generated by `refresh`: `src/index.ts`, `src/generated/examples.ts`, `api/kit.api.md`.

## Decisions and deviations (for the lead)

1. **`Field` owns `disabledReason` and `readOnly` and prints the reason in its lane.** The mock's `H.field` has neither; its `H.settingRow` does (`core.js:662`), and the model's `lock.reason` is also the lane's message, so one prop locks the control and says why (a reason that the lane would not print is described by the control itself). The controls take the same props for use without a Field.
2. **`SecretInput`: "Set" and not the mock's "Saved · hidden"**, as the assignment words it; the input is always there (a read-only face) and Replace unlocks it, so the label's `for`, the focus and the DOM never change under the user. The mock has no Replace; the Show button of the mock (disabled "A saved secret is never shown again.") is not drawn.
3. **The number field's width is the mock's accident made explicit**: 180 px (`calc(180px * var(--ov-text-scale))`), the default width of its input in both engines (`core.js:1028` leaves it to the input's intrinsic width).
4. **A read-only switch is painted as an enabled one** (F-4: a fact stays legible; only the cursor and hover say it cannot change) with `aria-readonly`; the mock paints it `aria-disabled` (`core.js:188`). An unavailable number field paints like the mock's group (inline fill, quiet edge, dimmed text).
5. **Not built:** the mock's collapse of `.field` to one track below 760 px of VIEWPORT (`base.css:2077`): a part must not answer to the window; the form layout step should do it by container. `labelHidden`, multiline text, the Settings row (title, description, reset slot, the lane's 20 px gutter): the form layout.
6. **The stepper's two buttons are not tab stops** (one stop per number, `14:109` P6, the mock's `oneStop`), an exception to decision A14 for a composite widget; Decrease and Increase are pointer shortcuts and the arrows are the keyboard's.
7. **Mock defect for the errata (N10):** `cat-globalb.js:14` injects `.setting-row__control :is(select,.inp){min-width:180px}` into every page, so the settings select measures 180 px although `shell-page-settings.css:48` says 200 px. The reference for the select must be measured outside `.setting-row__control`.
8. The kit's tests have no jest-dom (`toHaveAccessibleName` fails): the new tests read the DOM directly.

## Backend catalog

None found.

## Verification

Run in the worktree (not under timing; the machine's load average was 20 to 44):

- `pnpm --filter @omniviewdev/kit run verify` (generate:check, tsc, stylelint, 97 test files and 2,611 tests, build, API report): exit 0. It holds the vocabulary guard of decision A13 (`eslint/vocabulary.test.mjs`).
- `pnpm exec eslint` over the new directories and `Icon` with `--report-unused-disable-directives`: 0 errors, after `--fix` (quote and blank-line style).
- `pnpm exec vitest run ui-next/parts`: 5 pass (the parts page renders every new example; every button has a name from its own markup, no `title`).
- No browser was opened for the new parts.

## What is left (in this order)

1. **The kit probe section and its controls.** The shard table is full (shards 1, 3, 4, 5, 6 and 7 are at 424 to 432 of the 432 s limit; shard 8 has 56 s, shard 9 51 s, shard 2 37 s), so the section does not belong in `kit-probe.mjs` (shard 4, 424 s): make `packages/kit/probes/form-probe.mjs` (its own unit, at most 56 s with its controls, else the probe in shard 8 and its controls in shard 9), `mock-form-measure.mjs` and `mock-form.json` (the mock's helpers rendered into a stage as `mock-measure-bc.mjs` does, the mock served by a CommonJS copy of its `server.js`, 1440 x 900 and 1280 x 800, both engines): the face of an input, the lane in each kind, the switch, the stepper (the group is 260.66 x 28 for `11 px`, the field 180 px), the select (200 px), the secret; the tokens of every state in the nine themes; counts; the keyboard with real key presses; the accessibility tree and axe; no write at the root. Controls (each must trip its own assertion and pass undetected with it removed, rule 28): a lane that moves the control, a face that is 1 px taller, a switch track off by 2 px, a stepper wider than the mock's, a secret value in an attribute, a label that is not `for` its control. Add the probe and its controls to `scripts/ci/probe-shards.mjs` with seconds in `MEASURED_SECONDS` (an estimate until a run has the runner's).
2. Screenshots (WebKit, Void and Light, 1440 x 900: the parts page's examples grid) beside the mock's settings form (`?page=host/settings&item=editor`, `telemetry` with `Shell.settings.set('developer.enabled', true)`) into `/Users/joshuapare/Notes/omniview/ui-migration/status/FM2a-assets/` (folder `omniview`).
3. The other probes that read the parts page, with `FONT_DELAY_MS=40` and `uptime` recorded (kit, kit-bc, table, fonts, tooltip, row menu, log): the new examples add controls and one `aria-expanded`-free, `[aria-pressed]` toggle to the page.
4. Rebase onto `origin/main` just before the one push (the glyph files overlap with `ui-next/o1b2-notice-centre`), regenerate, `verify` again, ONE commit, open the PR, handle every CodeRabbit comment in its thread, the full root `pnpm test`, `pnpm lint`, both tsc projects, the seam check.

## Dev tools

- The mock was served from a CommonJS copy of its `server.js` with `root` set to the mock directory (`sed "s#const root=__dirname#const root='<mock>'#" server.js > mock-server.cjs; PORT=49231 node mock-server.cjs`); small Playwright scripts that screenshot or measure its settings page lived in `/tmp/fm2a/` and were not kept.
