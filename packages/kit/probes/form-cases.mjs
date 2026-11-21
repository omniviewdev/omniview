// The cases the form probe compares the kit's form parts with, in ONE table that the mock's measurement (mock-form-measure.mjs) and the probe
// (form-probe.mjs) both read, so that what is measured in the mock and what is measured in the kit cannot drift apart. A case is a mock
// expression (the mock's own helpers: H.field, H.switch, H.stepper, H.select, or the markup of its secret) staged in a neutral box, and the kit
// example that draws the same thing; each is measured at rest (and in the states the case names, with real focus) and by parts: the rectangle of
// a part inside the case's root, and the paint of each.
//
// Rectangles are the mock's, to half a pixel in y and in height and a pixel in x and in width; every string (colour, border, padding, font,
// outline) must be equal. What differs on purpose is in `skip` (a part of a case) with its reason beside it.
const J = JSON.stringify;

export const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';

/** The themes of the parity runs: the kit's id, and the value of the mock's `data-theme` (none for Void). The nine themes are checked by token in the probe. */
export const THEMES = { void: { mock: null, kit: 'void' }, light: { mock: 'light', kit: 'light' } };

/** Page side (self-contained: it runs in the browser): the rectangle (relative to the root) and the paint of each part of a case. */
export function readCase({ root, parts }) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const base = document.querySelector(root);
  if (base === null) throw new Error(`no element for ${root}`);
  const origin = base.getBoundingClientRect();
  const out = {};
  for (const [name, spec] of Object.entries(parts)) {
    const selector = typeof spec === 'string' ? spec : spec.selector;
    const el = selector === ':self' ? base : base.querySelector(selector);
    if (el === null) {
      out[name] = null;
      continue;
    }

    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const node = {
      r: [r2(b.left - origin.left), r2(b.top - origin.top), r2(b.width), r2(b.height)],
      color: cs.color,
      bg: cs.backgroundColor,
      border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      radius: cs.borderTopLeftRadius,
      pad: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight} ${/mono/i.test(cs.fontFamily) ? 'code' : 'ui'}`,
      outline: cs.outlineStyle === 'none' ? 'none' : `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
    };
    if (el.hasAttribute('placeholder')) node.placeholder = el.getAttribute('placeholder');
    for (const pseudo of typeof spec === 'object' ? (spec.pseudo ?? []) : []) {
      const ps = getComputedStyle(el, pseudo);
      node[pseudo] = { w: ps.width, h: ps.height, left: ps.left, top: ps.top, bg: ps.backgroundColor, transform: ps.transform, radius: ps.borderTopLeftRadius };
    }

    out[name] = node;
  }

  return out;
}

/** The differences between a part of the mock (`want`) and of the kit (`got`), as strings: x and width within a pixel, y and height within half one, the rest exactly. */
export function differences(want, got, skip = []) {
  if (want === null || got === null || want === undefined || got === undefined) return want === got ? [] : [`present: mock ${want !== null && want !== undefined} kit ${got !== null && got !== undefined}`];
  const out = [];
  const tolerance = { x: 1, y: 0.5, w: 1, h: 0.5 };
  ['x', 'y', 'w', 'h'].forEach((key, index) => {
    if (!skip.includes(key) && Math.abs(want.r[index] - got.r[index]) > tolerance[key]) out.push(`${key}: mock ${want.r[index]} kit ${got.r[index]}`);
  });
  for (const key of ['color', 'bg', 'border', 'radius', 'pad', 'font', 'outline', 'placeholder']) {
    if (!skip.includes(key) && want[key] !== got[key]) out.push(`${key}: mock ${J(want[key])} kit ${J(got[key])}`);
  }

  for (const pseudo of ['::after', '::before']) {
    if (want[pseudo] === undefined && got[pseudo] === undefined) continue;
    for (const key of ['w', 'h', 'left', 'top', 'bg', 'transform', 'radius']) {
      if (J(want[pseudo]?.[key]) !== J(got[pseudo]?.[key])) out.push(`${pseudo} ${key}: mock ${J(want[pseudo]?.[key])} kit ${J(got[pseudo]?.[key])}`);
    }
  }

  return out;
}

// ---- the mock's expressions -------------------------------------------------------------------------------------------------
const field = (extra) => `H.field(${J({ id: 'probe-field', label: 'Name', layout: 'stacked', validate: true, control: '<input class="inp" value="orders">', ...extra })})`;
const lane = (glyph, extra = {}) => ({
  lane: { mock: '.field__message', kit: '[data-ov-part="lane"]', skip: ['w'] },
  text: { mock: '.field__message-text', kit: '[data-ov-part="message"]' },
  // An icon holder's `font` paints nothing (the mock's `.ic` is a span with line-height 0, the kit's glyph is the svg itself).
  ...(glyph ? { glyph: { mock: '.field__message-icon', kit: '[data-ov-part="lane"] > svg', skip: ['font'] } } : {}),
  ...extra,
});
const select = (options, value, extra) => `H.select('probeSelect', ${J(options)}, ${J(value)}, ${J(extra)})`;
const LEVELS = [{ id: 'error', label: 'Error' }, { id: 'warn', label: 'Warn' }, { id: 'info', label: 'Info' }, { id: 'debug', label: 'Debug' }];
const LANGUAGES = [{ id: 'en', label: 'English' }, { id: 'es', label: 'Español' }, { id: 'de', label: 'Deutsch' }];
const stepper = (value, extra = {}) => `H.stepper(${J(value)}, ${J({ min: 8, max: 32, bind: 'probeNumber', label: 'Font size', unit: 'px', commit: 'reject', oneStop: true, ...extra })})`;
const secret = (placeholder, reason) =>
  `(() => { const eye = H.ibtn('LuEye', '', 'Show Auth value', 'ghost small', { pressed: false, pressedIcon: 'LuEyeOff', disabled: ${J(reason)} }); return '<span class="settings-secret"><input type="password" class="inp inp--mono settings-input settings-input--normal" data-field-primary value="" placeholder="${placeholder}" autocomplete="new-password" autocapitalize="off" spellcheck="false">' + eye + '</span>'; })()`;

// What a case's own element is compared by besides the rectangle and the paints it already has: the font role (code or interface face), which `summarize` does not hold.
const FONT_ONLY = ['x', 'y', 'w', 'h', 'color', 'bg', 'border', 'radius', 'pad', 'outline', 'placeholder'];
const FACE_FONT = { face: { mock: ':self', kit: ':self', skip: FONT_ONLY } };
const FACE = { mockRoot: '#probe-stage > input', kitRoot: 'input', parts: FACE_FONT };
// The switch is a button around its track and paints only the hover wash and the focus ring: its own text colour, border colour, font, gap and white
// space paint nothing (the mock's are the generic button's).
const SWITCH_SKIP = ['color', 'border', 'font', 'gap', 'layout'];
const SWITCH = { mockRoot: '#probe-stage button[role="switch"]', kitRoot: '[role="switch"]', skip: SWITCH_SKIP, parts: { track: { mock: '.sw', kit: '[data-ov-part="track"]', pseudo: ['::after'], skip: ['color', 'border', 'font'] } } };
const FIELD_ROOT = { mockRoot: '#probe-stage .field', kitRoot: '[data-ov-layout]' };
const STEP = { mockRoot: '#probe-stage .stepper', kitRoot: '[data-ov-part="stepper"]' };
const STEP_PARTS = {
  group: ':self',
  dec: { mock: 'button:first-of-type', kit: '[data-ov-slot="decrease"]' },
  input: { mock: 'input', kit: 'input' },
  inc: { mock: 'button:last-of-type', kit: '[data-ov-slot="increase"]' },
};

/**
 * id, the mock's expression (`mock`) and the element it is measured as (`mockRoot`), the kit's example (`kit`) and its element (`kitRoot`, inside the
 * example), `states` (measured with real focus and the pointer: `rest`, `hover`, `focus`), `parts` (mock and kit selectors inside the root, `skip` what
 * differs on purpose), `skip` (what differs on purpose in the root).
 */
export const CASES = [
  // the face of an input (design 04 section 1; base.css 1015 to 1044)
  { id: 'face-rest', mock: '\'<input class="inp" value="https://api.example.test">\'', ...FACE, kit: 'TextInput/Idle', states: ['rest', 'focus'], skip: ['width'] },
  { id: 'face-mono', mock: '\'<input class="inp inp--mono settings-input settings-input--normal" value="collector.example.test:4318">\'', ...FACE, kit: 'TextInput/Mono', states: ['rest', 'focus'] },
  { id: 'face-invalid', mock: '\'<input class="inp" value="bad name" aria-invalid="true">\'', ...FACE, kit: 'TextInput/Invalid', states: ['rest', 'focus'], skip: ['width'] },
  { id: 'face-warning', mock: '\'<input class="inp" value="Orders_2" data-validation="warning">\'', ...FACE, kit: 'Field/LaneWarning', states: ['rest', 'focus'], skip: ['width'] },
  { id: 'face-readonly', mock: '\'<input class="inp" readonly value="">\'', ...FACE, kit: 'TextInput/ReadOnlyNotSupported', states: ['rest'], skip: ['width'] },
  { id: 'face-disabled', mock: '\'<input class="inp inp--mono" readonly aria-disabled="true" value="Authorization">\'', ...FACE, kit: 'TextInput/DisabledWithReason', states: ['rest'], skip: ['width'] },

  // the field: the label, the required mark, the aside, the aligned tracks (base.css 1065 to 1072, 1505 to 1510)
  { id: 'label-required', mock: field({ required: true, control: '<input class="inp" value="">' }), ...FIELD_ROOT, kit: 'Field/Required', parts: { label: { mock: 'label', kit: '[data-ov-part="label"]', skip: ['w'] }, mark: { mock: '.field__required', kit: '[data-ov-part="required"]' } } },
  { id: 'label-aside', mock: field({ aside: 'optional', label: 'Prefix', control: '<input class="inp" value="">' }), ...FIELD_ROOT, kit: 'Field/WithAside', parts: { label: { mock: 'label', kit: '[data-ov-part="label"]', skip: ['w'] }, aside: { mock: '.field__aside', kit: '[data-ov-part="aside"]' } } },
  { id: 'field-aligned', mock: `H.field(${J({ id: 'probe-field', label: 'Name', control: '<input class="inp" value="orders-api">' })})`, ...FIELD_ROOT, kit: 'Field/Aligned', parts: { label: { mock: 'label', kit: '[data-ov-part="label"]' }, control: { mock: 'input', kit: 'input', skip: ['w'] } } },

  // the message lane in each kind (base.css 1516 to 1523; core.js 161 to 187)
  { id: 'lane-error', mock: field({ message: { kind: 'error', text: 'Name is taken. Choose another.' } }), ...FIELD_ROOT, kit: 'Field/LaneError', parts: lane(true) },
  { id: 'lane-warning', mock: field({ message: { kind: 'warning', text: 'Name is unusual. Check it.' } }), ...FIELD_ROOT, kit: 'Field/LaneWarning', parts: lane(true) },
  // The loader turns, so the box of its glyph is not read: its place is the text's (20 px in), which is.
  { id: 'lane-checking', mock: field({ message: { kind: 'checking', text: 'Contacting the server…' } }), ...FIELD_ROOT, kit: 'Field/LaneChecking', parts: lane(false) },
  { id: 'lane-retry', mock: field({ message: { kind: 'retry', action: { label: 'Retry', action: 'noop:retry' } } }), ...FIELD_ROOT, kit: 'Field/LaneCouldNotCheck', parts: lane(true, { retry: { mock: '.field__message .linkbtn', kit: '[data-ov-part="lane"] button' } }) },
  { id: 'lane-saved', mock: field({ message: { kind: 'success' } }), ...FIELD_ROOT, kit: 'Field/LaneSaved', parts: lane(true) },
  { id: 'lane-info', mock: field({ message: { kind: 'info', text: 'Restart required to apply.' } }), ...FIELD_ROOT, kit: 'Field/LaneInfo', parts: lane(true) },
  { id: 'lane-hint', mock: field({ hint: 'Letters and digits.' }), ...FIELD_ROOT, kit: 'Field/LaneHint', parts: lane(false) },

  // the switch (base.css 1148 to 1159, 1674 to 1677; core.js 963)
  { id: 'switch-off', mock: 'H.switch(false, \'\', \'Folding\')', ...SWITCH, kit: 'Toggle/Idle', states: ['rest', 'hover', 'focus'] },
  { id: 'switch-on', mock: 'H.switch(true, \'\', \'Folding\')', ...SWITCH, kit: 'Toggle/On', states: ['rest', 'hover', 'focus'] },
  // The mock fills a disabled button with the island colour (its generic disabled-button rule): that paints nothing on an island and a box on any other surface, so the kit leaves it clear.
  { id: 'switch-disabled-on', mock: 'H.switch(true, \'\', \'Traces\', { disabled: \'Why\' })', ...SWITCH, skip: [...SWITCH_SKIP, 'bg'], kit: 'Toggle/DisabledWithReason', states: ['rest', 'hover'] },
  // A read-only switch is painted and exposed as an unavailable one (the mock's `lockControls`, core.js 188).
  { id: 'switch-disabled-off', mock: 'H.switch(false, \'\', \'Mirror\', { disabled: \'Why\' })', ...SWITCH, skip: [...SWITCH_SKIP, 'bg'], kit: 'Toggle/ReadOnlyNotSupported', states: ['rest', 'hover'] },

  // the number field (base.css 1802 to 1819; core.js 1025 to 1044)
  { id: 'stepper', mock: stepper('11'), ...STEP, kit: 'NumberInput/Idle', parts: { ...STEP_PARTS, unit: { mock: '.inp-group__affix', kit: '[data-ov-part="unit"]' }, decIcon: { mock: 'button:first-of-type svg', kit: '[data-ov-slot="decrease"] svg', skip: ['font'] } } },
  { id: 'stepper-minimum', mock: stepper('8'), ...STEP, kit: 'NumberInput/AtTheMinimum', parts: { ...STEP_PARTS, decIcon: { mock: 'button:first-of-type svg', kit: '[data-ov-slot="decrease"] svg', skip: ['font'] }, incIcon: { mock: 'button:last-of-type svg', kit: '[data-ov-slot="increase"] svg', skip: ['font'] } } },
  // The group's own text colour paints nothing: the dimming is on the field, which is compared (the mock dims the field, the kit sets it on the group and the field takes it).
  { id: 'stepper-disabled', mock: stepper('11', { disabled: 'Start the plugin to change this.' }), ...STEP, kit: 'NumberInput/DisabledWithReason', parts: { ...STEP_PARTS, group: { mock: ':self', kit: ':self', skip: ['color'] }, decIcon: { mock: 'button:first-of-type svg', kit: '[data-ov-slot="decrease"] svg', skip: ['font'] } } },

  // the select (base.css 1046 to 1055; shell-page-settings.css 48; core.js 1139)
  { id: 'select-mono', mock: select(LEVELS, 'info', { label: 'Level', cls: 'settings-select inp--mono' }), mockRoot: '#probe-stage select', kitRoot: 'select', kit: 'Select/Mono', states: ['rest', 'focus'], parts: FACE_FONT },
  { id: 'select-disabled', mock: select(LANGUAGES, 'en', { label: 'Language', disabled: 'Start the plugin to change this.' }), mockRoot: '#probe-stage select', kitRoot: 'select', kit: 'Select/DisabledWithReason', states: ['rest'], skip: ['width'], parts: FACE_FONT },

  // the secret (shell-page-settings.js 725 to 728): the input and the Show button of a secret that is not set; the input of one that is saved
  { id: 'secret-not-set', mock: secret('Not set', 'Type a value first.'), mockRoot: '#probe-stage .settings-secret', kitRoot: '[data-ov-part="secret"]', kit: 'SecretInput/NotSet', parts: { group: ':self', input: { mock: 'input', kit: 'input' }, eye: { mock: 'button', kit: '[data-ov-slot="show"]' }, eyeIcon: { mock: 'button svg', kit: '[data-ov-slot="show"] svg', skip: ['font'] } } },
  // The saved secret's field is read-only in the kit (a fact until Replace opens it) and a plain field in the mock, which has no Replace: only its place, size and words are the mock's.
  { id: 'secret-saved', mock: secret('Saved · hidden', 'A saved secret is never shown again.'), mockRoot: '#probe-stage .settings-secret', kitRoot: '[data-ov-part="secret"]', kit: 'SecretInput/Set', parts: { input: { mock: 'input', kit: 'input', skip: ['bg', 'border', 'color'] } } },
];
