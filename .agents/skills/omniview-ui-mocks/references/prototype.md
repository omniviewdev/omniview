# Single-file interactive prototype

One `index.html` (+ generated `icons.js`), no build step, loadable from `file://` or `python3 -m http.server`. It is a behavior proposal, not a picture: every screenshot must come from driving it.

## Architecture

- **CSS variables** at `:root` for sampled colors, base-ui radius/duration/ease values and real layout sizes; the app's font stack and 13px base size.
- **State machine** in plain JS (`state` object: windows, tabs, menu, palette, held modifiers). Render functions read state only.
- **Two roots:** the shell renders into `#main`; overlays (menus, tooltips, palette) render into a separate `#layer` above it. Re-rendering the shell then never restarts overlay animations.
- **Class toggles for fast updates:** moving a highlight or showing a modifier hint toggles classes on existing nodes; do not re-render the overlay (it would replay its entry animation).
- **Real input:** one `keydown` handler for Cmd/Ctrl shortcuts, arrows, Home/End, type-ahead, Enter, Esc; mouse handlers read `e.shiftKey`/`e.metaKey`/`e.ctrlKey`; middle click via `auxclick` (`e.button === 1`); `keydown`/`keyup` sync held-modifier hints. Close overlays on outside `mousedown`. Restore focus on close.
- **URL params for variants:** e.g. `?layout=current` (today's layout for before/after), `?plugins=kubernetes` (single-plugin path), `?platform=linux` (Ctrl labels instead of ⌘). Each variant is a URL, so captures are reproducible.
- **Realistic data:** plausible cluster/context names, events, nodes and counts so screenshots read like the app. Only list what the real app would list ([grounding](grounding.md#check-existing-rules-before-inventing-lists)).
- **Animations** as CSS keyframes using the token durations/easing; honor `prefers-reduced-motion`.
- **Drop-down reveal:** animate `clip-path` from `inset(-40px -40px calc(100% - 12px) -40px round 10px)` to `inset(-40px -40px -40px -40px round 10px)` with a small `translateY`. The negative insets keep the box-shadow unclipped. A plain opacity/scale fade read as a flash, not a menu opening.
- **Test hook:** `window.__mock = { freezeAt(ms), state }`; `freezeAt` pauses every `document.getAnimations()` and sets `currentTime`, giving deterministic mid-animation frames.

## Skeleton

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Omniview mock: TOPIC</title>
<script src="icons.js"></script>
<style>
:root {
  --content-bg: #0e0f11; --chrome-bg: #141517; --border: #343840; /* sampled */
  --fg: #cccccc; --muted: #9d9d9d; --accent: #89a7ee;
  --ease: cubic-bezier(0.2, 0, 0, 1); --duration-panel: 160ms;      /* base-ui tokens */
  --header-h: 38px; --status-h: 24px; --rail-w: 48px;                /* WorkspaceShell */
  font: 13px -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; color: var(--fg);
}
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--content-bg); }
#layer { position: absolute; inset: 0; pointer-events: none; }
#layer > * { pointer-events: auto; }
.menu { position: absolute; animation: drop var(--duration-panel) var(--ease) both; }
@keyframes drop {
  from { opacity: 0; transform: translateY(-4px); clip-path: inset(-40px -40px calc(100% - 12px) -40px round 10px); }
  to { opacity: 1; transform: none; clip-path: inset(-40px -40px -40px -40px round 10px); }
}
.row.active { background: rgb(90 127 226 / 0.22); }
body.shift .hint-shift { display: inline; }
@media (prefers-reduced-motion: reduce) { * { animation-duration: 1ms !important; } }
</style></head>
<body><div id="main"></div><div id="layer"></div>
<script>
'use strict';
const params = new URLSearchParams(location.search);
const LAYOUT = params.get('layout') || 'proposed';          // 'current' = today's layout
const MAC = params.get('platform') !== 'linux';
const icon = (name, size = 16) => `<span class="ic" style="width:${size}px;height:${size}px">${ICONS[name]}</span>`;
const state = { tabs: [], menu: null };

function renderMain() { /* shell only: header, tabs, content, status; reads state */ }
function openMenu() {
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = ITEMS.map((it, i) => `<div class="row" data-i="${i}">${icon(it.icon)} ${it.name}</div>`).join('');
  document.getElementById('layer').append(el);
  state.menu = { el, index: 0 };
  highlight(0);
}
function highlight(i) {                                      // class toggle, no re-render
  state.menu.index = i;
  state.menu.el.querySelectorAll('.row').forEach((r, j) => r.classList.toggle('active', j === i));
}
function syncModifiers(e) { document.body.classList.toggle('shift', e.shiftKey); }
window.addEventListener('keydown', (e) => {
  syncModifiers(e);
  const mod = MAC ? e.metaKey : e.ctrlKey;
  if (mod && e.key.toLowerCase() === 't') { e.preventDefault(); openMenu(); return; }
  if (state.menu && e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(state.menu.index + 1, ITEMS.length - 1)); }
});
window.addEventListener('keyup', syncModifiers);
window.__mock = {
  freezeAt(ms) { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } },
  state,
};
renderMain();
</script></body></html>
```

`ITEMS` and the shell rendering are omitted. The published new-tab launcher proposal ([omniviewdev/omniview#226](https://github.com/omniviewdev/omniview/issues/226)) shows the result this structure produced.
