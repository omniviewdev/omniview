# Visual sizing trial

## Reference and diagnosis

The supplied reference screenshots favor quiet dark surfaces, rounded floating panels, a clear selected row, and secondary metadata. Omniview's supplied screenshots show small navigation, resource rows, search controls, and inspector text. Screenshot pixels alone do not establish CSS sizes or device scale.

Source inspection establishes that the host explicitly selects compact density. Base UI already provides compact and comfortable density tokens, a 14px body token, 12px caption token, and normal/reduced motion state. Comfortable medium controls are 36px; compact medium controls are 30px. Reuse these contracts rather than introduce a second density system.

Browser inspection also found compounded rem sizing: a nominal 14px body token resolved to 12.25px, and a nominal 13px table token resolved to 11.375px. The trial keeps the 14px root-rem layout baseline at the browser's default 16px font, but calibrates UI font primitives against that baseline and applies text scaling independently. At 100%, body text resolves to 14px without zooming layout geometry; larger browser font defaults remain respected.

## Trial plan

1. Expose persistent appearance preferences for density, independent UI text sizing, and motion. Comfortable becomes the default. Compact remains available. System motion follows the OS preference live; an explicit reduced setting must also work.
2. Reuse existing Base UI density and motion contracts. Audit components that pin small sizes or bypass shared tokens. Keep virtualization geometry consistent with rendered rows.
3. Improve command palette hierarchy through a more prominent search input, readable results and keyboard hints, restrained surfaces, and consistent spacing. Preserve scope editing, search behavior, and keyboard controls.
4. Do not scale code editors, terminals, or the entire application with CSS zoom. Text sizing and density must be independent.
5. Capture browser evidence at 1568 × 864: palette, appearance preferences, resource list, and inspector where real data is available. Include compact/comfortable and larger text cases, keyboard selection, overflow, and reduced-motion checks.
6. Launch the same workspace natively for review only after browser verification.

## Mock direction

The conversation includes resource-list/inspector and command-palette SVG mocks. They establish hierarchy, not verified runtime output. Proposed palette: prominent single search entry, retained scope chip, generous result hit targets, clear selected surface, and legible shortcut footer. Repeated category labels may be reduced only where context remains clear; this trial does not redesign result grouping.

## Evidence

Workspace: `visual-sizing-20261102`, UUID `9fec3990-e8b3-4b0a-98a2-91ca1a4c1ec8`. Sources are isolated CLI-managed worktrees under `workspaces/workspaces/visual-sizing-20261102`. The SDK uses the existing independently reviewed baseline `9f007a79cf63a64eac9df7cb88bbbaf3120b9f08`; the stale cohort SDK pin did not descend from that baseline and was rejected before launch.

Browser captures in [evidence/visual-sizing](evidence/visual-sizing) use a 1568 × 864 CSS viewport and device scale factor 1:

- [Palette mock](evidence/visual-sizing/palette-mock.svg), explicitly labeled as a proposal.
- `resources-{compact,comfortable}-{100,110,125}.png`: same local kind-kind cluster, 13 existing pods. No resource writes.
- `palette-{compact,comfortable}-{100,110,125}.png`: real connection-scoped results.
- [Appearance controls](evidence/visual-sizing/appearance-preferences.png).
- [Inspector, 100%](evidence/visual-sizing/inspector-comfortable-100.png) and [125%](evidence/visual-sizing/inspector-comfortable-125.png).

Measured body font sizes: 14px, 15.4px, and 17.5px. Fixed virtual table rows are 30px compact and 36px comfortable; the same value drives rendering and virtualization. Navigation rows measure 28px compact and 30px comfortable. All six list scenarios had zero document horizontal overflow. The inspector handles existing long resource names through its current truncation and scroll behavior.

Exercised actual settings selection and Save Changes, cross-document propagation, restoration after reload, ArrowDown active-result selection, and Tab exploration from Pod results into a resource-type scope. Explicit reduced motion yielded zero running document animations and a 0ms panel duration. Changing the emulated system preference updated resolved motion live in both directions.

Checks passed: host appearance settings Go tests; four host theme/settings Vitest files (25 tests); Base UI suite (147 files, 1,679 tests); host and Base UI TypeScript checks. CSS font correction was verified in the running browser after the unit checks.

The managed CLI refused rebuilds after checks with `owned generated tree changed: $WORKSPACE/node_modules`. This usability issue was recorded. Recovery used `workspace down`, `workspace reset-modules`, and `workspace recover`; no ownership ledger was edited. Recovery restored the browser host and selected plugin.

At this earlier stage, native launch succeeded through `workspace up --mode native`. The actual macOS window was resized to 1568 × 864, connected to local kind-kind, and rendered the 13-pod list. Cmd+K opened the palette in the native webview. [Native resource screenshot](evidence/visual-sizing/native-review.png) and [native palette screenshot](evidence/visual-sizing/native-palette.png) capture those surfaces. That original workspace has since been stopped; the release-cohort workspace below replaces it.

Open [the visual review gallery](evidence/visual-sizing/review.html) for the mock and density/text-size comparisons. Browser and native rendering were both inspected; no full native preference matrix or production-cluster operation is claimed.

## Smaller sizes and native menu controls

Appearance now offers plain `80%`, `90%`, `100%`, `110%`, and `125%` labels. There is no “Default” suffix. These percentages size UI text, not the entire webview; density, code editors, and terminal fonts remain independent.

The native application menu exposes **View → Zoom In / Zoom Out / Reset Zoom**, with Cmd/Ctrl+Plus, Minus, and 0 accelerators. Each menu action emits only to the focused window, using the same saved `appearance.textSize` preference as Settings. Bottom status-bar sizing controls and their context API were removed. Browser keyboard handling remains available; its direct document listener leaves editor and terminal targets alone. At sizing boundaries, further changes are no-ops. Pending saves suppress duplicate actions; rejected saves retain the saved value and report an error.

The real browser host received backend-emitted menu events and traversed 100 → 90 → 80 → 90 → 100 → 110 → 125 → 100. Browser keyboard decrease/reset and restoration after reload also passed. Updated 1568 × 864 screenshots show smaller sizing with no footer sizing buttons. At 80%, body text measures 11.2px and webview scale remains 1. Settings still offers the same five plain percentage choices.

Evidence: [native View menu mock](evidence/visual-sizing/sizing-controls-mock.svg), [80% with no footer controls](evidence/visual-sizing/sizing-controls-80.png), [90%](evidence/visual-sizing/sizing-controls-90.png), [100%](evidence/visual-sizing/sizing-controls-100.png), and [Appearance settings](evidence/visual-sizing/appearance-preferences.png). The menu illustration is a mock, not a screenshot.

Checks passed after the menu cutover: native menu package compilation, four host zoom/theme/preference test files (26 tests), and host TypeScript. The obsolete footer-button test was removed; the keyboard input-preservation regression remains.

Native menu clicking and menu-bar screenshot automation remain limited by the previously observed macOS assistive-access and window-capture failures. Backend event smoke proves the frontend menu action path and persistence, not an OS menu click. Earlier native screenshots above cover the preceding sizing trial.

At that stage, the menu cutover was relaunched through `workspace up --mode native --watch=false`; its owned native generation reported `launchPhase: ready`. Current native review uses the release-cohort workspace below.

## Proportional inspector, Settings, and log controls

The supplied follow-up screenshots exposed fixed rem and pixel fonts beside larger controls. A second concrete bug appeared in the real browser: tooltip-wrapped Exec and Logs menu triggers rendered as medium soft buttons, overriding the small ghost IconButtons supplied by the inspector. The shared Tooltip.Trigger now leaves custom-render styling alone unless the caller explicitly overrides it. The regression test exercises the nested tooltip/menu/button composition and actual menu opening. Tooltip popup styling and ordinary trigger behavior remain intact.

Inspector heading actions reuse the existing card-action height tier; no new size system or global button enlargement was introduced. Close and other inactive actions use ghost styling. Labels and tabs use text tokens, metadata and detail values no longer pin pixel fonts, and graph labels scale with their complete SVG scene. Settings' left title, search, and navigation now use typography tokens; its navigation explicitly follows the host density instead of NavList's compact default. The approved main Settings heading and selection fields were left unchanged.

Measured comfortable-density values:

| Element | 100% text | 125% text |
| --- | ---: | ---: |
| Inspector action height | 24px | 24px |
| Inspector action icon | 14px | 17.5px |
| Inspector title/tab text | 13px | 16.25px |
| Settings sidebar title | 16px | 20px |
| Settings search text | 14px | 17.5px |
| Settings navigation text | 13px | 16.25px |
| Graph scene width | 472px | 590px |
| Graph scene height | 118px | 147.5px |

The oversized Exec/Logs controls previously measured 36px at 100%. All inspector actions now use the same heading tier. Compact action height is 22px. This keeps text sizing independent of density without leaving action controls disproportionately large.

The log toolbar groups search, filters, display, playback, and export controls with token-based spacing. Inactive actions use ghost styling; selected toggles, active filters, and an open jump-to-time control use soft styling and expose aria-pressed. Search and injected actions share the compact heading-action tier. Icons use the scaled 14px primitive. Search and match-navigation controls stay together; toolbar groups wrap as units on narrower surfaces rather than clipping. At 600px width and 125% text, no document horizontal overflow or clipped toolbar buttons was observed.

Browser smoke exercised Exec menu opening without executing a command, graph sizing, Settings search, persisted text/density selection, log timestamps soft/pressed state, pause/resume, the container filter, jump-to-time opening, and zero-match search/Escape behavior. The log surface remained in its existing connection-waiting state with zero lines; this is control/layout evidence, not proof of log transport, copy contents, or downloaded data. No cluster resources were changed. Review preferences were restored to comfortable density and 100% text.

The [updated gallery](evidence/visual-sizing/review.html) places the latest mock, observed tooltip regression baseline, and matched inspector/Settings/log/graph captures first. Main-window captures use 1568 × 864; Settings uses 1040 × 640; the narrow log capture uses 600 × 864, all at device scale 1. Compact and comfortable controls were exercised at both 100% and 125%.

Checks passed: shared Base UI suite (147 files / 1,682 tests), host inspector/log/Settings tests (4 files / 54 tests), plugin graph/KVCard tests (2 files / 8 tests), host/plugin/Base UI typechecks, and a final Settings rerun (2 files / 27 tests) plus host typecheck after density wiring. The known managed dependency-tree ownership refusal recurred after the shared suite; managed reset-modules and a fresh launch repaired the test-generated state without ledger edits.

## Joined Debug and Settings follow-up

The inspector now renders `DrawerComponentAction.splitMenu` through the existing shared SplitButton. Debug's primary action retains direct single-target behavior and multi-target selection. Its arrow always opens Debug options as a menu, including with one target. Both halves share joined corners, the existing 24px comfortable / 22px compact heading tier, and a subtle divider. Following review, the initial soft surface was changed to ghost styling to match neighboring actions, with shared hover feedback rather than a persistent box. The shared dropdown supports an independent disabled state. Resource row-menu Debug options remain available.

A split descriptor without a primary action or primary list now disables its primary button rather than exposing a silent no-op. Its separate options menu remains usable. The regression first failed on the enabled primary and verifies both states independently.

Cluster Settings was already using NavList but forced small sizing and omitted the host density. It now uses the same scalable 13px labels, density, minimum row-height token, and section spacing as host Settings. Its title uses the 16px token with room for back/save/discard controls. At 100%, measured rows are 34px comfortable and 28px compact; at 125%, comfortable rows remain 34px and compact rows naturally grow to 28.3125px to fit text. Click and keyboard navigation preserved an unsaved description, which was then discarded without saving.

The Settings sidebar caption now has a 56px minimum height and 16px vertical padding; it naturally grows to 58px at 125% text. The title size is unchanged from the prior pass. The small dropdowns in the supplied Editor screenshot were generic native selects, not Base UI Select. Generic option editors now use the shared Select, preserving original option values and draft/validation behavior. Numeric/text fields use the same existing medium height and typography tier. Measured select and numeric-field heights match: 36px comfortable / 30px compact, at both 100% and 125% text. No global dropdown token increase was needed; toolbar dropdown sizing remains unchanged.

Browser smoke opened single- and multi-target Debug menus, opened and cancelled the real Debug options dialog, verified native-terminal picker keyboard selection and discarded that draft, exercised cluster list click/keyboard selection and description draft preservation/discard, saved and restored density/text preferences through the migrated selects, and inspected the field/navigation matrix. No Start Debug or cluster save action was invoked. Main captures use 1568 × 864 and Settings captures 1040 × 640, at device scale 1. Mocks and captures are linked at the top of the gallery.

Checks passed: host Settings and drawer actions (8 files / 77 tests), plugin cluster Settings and resource actions (2 files / 76 tests), shared Select and SplitButton (2 files / 17 tests), and host/plugin/Base UI typechecks. Existing appearance commit tests now drive real Select interactions instead of native change events. The native-terminal keyboard test waits for its real option focus handoff before sending selection keys.

Separate pre-existing finding: editing a spaced display name can crash `getInitials` in `kubernetes/ui/src/utils/avatarUtils.ts` while a word is incomplete. Browser smoke recovered the plugin and exercised navigation drafts through Description instead. No name override was saved. The avatar parsing function is unchanged by this visual work.

## Quiet split control and isolated avatar fix

The latest mock and captures show idle ghost styling, shared hover feedback, and the open Debug options menu. At both 100% and 125%, comfortable action heights remain 24px; icons measure 14px and 17.5px respectively. Both button backgrounds and outer borders are transparent at rest. The shared ghost group hover uses `--ov-color-state-hover` (observed `rgba(160, 165, 175, 0.08)` in this theme). Menu behavior is unchanged. Appearance preferences were restored after verification.

The avatar crash was fixed and merged separately in [Kubernetes PR #134](https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/134). Its parser passed 15 regression cases (9 failed before), direct Node smoke, and a focused TypeScript check. The standalone CI repair pinned the compatible published runtime/Vite cohort. The Kubernetes sizing branch now includes that merged fix through its normal main-branch rebase.

## Release-cohort verification

Base UI 0.12.0, ai-ui 6.1.6, and editors 6.1.6 are published. The host pins that cohort and the corresponding reviewed UI source commit. Runtime shims are regenerated from the stock runtime build, followed by the Vite plugin build.

A clean CLI-created browser workspace reproduced an additional accessibility sizing mismatch with Chromium's actual default font set to 20px, compact density, and 125% UI text: numeric fields grew to 34.375px while selects remained 30px. Shared medium height/font/inline-padding tokens now keep both at 30px. Textareas retain their multiline padding. File-picker buttons use the same medium tier.

Settings descriptions, developer keys, and inherited window text now use scalable typography tokens instead of fixed pixel sizes. At that larger browser preference, descriptions measure 17.1875px and status text 18.75px. The root remains 17.5px, preserving browser preferences without multiplying the UI text scale twice. Normal browser-font captures also cover comfortable 100% and compact 125%. The gallery links the existing control mock and matched before/after screenshots.

Final-cohort browser smoke loaded the existing kind-kind Pods and opened/dismissed the single-target Debug menu without starting Debug. Exec, Logs, Debug, and the arrow all measured 24px with transparent idle backgrounds and outer borders. Cmd-minus stepped 100% → 90% → 80%, stayed at the lower bound, and Cmd-0 restored 100%. Preferences ended at comfortable 100%; no cluster writes were made.

Stock checks passed: 1,436 host tests, 392 runtime tests with the freshly generated real Go transport corpus, host lint with zero errors and 11 existing warnings, generated bindings verification, and production frontend build. Backend verification covered the full Go suite, then registry/settings tests after the compatibility baseline update. Production macOS metadata and compiler targets now agree on the Go-supported macOS 12 minimum; a built binary reports `minos 12.0`.

The repository's independently approved SDK advanced during release preparation. Both host and plugin now pin public SDK `v0.14.4-0.20261103022722-1712cd3b66e1`, matching approval SHA `1712cd3b66e14b1807cf17fbb59f48512875c822`; no approval variable or admission guard changed. The full host Go suite passed with the actual child fixture selecting that same public module, avoiding an unrelated stale generated hostmod. Binding freshness, the new real transport corpus, 392 runtime tests, production Go build, and the plugin's public-module tests/build passed.

Native review: `sizing-review-20261103`, created through the CLI from rebased host `297148967`, UI `5af0ec923a605aba5e6e3571d639f6238095804c`, Kubernetes `e726db6`, and the approved SDK. Older native snapshots are stopped. Authenticated Wails MCP exercised the actual WKWebView Settings surface: at comfortable density, input/select heights both remain 36px; their fonts change from 13px to 16.25px at 125%, search text from 14px to 17.5px, and the root remains 14px. Reset restored 100%.

Those native keyboard events exercised embedded DOM handlers, not OS accelerators. No new native pixel screenshot or OS menu click is claimed. MCP window metadata reported visible/focused false despite the live webview; on-screen visibility remains unconfirmed. Browser pixel captures remain the matched visual evidence.

Canonical CI passed the complete application E2E path after its Settings helper switched from native `selectOption()` to accessible shared-option clicks. Final review also added the macOS 12 eligibility gate to stable/nightly cask publication; 25 Ruby-consumer eligibility cases and the real updater CLI/Ruby syntax smoke passed. No public tap or release artifact was changed by that smoke.
