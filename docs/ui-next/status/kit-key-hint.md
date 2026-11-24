# Shared keyboard hints

Worktree: `/tmp/ov-kit-follow-b` · Branch: `feat/kit-key-hint`

## Scope

`KeyHint` presents a shortcut already owned by its caller. It renders native `kbd` text, with optional spoken words for glyphs and an optional adjacent action label. It does not detect the platform, format chords, bind keys, or set `aria-keyshortcuts`. It inherits type and color. The label and chord share a baseline and a 4 px gap, without a keycap. Only the chord is isolated left to right; the pair follows the surrounding direction.

- The top-row Search button keeps its 13 px hint, tooltip, platform-specific name and `aria-keyshortcuts`. The palette keeps its 12 px hints, row names, conditional action labels and refusal text. These are the shipped uses in `ui-next`.
- Menu uses the same part for shortcuts and visual action hints. Its row keeps the accessible description, including spoken key names. Its hidden width reservation still prevents the active hint line from shifting the menu. Menu examples are not shipped-use evidence.
- The legacy `ui/` and the native menu are unchanged.

## Verification

Run from the worktree root. Regenerate the kit entry and examples before checking app consumers, which use the built kit.

```sh
pnpm --filter @omniviewdev/kit run refresh
pnpm --filter @omniviewdev/kit exec vitest run src/components/KeyHint/KeyHint.test.tsx src/components/Menu/MenuHost.test.tsx
pnpm exec vitest run ui-next/shell/palette/Search.test.tsx ui-next/shell/palette/Palette.test.tsx
pnpm --filter @omniviewdev/kit exec stylelint --config stylelint.config.mjs src/components/KeyHint/KeyHint.module.css src/components/Menu/Menu.module.css ../../ui-next/shell/palette/Search.module.css ../../ui-next/shell/palette/Palette.module.css
FONT_DELAY_MS=40 SECTIONS=geometry,keyboard,states ENGINES=webkit,chromium VIEWPORTS=1440x900,1280x800 node ui-next/shell/probes/palette-probe.mjs
FONT_DELAY_MS=40 SECTIONS=geometry PLATFORM='Linux x86_64' ENGINES=webkit,chromium VIEWPORTS=1440x900,1280x800 node ui-next/shell/probes/palette-probe.mjs
```

The palette probe compares against the pinned mock for Search and footer size and paint, footer spacing, and row column placement. Its reports record platform-dependent glyph widths rather than requiring equal widths.

For Go-host browser proof, build with `GOWORK=off OMNIVIEW_UI=next task build:server`, then run `ENGINES=webkit,chromium node ui-next/plugins/e2e/seam.check.mjs`. The command palette scenario opens Search, types `>`, and checks the **Close tab** command and its display shortcut in the accessible row name. This is not native WKWebView proof.

## Dev tools

`/?screen=parts&part=KeyHint` shows a bare shortcut, a glyph with spoken words and action, and a right-to-left action label. Start the gallery with `OMNIVIEW_UI=next pnpm dev`.

[Gallery screenshot](kit-key-hint-evidence/gallery-webkit.png) · [browser observations](kit-key-hint-evidence/browser.json). The three example subtrees had no DOM mutations over 60 animation frames in either browser at either viewport. Frame intervals are whole-page observations, not component render timings. Kit verification, the palette unit suite and the geometry, keyboard and state browser checks passed locally.
