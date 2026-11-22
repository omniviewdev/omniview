// The form probe: the kit's form parts (Field, TextInput, NumberInput, Toggle, Select, SecretInput) on the real ui-next parts page, in WebKit and
// Chromium, at 1440 x 900 and 1280 x 800, compared with the design mock's settings form (mock-form.json, measured by mock-form-measure.mjs from the
// case table of form-cases.mjs) and judged by their own rules. Nine sections:
//
//   parity     every case of form-cases.mjs against the mock, in Void and in Light: rectangles to half a pixel in y and in height and a pixel in x
//              and in width, every colour, border, padding, font and outline exactly; the states each case names are measured with real focus and
//              the pointer. What differs on purpose is in the case table with its reason.
//   states     every example in every state of the field model, read from the page: labelled, invalid, unavailable for a reason (focusable,
//              aria-disabled, described by the reason), read-only, the words of a secret, the stepper buttons out of the tab order.
//   secret     a secret typed with real key presses is in the live input's value and nowhere else in the page (no attribute, no text, no markup, no
//              storage), with Show on and off, cancelled with Escape, and by Replace; a stored secret is never in the page at all.
//   keyboard   real key presses: Escape and Enter on a draft, the arrows and Page Up of the number field, Tab leaving the number field without
//              stopping on its steps, Space and Enter on a switch, a read-only switch focusable and inert, a locked select, Retry.
//   themes     the paints of the parts in the nine themes are the tokens they name (nothing is a colour of its own).
//   axe        axe-core over the six parts, in Void and in Light; serious and critical violations fail (colour contrast included: it is judged here).
//   row        the Field's row layout (design 16 S126, S127) on every `Field/Row*` example: the trailing slot held at 24 x 24 whatever it holds, the height the content's
//              (the description two lines at most), the lane's glyph in the gutter and its words where the title starts.
//   rowstay    a message or a state change moves nothing: Retry and Reset, pressed by pointer and by keyboard, leave the boxes of the row where they were.
//   rowtip     the whole description is the tooltip while it is cut and none while it fits (a real pointer on the real description, in each engine).
//
// Run (the kit and ui-next must be built: DIST=<dir> reuses a build of ui-next, otherwise one is made):
//   node packages/kit/probes/form-probe.mjs
//
// Environment: ENGINES=webkit,chromium; VIEWPORTS=1440x900,1280x800; ONLY=<regexp on a section name>; REPORT=<dir> (writes form-probe.json);
// SHOTS=<dir> (screenshots of the examples of the six parts in Void and Light at 1440 x 900: <engine>-<theme>-<Part>.png); AXE=<axe.min.js>;
// FONT_DELAY_MS (serve.mjs); NEGATIVE_CONTROL=<name> runs ONE section in Chromium at 1440 x 900 twice, clean and with the fault planted, and prints
// `detected: ...` and exits 0 when the fault is seen and the clean run is silent, or `NOT DETECTED` and exits 1; ASSERTION_OFF=<regexp> drops every
// failure whose text matches (a control run with its own assertion off must NOT be detected: that is how a control is shown to trip only its own).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { awaitFonts, deviations, launch, measure, settle, sleep, summarize } from './probe-lib.mjs';
import { buildUiNext, serve } from './serve.mjs';
import { CASES, ROW_ROOM, THEMES, differences, readCase } from './form-cases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(path.join(here, 'mock-form.json'), 'utf8'));
const AXE = process.env.AXE ?? createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const PARTS = ['Field', 'TextInput', 'NumberInput', 'Toggle', 'Select', 'SecretInput'];
const NINE = ['void', 'dark', 'light', 'obsidian', 'carbon', 'solarized-dark', 'solarized-light', 'high-contrast-dark', 'high-contrast-light'];
const SIZES = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const engines = (process.env.ENGINES ?? 'webkit,chromium').split(',');
const viewports = (process.env.VIEWPORTS ?? '1440x900,1280x800').split(',');
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
let OFF = process.env.ASSERTION_OFF && process.env.ASSERTION_OFF !== 'says' ? new RegExp(process.env.ASSERTION_OFF) : null;
const SHOTS = process.env.SHOTS;
const REPORT = process.env.REPORT;
const SENTINEL = 'sk-live-4f9a1c7e5b2d8036';

const failures = [];
let checks = 0;
const fail = (where, id, message) => {
  const text = `${where} ${id}: ${message}`;
  if (OFF === null || !OFF.test(text)) failures.push(text);
};
const check = (ok, where, id, message) => {
  checks += 1;
  if (!ok) fail(where, id, message);
};
const same = (want, got) => JSON.stringify(want) === JSON.stringify(got);

// ---- the page --------------------------------------------------------------------------------------------------------------
async function open(browser, size, partsUrl) {
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(partsUrl, { waitUntil: 'load' });
  await page.waitForSelector('[data-example="Field/Aligned"]');
  await awaitFonts(page);
  await span(page, true);
  return { page, context, errors };
}

/** The examples of the six parts run the width of the page, so that a control of a fixed width is measured at its width and a fill one in a room as wide as the mock's stage. */
async function span(page, on) {
  await page.evaluate(
    ({ parts, on, room }) => {
      for (const figure of document.querySelectorAll('[data-example]')) {
        const name = figure.getAttribute('data-example') ?? '';
        if (!parts.some((part) => name.startsWith(`${part}/`))) continue;
        figure.style.gridColumn = on ? '1 / -1' : '';
        // A row sits at the end of a line, so it is compared in the room the mock's page gives its own: the stage is a flex row and the row is as wide as it.
        if (name.startsWith('Field/Row')) {
          figure.style.width = '';
          if (on) figure.style.width = `${room + figure.getBoundingClientRect().width - (figure.querySelector(':scope > div')?.clientWidth ?? 0)}px`;
        }
      }
    },
    { parts: PARTS, on, room: ROW_ROOM },
  );
  await settle(page);
}

const setTheme = async (page, id) => {
  await page.evaluate((theme) => document.documentElement.setAttribute('data-ov-theme', theme), id);
  await settle(page);
};

const kitParts = (parts) => Object.fromEntries(Object.entries(parts).map(([name, spec]) => [name, typeof spec === 'string' ? spec : { selector: spec.kit, pseudo: spec.pseudo }]));
const example = (name, inner = '') => `[data-example="${name}"] ${inner}`.trim();

// ---- parity ----------------------------------------------------------------------------------------------------------------
async function parity(page, where, theme, engine, ids) {
  const ref = reference.engines[engine]?.[theme];
  if (ref === undefined) return fail(where, 'parity', `no reference for ${engine} in ${theme}`);
  for (const c of ids === undefined ? CASES : CASES.filter((entry) => ids.includes(entry.id))) {
    const id = `parity/${c.id}`;
    const want = ref[c.id];
    if (want === undefined) {
      fail(where, id, 'no reference measured');
      continue;
    }

    const root = example(c.kit, c.kitRoot);
    try {
      if (c.states !== undefined && c.states.length > 0) {
        const got = await measure(page, page.locator(root).first(), { states: c.states });
        for (const state of c.states) {
          for (const d of deviations(want.primary[state], summarize(got[state], { withOutline: state === 'focus' }), { tolerance: 1, withOutline: state === 'focus', skip: c.skip ?? [] })) fail(where, `${id}/${state}`, d);
        }
      }

      if (c.parts !== undefined) {
        const got = await page.evaluate(readCase, { root, parts: kitParts(c.parts) });
        for (const [name, spec] of Object.entries(c.parts)) {
          for (const d of differences(want.parts[name], got[name], typeof spec === 'object' ? (spec.skip ?? []) : [])) fail(where, `${id}/${name}`, d);
        }
      }

      checks += 1;
    } catch (error) {
      fail(where, id, `could not be measured: ${String(error.message).split('\n')[0]}`);
    }
  }
}

// ---- states ----------------------------------------------------------------------------------------------------------------
/** Page side (self-contained): what each example of the six parts exposes. */
function readFacts(parts) {
  const words = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const describe = (el) => (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean).map((id) => words(document.getElementById(id))).join(' ').trim();
  const out = {};
  for (const figure of document.querySelectorAll('[data-example]')) {
    const name = figure.getAttribute('data-example') ?? '';
    if (!parts.some((part) => name.startsWith(`${part}/`))) continue;
    const controls = [...figure.querySelectorAll('input, select, [role="switch"]')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      labelled: el.id !== '' && figure.querySelector(`label[for="${el.id}"]`) !== null,
      ariaLabel: el.getAttribute('aria-label'),
      invalid: el.getAttribute('aria-invalid'),
      disabled: el.getAttribute('aria-disabled'),
      readonlyAria: el.getAttribute('aria-readonly'),
      readOnly: el.readOnly === true,
      required: el.required === true,
      checked: el.getAttribute('aria-checked'),
      validation: el.getAttribute('data-ov-validation'),
      described: describe(el),
      tabIndex: el.tabIndex,
      value: el.value ?? null,
      valueAttr: el.hasAttribute('value'),
      placeholder: el.getAttribute('placeholder'),
    }));
    const buttons = [...figure.querySelectorAll('button:not([role="switch"])')].map((el) => ({ name: el.getAttribute('aria-label') ?? words(el), tabIndex: el.tabIndex, disabled: el.getAttribute('aria-disabled') }));
    const lane = figure.querySelector('[data-ov-part="lane"]');
    out[name] = { controls, buttons, lane: lane === null ? null : { kind: lane.getAttribute('data-ov-kind'), text: words(lane) } };
  }

  return out;
}

async function states(page, where) {
  const facts = await page.evaluate(readFacts, PARTS);
  if (process.env.FACTS) console.log(JSON.stringify(facts, null, 1));
  const first = (name) => facts[name]?.controls[0];
  const id = (name) => `states/${name}`;
  for (const [name, fact] of Object.entries(facts)) {
    for (const control of fact.controls) {
      check(control.labelled || control.ariaLabel !== null, where, id(name), `no label is for the ${control.tag}, and it has no name of its own`);
    }
  }

  const expectControl = (name, want, index = 0) => {
    const control = facts[name]?.controls[index];
    if (control === undefined) return fail(where, id(name), 'has no control');
    for (const [key, value] of Object.entries(want)) {
      check(same(value, control[key]), where, id(name), `${key} is ${JSON.stringify(control[key])}, wanted ${JSON.stringify(value)}`);
    }
  };
  const described = (name, text, index = 0) => {
    const got = facts[name]?.controls[index]?.described ?? '';
    check(got.includes(text), where, id(name), `is not described by "${text}" (described by "${got}")`);
  };

  // the field's lane, in each kind
  for (const [name, kind] of [['Field/LaneError', 'error'], ['Field/LaneWarning', 'warning'], ['Field/LaneChecking', 'checking'], ['Field/LaneCouldNotCheck', 'retry'], ['Field/LaneSaved', 'saved'], ['Field/LaneInfo', 'info'], ['Field/LaneHint', 'hint']]) {
    check(facts[name]?.lane?.kind === kind, where, id(name), `lane kind is ${JSON.stringify(facts[name]?.lane?.kind)}, wanted ${kind}`);
  }

  // invalid, warning, required
  for (const name of ['Field/LaneError', 'TextInput/Invalid', 'NumberInput/Invalid', 'Select/Invalid', 'SecretInput/Invalid']) expectControl(name, { invalid: 'true' });
  expectControl('Field/LaneWarning', { invalid: null, validation: 'warning' });
  expectControl('Field/Required', { required: true });
  described('Field/LaneError', 'Name is taken. Choose another.');
  described('Field/LaneWarning', 'Name is unusual. Check it.');

  // unavailable for a reason: focusable, aria-disabled, described by the reason (design P2, DR1)
  for (const [name, reason] of [
    ['TextInput/DisabledWithReason', null],
    ['NumberInput/DisabledWithReason', null],
    ['Toggle/DisabledWithReason', 'Turn on Send telemetry to change this.'],
    ['Select/DisabledWithReason', null],
    ['SecretInput/DisabledWithReason', 'Start the plugin to change this.'],
  ]) {
    expectControl(name, { disabled: 'true' });
    check(facts[name]?.controls[0]?.tabIndex !== -1, where, id(name), 'is not focusable');
    check((facts[name]?.controls[0]?.described ?? '') !== '', where, id(name), 'is described by nothing: the reason is not said');
    if (reason !== null) described(name, reason);
  }

  // read-only, "not supported in this version"
  for (const name of ['TextInput/ReadOnlyNotSupported', 'NumberInput/ReadOnlyNotSupported', 'SecretInput/ReadOnlyNotSupported']) {
    expectControl(name, { readOnly: true, readonlyAria: null });
    described(name, 'Not supported in this version.');
  }

  // A read-only switch and select are painted and exposed as unavailable, as the mock does (`lockControls`), and say why.
  for (const name of ['Toggle/ReadOnlyNotSupported', 'Select/ReadOnlyNotSupported']) {
    expectControl(name, { disabled: 'true', readonlyAria: null });
    check(facts[name]?.controls[0]?.tabIndex !== -1, where, id(name), 'the read-only control is not focusable');
    described(name, 'Not supported in this version.');
  }

  // the switch
  expectControl('Toggle/Idle', { role: 'switch', checked: 'false', disabled: null });
  expectControl('Toggle/On', { role: 'switch', checked: 'true' });

  // the stepper buttons are for the pointer: not tab stops (one stop per number field, as the mock's `oneStop`)
  for (const name of ['NumberInput/Idle', 'NumberInput/Dirty', 'NumberInput/WithUnit']) {
    const buttons = facts[name]?.buttons ?? [];
    check(buttons.length === 2, where, id(name), `has ${buttons.length} buttons, wanted the two steps`);
    for (const button of buttons) check(button.tabIndex === -1, where, id(name), `stepper button "${button.name}" is a tab stop`);
    check(buttons.some((b) => /^Decrease /.test(b.name)) && buttons.some((b) => /^Increase /.test(b.name)), where, id(name), `the steps are not named: ${buttons.map((b) => b.name).join(', ')}`);
  }

  // the words of a secret (shell-page-settings.js 725 to 728) and its buttons
  expectControl('SecretInput/NotSet', { placeholder: 'Not set', value: '', valueAttr: false, readOnly: false });
  expectControl('SecretInput/Set', { placeholder: 'Saved · hidden', value: '', valueAttr: false, readOnly: true });
  expectControl('SecretInput/Dirty', { placeholder: 'Changed', value: '', valueAttr: false });
  const stored = facts['SecretInput/Set']?.buttons ?? [];
  check(stored.length === 1 && /^Replace/.test(stored[0].name), where, id('SecretInput/Set'), `a stored secret has ${JSON.stringify(stored.map((b) => b.name))}, wanted Replace and nothing that reveals it`);
  check(!stored.some((b) => /show|hide|reveal/i.test(b.name)), where, id('SecretInput/Set'), 'a stored secret offers a way to show it');
  const fresh = facts['SecretInput/NotSet']?.buttons ?? [];
  check(fresh.some((b) => /^Show /.test(b.name) && b.disabled === 'true'), where, id('SecretInput/NotSet'), `Show is not unavailable while nothing is typed: ${JSON.stringify(fresh)}`);

  // the row (design 16 S126, S127): each state of the model in its lane, and the control told what the lane says
  for (const [name, kind] of [['Field/RowHint', 'hint'], ['Field/RowInvalid', 'error'], ['Field/RowWarning', 'warning'], ['Field/RowChecking', 'checking'], ['Field/RowCouldNotCheck', 'retry'], ['Field/RowSaved', 'saved'], ['Field/RowApplyFailed', 'error'], ['Field/RowRestartRequired', 'info'], ['Field/RowUnavailable', 'info'], ['Field/RowReadOnly', 'info']]) {
    check(facts[name]?.lane?.kind === kind, where, id(name), `lane kind is ${JSON.stringify(facts[name]?.lane?.kind)}, wanted ${kind}`);
  }

  for (const name of ['Field/RowInvalid', 'Field/RowApplyFailed']) expectControl(name, { invalid: 'true' });
  expectControl('Field/RowWarning', { invalid: null, validation: 'warning' });
  expectControl('Field/RowUnavailable', { role: 'switch', disabled: 'true' });
  check(facts['Field/RowUnavailable']?.controls[0]?.tabIndex !== -1, where, id('Field/RowUnavailable'), 'is not focusable');
  expectControl('Field/RowReadOnly', { readOnly: true, readonlyAria: null });
  described('Field/RowDefault', 'How the workspace is named in the title bar.');
  described('Field/RowInvalid', 'Name has a space. Use letters and digits.');
  described('Field/RowUnavailable', 'Turn on Send telemetry to change this.');
  described('Field/RowReadOnly', 'Managed by your organisation.');
  const held = facts['Field/RowModified']?.buttons ?? [];
  check(held.length === 1 && held[0].name === 'Reset Display name to default', where, id('Field/RowModified'), `the slot of the modified row holds ${JSON.stringify(held.map((b) => b.name))}, wanted the one Reset button named for the row`);
}

// ---- secret ----------------------------------------------------------------------------------------------------------------
/** Page side: where the needle is in the page: attributes, text, markup, storage, the title, and the live value of every field but the one being typed into (`exempt`, a selector). */
function scan({ needle, exempt }) {
  const found = [];
  for (const el of document.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    for (const attribute of el.attributes) if (attribute.value.includes(needle)) found.push(`attribute ${tag}[${attribute.name}]`);
    for (const node of el.childNodes) if (node.nodeType === 3 && (node.nodeValue ?? '').includes(needle)) found.push(`text in ${tag}`);
  }

  if (document.documentElement.outerHTML.includes(needle)) found.push('the page markup');
  for (const store of [localStorage, sessionStorage]) {
    for (let index = 0; index < store.length; index += 1) if ((store.getItem(store.key(index) ?? '') ?? '').includes(needle)) found.push('storage');
  }

  if (document.title.includes(needle)) found.push('the title');
  const typing = exempt === null ? null : document.querySelector(exempt);
  for (const field of document.querySelectorAll('input, textarea, select')) {
    if (field !== typing && String(field.value ?? '').includes(needle)) found.push(`the value of a ${field.tagName.toLowerCase()} in ${field.closest('[data-example]')?.getAttribute('data-example') ?? 'the page'}`);
  }

  return found;
}

async function secret(page, where) {
  const none = async (id, what, exempt = null) => {
    const found = await page.evaluate(scan, { needle: SENTINEL, exempt });
    check(found.length === 0, where, id, `the typed secret is in the page (${what}): ${[...new Set(found)].join(', ')}`);
  };

  // never saved: typed, shown, hidden, cancelled
  const fresh = page.locator(example('SecretInput/NotSet', 'input')).first();
  await fresh.click();
  await page.keyboard.type(SENTINEL);
  check((await fresh.inputValue()) === SENTINEL, where, 'secret/typed', 'the typed text is not in the live input');
  await none('secret/typed', 'typed', '[data-example="SecretInput/NotSet"] input');
  const show = page.locator(example('SecretInput/NotSet', 'button')).first();
  await show.click();
  check((await fresh.getAttribute('type')) === 'text', where, 'secret/shown', 'Show does not reveal what is typed');
  await none('secret/shown', 'shown', '[data-example="SecretInput/NotSet"] input');
  await show.click();
  check((await fresh.getAttribute('type')) === 'password', where, 'secret/hidden', 'Hide does not cover what is typed');
  await none('secret/hidden', 'hidden again', '[data-example="SecretInput/NotSet"] input');
  await fresh.focus();
  await page.keyboard.press('Escape');
  check((await fresh.inputValue()) === '', where, 'secret/cancelled', `Escape leaves "${await fresh.inputValue()}" in the field`);
  await none('secret/cancelled', 'cancelled');

  // saved: nothing in the page, Replace opens an empty field
  const stored = page.locator(example('SecretInput/Set', 'input')).first();
  check((await stored.inputValue()) === '' && (await stored.getAttribute('value')) === null, where, 'secret/stored', 'a stored secret has a value in the page');
  const replace = page.locator(example('SecretInput/Set', 'button')).first();
  await replace.focus();
  await page.keyboard.press('Enter');
  check(await stored.evaluate((el) => el === document.activeElement && !el.readOnly), where, 'secret/replace', 'Replace does not open the field and put the focus in it');
  await page.keyboard.type(SENTINEL);
  check((await stored.inputValue()) === SENTINEL, where, 'secret/replaced', 'the typed text is not in the live input');
  await none('secret/replaced', 'replacing', '[data-example="SecretInput/Set"] input');
  await page.keyboard.press('Escape');
  check((await stored.inputValue()) === '' && (await stored.evaluate((el) => el.readOnly)), where, 'secret/replace-cancelled', 'Escape does not put the stored secret back in charge');
  await none('secret/replace-cancelled', 'replace cancelled');
}

// ---- keyboard ----------------------------------------------------------------------------------------------------------------
async function keyboard(page, where, theme, engine) {
  await page.evaluate(() => {
    window.__writes = [];
    const observer = new MutationObserver((records) => records.forEach((r) => window.__writes.push(`${r.target.nodeName}.${r.attributeName}`)));
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
  });
  const at = (name, inner) => page.locator(example(name, inner)).first();
  const attr = (locator, name) => locator.getAttribute(name);

  // a draft: Escape puts the applied value back
  const draft = at('TextInput/Dirty', 'input');
  await draft.focus();
  await page.keyboard.type('1');
  check((await draft.inputValue()).endsWith('1'), where, 'keyboard/text', 'typing does not change the field');
  await page.keyboard.press('Escape');
  check((await draft.inputValue()) === 'collector.example.test:4318', where, 'keyboard/text', `Escape leaves "${await draft.inputValue()}", wanted the applied value`);

  // the number field: arrows, Page Up, and Tab leaves without stopping on a step
  const number = at('NumberInput/Idle', 'input');
  await number.focus();
  await page.keyboard.press('ArrowUp');
  check((await number.inputValue()) === '12', where, 'keyboard/number', `ArrowUp gives "${await number.inputValue()}", wanted 12`);
  await page.keyboard.press('PageUp');
  check(Number(await number.inputValue()) > 12, where, 'keyboard/number', `Page Up gives "${await number.inputValue()}", wanted more than 12`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  const stop = await page.evaluate(() => document.activeElement?.closest('[data-ov-part="stepper"]') !== null && document.activeElement?.tagName === 'BUTTON');
  check(!stop, where, 'keyboard/number', 'a stepper button is a tab stop');
  // The steps themselves are for the pointer: no button of a number field is reachable by Tab (the probe asks the page, whatever the engine's tabbing setting).
  const stops = await page.evaluate(() => [...document.querySelectorAll('[data-ov-part="stepper"] button')].filter((b) => b.tabIndex >= 0).length);
  check(stops === 0, where, 'keyboard/number', `${stops} stepper buttons are tab stops`);

  // the switch: Space and Enter press it; read-only is focusable and inert
  const toggle = at('Toggle/Idle', '[role="switch"]');
  await toggle.focus();
  await page.keyboard.press('Space');
  check((await attr(toggle, 'aria-checked')) === 'true', where, 'keyboard/switch', 'Space does not turn the switch on');
  await page.keyboard.press('Enter');
  check((await attr(toggle, 'aria-checked')) === 'false', where, 'keyboard/switch', 'Enter does not turn the switch off');
  const locked = at('Toggle/ReadOnlyNotSupported', '[role="switch"]');
  await locked.focus();
  check(await locked.evaluate((el) => el === document.activeElement), where, 'keyboard/switch', 'a read-only switch cannot take the focus');
  await page.keyboard.press('Space');
  check((await attr(locked, 'aria-checked')) === 'false', where, 'keyboard/switch', 'Space changes a read-only switch');

  // A locked select keeps its value under a key that would change it AND refuses the key: its keydown is prevented. (A controlled select is put back by
  // the page, so the value alone would not say whether the key was blocked.) A letter selects the option that starts with it in every engine, with no
  // popup of the platform; an unlocked select changes under the same key and does not prevent it, so that the check can fail.
  await page.evaluate(() => {
    window.__keys = [];
    // A capture listener at the document sees the event before anything can stop it, and `defaultPrevented` is read after the press, when every handler has run.
    document.addEventListener('keydown', (event) => window.__keys.push({ key: event.key, example: event.target.closest?.('[data-example]')?.getAttribute('data-example') ?? null, event }), true);
  });
  const typeAhead = async (name) => {
    const select = at(name, 'select');
    await select.focus();
    const focused = await select.evaluate((el) => el === document.activeElement);
    const before = await select.inputValue();
    await page.keyboard.press('d');
    const press = await page.evaluate((example) => { const entry = window.__keys.filter((item) => item.key === 'd' && item.example === example).at(-1); return entry === undefined ? null : { prevented: entry.event.defaultPrevented }; }, name);
    return { focused, before, after: await select.inputValue(), prevented: press?.prevented };
  };
  const lockedKey = await typeAhead('Select/DisabledWithReason');
  check(lockedKey.focused, where, 'keyboard/select', 'a locked select cannot take the focus');
  check(lockedKey.after === lockedKey.before, where, 'keyboard/select', `a key changes a locked select (${lockedKey.before} to ${lockedKey.after})`);
  check(lockedKey.prevented === true, where, 'keyboard/select', 'the key of a locked select is not prevented: its keydown is not refused');
  const openKey = await typeAhead('Select/Idle');
  check(openKey.after !== openKey.before, where, 'keyboard/select', 'the key used on the locked select changes nothing in an unlocked one: the check proves nothing');
  check(openKey.prevented === false, where, 'keyboard/select', 'the key of an unlocked select is prevented: the check proves nothing');

  // Retry answers the keyboard
  const retry = at('Field/LaneCouldNotCheck', '[data-ov-part="lane"] button');
  await retry.focus();
  await page.keyboard.press('Enter');
  check((await at('Field/LaneCouldNotCheck', '[data-ov-part="lane"]').getAttribute('data-ov-kind')) !== 'retry', where, 'keyboard/retry', 'Enter on Retry does not ask again');

  const writes = await page.evaluate(() => window.__writes);
  check(writes.length === 0, where, 'keyboard/root', `a part wrote to the root: ${writes.join(', ')}`);
}

// ---- row ---------------------------------------------------------------------------------------------------------------------
/** Page side (self-contained): the boxes, relative to the row, of the parts of the row examples named, and what the lane and the slot hold. */
function readRows(names) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const out = {};
  for (const name of names) {
    const root = document.querySelector(`[data-example="${name}"] [data-ov-layout="row"]`);
    if (root === null) {
      out[name] = null;
      continue;
    }

    const origin = root.getBoundingClientRect();
    const box = (selector) => {
      const el = root.querySelector(selector);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { x: r2(b.left - origin.left), y: r2(b.top - origin.top), w: r2(b.width), h: r2(b.height), right: r2(b.right - origin.left) };
    };
    const help = root.querySelector('[data-ov-part="help"]');
    out[name] = {
      root: { x: 0, y: 0, w: r2(origin.width), h: r2(origin.height), right: r2(origin.width) },
      title: box('[data-ov-part="label"]'),
      help: box('[data-ov-part="help"]'),
      lines: help === null ? null : { scroll: help.scrollHeight, client: help.clientHeight },
      lane: box('[data-ov-part="lane"]'),
      message: box('[data-ov-part="message"]'),
      glyph: box('[data-ov-part="lane"] > svg'),
      control: box('[data-ov-part="control"] > :first-child'),
      slot: box('[data-ov-part="trailing"]'),
      held: root.querySelector('[data-ov-part="trailing"]')?.children.length ?? 0,
      kind: root.querySelector('[data-ov-part="lane"]')?.getAttribute('data-ov-kind') ?? null,
    };
  }

  return out;
}

const rowNames = async (page, ids) => (await page.evaluate(() => [...document.querySelectorAll('[data-example^="Field/Row"]')].map((figure) => figure.getAttribute('data-example')))).filter((name) => ids === undefined || ids.includes(name));

/**
 * Every row example, whatever it holds or says: its trailing slot is held at 24 x 24 and the control ends 32 px before the row's end (the slot and the 8 px after the control),
 * its height is its content's (6 + the title's 16 + a line of 16 or two for the description + the lane's 16 when it has one + 6, never more than two lines), and its lane's
 * glyph hangs in the gutter, so that the words of a message start where the title starts (S126, S127; the settings page's 20 px gutter).
 */
async function rowGeometry(page, where, theme, engine, ids) {
  const names = await rowNames(page, ids);
  const rows = await page.evaluate(readRows, names);
  for (const name of names) {
    const r = rows[name];
    const id = `row/${name}`;
    if (r === null) {
      fail(where, id, 'is not drawn as a row');
      continue;
    }

    const room = Math.round((r.root.w - (r.control?.right ?? 0)) * 100) / 100;
    check(r.slot !== null && Math.abs(r.slot.w - 24) <= 0.5 && Math.abs(r.slot.h - 24) <= 0.5 && Math.abs(room - 32) <= 0.5, where, id, `the trailing slot is ${r.slot?.w} x ${r.slot?.h} and the control ends ${room} px before the row's end: the slot is held at 24 x 24 whatever it holds, 8 px after the control (32 px)`);
    const lines = r.lines === null ? 0 : Math.min(Math.round(r.lines.scroll / 16), 2);
    const wanted = Math.max(40, 12 + 16 + lines * 16 + (r.lane === null ? 0 : 16));
    check(Math.abs(r.root.h - wanted) <= 0.5, where, id, `the row is ${r.root.h} px high and its content says ${wanted} (6 + 16 + ${lines} lines of 16 + ${r.lane === null ? 'no lane' : 'the lane of 16'} + 6): its height is its content's, a description is two lines at most`);
    if (r.message !== null) {
      const hung = r.glyph === null || r.glyph.x + r.glyph.w / 2 < r.title.x;
      check(Math.abs(r.message.x - r.title.x) <= 0.5 && hung, where, id, `the lane's glyph does not hang in the gutter: its words start ${r.message.x} px from the row's start and the title ${r.title.x} px (they start together), the glyph is ${r.glyph === null ? 'not drawn' : `${r.glyph.x} px in`}`);
    }
  }
}

/**
 * A message or a state change never alters a row (S126: a row's rect is identical before and after a failed commit and a retry): the boxes of the row before and after
 * Retry (by the pointer, and by the keyboard) and after Reset (by the keyboard), which takes its button out of the slot.
 */
async function rowStays(page, where, theme, engine, ids) {
  const boxes = (r) => JSON.stringify([r.root, r.title, r.help, r.lane, r.control, r.slot]);
  const stays = async (name, what, press) => {
    if (ids !== undefined && !ids.includes(name)) return;
    const id = `row/${name}`;
    const before = (await page.evaluate(readRows, [name]))[name];
    await press();
    await settle(page);
    const after = (await page.evaluate(readRows, [name]))[name];
    if (before === null || after === null) return fail(where, id, 'is not drawn as a row');
    check(before.kind !== after.kind || before.held !== after.held, where, id, `premise: ${what} changed nothing in the row (the lane says ${before.kind} before and after, the slot holds ${before.held})`);
    check(boxes(before) === boxes(after), where, id, `the row moved when ${what}: ${boxes(before)} became ${boxes(after)}`);
  };
  const press = (name, inner, how) => async () => {
    const button = page.locator(example(name, inner)).first();
    if (how === 'pointer') return button.click();
    await button.focus();
    await page.keyboard.press('Enter');
  };
  await stays('Field/RowCouldNotCheck', 'Retry was pressed', press('Field/RowCouldNotCheck', '[data-ov-part="lane"] button', 'pointer'));
  await stays('Field/RowApplyFailed', 'Retry was pressed with the keyboard', press('Field/RowApplyFailed', '[data-ov-part="lane"] button', 'keyboard'));
  await stays('Field/RowModified', 'Reset was pressed with the keyboard', press('Field/RowModified', '[data-ov-part="trailing"] button', 'keyboard'));
}

/**
 * The whole description of a row is its tooltip while it is cut and there is none while it fits: a real pointer on the real description in each engine, which is what the
 * tooltip host's measure of a box cut in height (`scrollHeight`) stands on. A tip opens 500 ms after the pointer arrives.
 */
async function rowTip(page, where, theme, engine, ids) {
  if (!where.includes('@1440x900') || (ids !== undefined && !ids.includes('Field/RowLongDescription'))) return;
  const read = (name) =>
    page.evaluate((example) => {
      const help = document.querySelector(`[data-example="${example}"] [data-ov-part="help"]`);
      return { text: (help?.textContent ?? '').replace(/\s+/g, ' ').trim(), cut: help === null ? null : help.scrollHeight > help.clientHeight + 1 };
    }, name);
  const tipOn = async (name) => {
    await page.locator(example(name, '[data-ov-part="help"]')).first().hover();
    await sleep(650);
    const shown = await page.evaluate(() => {
      const host = document.querySelector('[role="tooltip"]');
      return host?.matches(':popover-open') ? (host.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
    });
    await page.mouse.move(1, 1);
    await sleep(100);
    return shown;
  };
  const long = await read('Field/RowLongDescription');
  const short = await read('Field/RowDefault');
  check(long.cut === true && short.cut === false, where, 'row/premise', `the long description is ${long.cut ? '' : 'not '}cut and the short one is ${short.cut ? '' : 'not '}cut: wanted the first cut and the second whole`);
  const shown = await tipOn('Field/RowLongDescription');
  check(shown === long.text, where, 'row/Field/RowLongDescription', `the tooltip of a description that is cut says ${shown === null ? 'nothing' : `"${shown.slice(0, 48)}…"`}, wanted all of it`);
  const none = await tipOn('Field/RowDefault');
  check(none === null, where, 'row/Field/RowDefault', `a description that fits has a tooltip ("${none}")`);
}

// ---- themes ----------------------------------------------------------------------------------------------------------------
const PAINTS = [
  ['TextInput/Idle', 'input', 'borderTopColor', '--ov-border-control'],
  ['TextInput/Idle', 'input', 'backgroundColor', '--ov-bg-island'],
  ['TextInput/Idle', 'input', 'color', '--ov-fg'],
  ['TextInput/Invalid', 'input', 'borderTopColor', '--ov-error-control-inactive'],
  ['Field/LaneWarning', 'input', 'borderTopColor', '--ov-warning-control-inactive'],
  ['TextInput/ReadOnlyNotSupported', 'input', 'backgroundColor', '--ov-bg-inline'],
  ['TextInput/ReadOnlyNotSupported', 'input', 'borderTopColor', '--ov-border-subtle'],
  ['TextInput/DisabledWithReason', 'input', 'color', '--ov-fg-disabled'],
  ['Field/LaneError', '[data-ov-part="lane"]', 'color', '--ov-error-fg'],
  ['Field/LaneWarning', '[data-ov-part="lane"]', 'color', '--ov-warning-fg'],
  ['Field/LaneHint', '[data-ov-part="lane"]', 'color', '--ov-fg-muted'],
  ['Field/Required', '[data-ov-part="required"]', 'color', '--ov-error-fg'],
  ['Toggle/Idle', '[data-ov-part="track"]', 'backgroundColor', '--ov-border-control'],
  ['Toggle/On', '[data-ov-part="track"]', 'backgroundColor', '--ov-accent'],
  ['Toggle/DisabledWithReason', '[data-ov-part="track"]', 'backgroundColor', '--ov-border-disabled'],
  ['Select/Idle', 'select', 'borderTopColor', '--ov-border-control'],
  ['Select/Idle', 'select', 'color', '--ov-fg'],
  ['NumberInput/Idle', '[data-ov-part="stepper"]', 'borderTopColor', '--ov-border-control'],
  ['NumberInput/Idle', '[data-ov-part="stepper"]', 'backgroundColor', '--ov-bg-island'],
  ['NumberInput/Invalid', '[data-ov-part="stepper"]', 'borderTopColor', '--ov-error-control-inactive'],
  ['SecretInput/NotSet', 'input', 'backgroundColor', '--ov-bg-island'],
  ['Field/RowDefault', '[data-ov-part="label"]', 'color', '--ov-fg'],
  ['Field/RowDefault', '[data-ov-part="help"]', 'color', '--ov-fg-muted'],
  ['Field/RowUnavailable', '[data-ov-part="label"]', 'color', '--ov-fg-muted'],
  ['Field/RowInvalid', '[data-ov-part="lane"]', 'color', '--ov-error-fg'],
  ['Field/RowWarning', '[data-ov-part="lane"]', 'color', '--ov-warning-fg'],
  ['Field/RowHint', '[data-ov-part="lane"]', 'color', '--ov-fg-muted'],
];

/** Page side: each paint beside the token it names, resolved in the theme in effect. */
function readPaints(paints) {
  const probe = document.createElement('span');
  document.body.appendChild(probe);
  const resolve = (token) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  const out = paints.map(([name, inner, property, token]) => {
    const el = document.querySelector(`[data-example="${name}"] ${inner}`);
    return { name, inner, property, token, got: el === null ? null : getComputedStyle(el)[property], want: resolve(token) };
  });
  probe.remove();
  return out;
}

async function themes(page, where) {
  for (const theme of NINE) {
    await setTheme(page, theme);
    for (const paint of await page.evaluate(readPaints, PAINTS)) {
      check(paint.got === paint.want, `${where.replace(/\/[^/]*$/, '')}/${theme}`, `themes/${paint.name} ${paint.inner} ${paint.property}`, `is ${paint.got}, the token ${paint.token} is ${paint.want}`);
    }
  }

  await setTheme(page, 'void');
}

// ---- axe -------------------------------------------------------------------------------------------------------------------
async function axeRun(page, where) {
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(
    async (selectors) => {
      const result = await window.axe.run({ include: selectors.map((selector) => [selector]) }, { resultTypes: ['violations'] });
      return result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
    },
    PARTS.map((part) => `[data-example^="${part}/"]`),
  );
  checks += 1;
  for (const v of violations) if (v.impact === 'serious' || v.impact === 'critical') fail(where, `axe/${v.id}`, `${v.impact}: ${v.nodes.join(' | ')}`);
}

// ---- screenshots -----------------------------------------------------------------------------------------------------------
async function shots(page, engine, theme) {
  mkdirSync(SHOTS, { recursive: true });
  await sleep(1300); // the loader of a checking lane comes after a second
  // The rows first, in the room the parity compares them in (880 px): one picture of every row example.
  const clip = await page.evaluate(() => {
    const figures = [...document.querySelectorAll('[data-example^="Field/Row"]')];
    const first = figures[0].getBoundingClientRect();
    const last = figures.at(-1).getBoundingClientRect();
    return { x: Math.max(0, first.left + window.scrollX - 8), y: first.top + window.scrollY - 8, width: first.width + 16, height: last.bottom - first.top + 16 };
  });
  await page.screenshot({ path: path.join(SHOTS, `${engine}-${theme}-FieldRows.png`), clip, fullPage: true });
  await span(page, false);
  // The grid of the Field part in three columns has no room for a row, which has its own picture.
  const rowFigures = '[data-example^="Field/Row"]';
  await page.evaluate((selector) => document.querySelectorAll(selector).forEach((figure) => (figure.style.display = 'none')), rowFigures);
  await page.evaluate((parts) => {
    for (const part of parts) {
      const grid = document.querySelector(`[data-example^="${part}/"]`)?.parentElement;
      if (grid) grid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
    }
  }, PARTS);
  await settle(page);
  for (const part of PARTS) {
    const grid = page.locator(`[data-example^="${part}/"]`).first().locator('xpath=..');
    await grid.screenshot({ path: path.join(SHOTS, `${engine}-${theme}-${part}.png`) });
  }

  await page.evaluate((parts) => {
    for (const part of parts) {
      const grid = document.querySelector(`[data-example^="${part}/"]`)?.parentElement;
      if (grid) grid.style.gridTemplateColumns = '';
    }
  }, PARTS);
  await page.evaluate((selector) => document.querySelectorAll(selector).forEach((figure) => (figure.style.display = '')), rowFigures);
  await span(page, true);
}

// ---- controls (each plants one fault; the section it belongs to must see it) --------------------------------------------------
const style = (rule) => (page) => page.addStyleTag({ content: rule });
const CONTROLS = {
  'face-height': { section: 'parity', cases: ['face-mono'], says: /parity\/face-mono\/rest: height/, plant: style('[data-example="TextInput/Mono"] input:not(:focus) { min-height: 32px; }'), fault: 'a text field at rest 4 px taller than the mock\'s' },
  'lane-offset': { section: 'parity', cases: ['lane-error'], says: /parity\/lane-error\/text: y/, plant: style('[data-example="Field/LaneError"] [data-ov-part="message"] { position: relative; inset-block-start: 6px; }'), fault: 'a lane message 6 px lower than the mock\'s' },
  'track-width': { section: 'parity', cases: ['switch-on'], says: /parity\/switch-on\/track: w/, plant: style('[data-example="Toggle/On"] [data-ov-part="track"] { width: 30px; margin-inline-end: -4px; }'), fault: 'a switch track 4 px wider than the mock\'s, at the same place' },
  'stepper-pad': { section: 'parity', cases: ['stepper'], says: /parity\/stepper\/input: pad/, plant: style('[data-example="NumberInput/Idle"] [data-ov-part="stepper"] input { padding-inline: 4px; }'), fault: 'a number field with padding the mock\'s has not' },
  'label-for': { section: 'states', says: /states\/Field\/Aligned: no label is for/, plant: (page) => page.evaluate(() => document.querySelector('[data-example="Field/Aligned"] label')?.removeAttribute('for')), fault: 'a label that is for no control' },
  'switch-pressable': { section: 'states', says: /states\/Toggle\/ReadOnlyNotSupported: disabled is null/, plant: (page) => page.evaluate(() => document.querySelector('[data-example="Toggle/ReadOnlyNotSupported"] [role="switch"]')?.removeAttribute('aria-disabled')), fault: 'a read-only switch that is not exposed as unavailable (looks pressable)' },
  'step-tab-stop': { section: 'keyboard', says: /keyboard\/number: .*tab stop/, plant: (page) => page.evaluate(() => document.querySelector('[data-example="NumberInput/Idle"] [data-ov-part="stepper"] button')?.setAttribute('tabindex', '0')), fault: 'a stepper button that is a tab stop' },
  'select-unblocked': { section: 'keyboard', says: /keyboard\/select: the key of a locked select is not prevented/, plant: (page) => page.evaluate(() => document.querySelector('[data-example="Select/DisabledWithReason"] select')?.addEventListener('keydown', (event) => event.stopImmediatePropagation(), true)), fault: 'a locked select whose keydown is not refused' },
  'mono-font': { section: 'parity', cases: ['face-mono'], says: /parity\/face-mono\/face: font/, plant: style('[data-example="TextInput/Mono"] input { font-family: var(--ov-font-ui); }'), fault: 'a code-face field drawn in the interface face' },
  'secret-attribute': {
    section: 'secret',
    says: /secret\/typed: the typed secret is in the page .*attribute input\[data-copy\]/,
    plant: (page) =>
      page.evaluate(() => {
        // Only the field that was never saved, and only until Show is pressed: the fault trips the check of what was typed and no other.
        const fresh = '[data-example="SecretInput/NotSet"]';
        document.addEventListener('input', (event) => event.target instanceof HTMLInputElement && event.target.closest(fresh) !== null && event.target.setAttribute('data-copy', event.target.value), true);
        document.addEventListener('click', (event) => event.target instanceof Element && event.target.closest(`${fresh} [data-ov-slot="show"]`) !== null && document.querySelectorAll('[data-copy]').forEach((el) => el.removeAttribute('data-copy')), true);
      }),
    fault: 'the typed secret copied into an attribute of its input',
  },
  // The row (design 16 S126, S127): each plants one fault that one assertion of the row's own sections, or one line of its parity, says.
  'row-glyph-gutter': {
    section: 'row',
    cases: ['Field/RowInvalid'],
    says: /row\/Field\/RowInvalid: the lane's glyph does not hang in the gutter/,
    plant: style('[data-example="Field/RowInvalid"] [data-ov-part="lane"] > svg { position: static; }'),
    fault: 'the lane\'s glyph in the line instead of hanging in the gutter: its words start 20 px late',
  },
  'row-slot-held': {
    section: 'row',
    cases: ['Field/RowDefault'],
    says: /row\/Field\/RowDefault: the trailing slot/,
    plant: style('[data-example="Field/RowDefault"] [data-ov-part="trailing"] { display: none; }'),
    fault: 'a trailing slot that is not held when it is empty: the control sits 32 px further along, and moves when the slot is filled',
  },
  'row-clamp': {
    section: 'row',
    cases: ['Field/RowLongDescription'],
    says: /row\/Field\/RowLongDescription: the row is/,
    plant: style('[data-example="Field/RowLongDescription"] [data-ov-part="help"] { display: block; -webkit-line-clamp: unset; line-clamp: unset; overflow: visible; }'),
    fault: 'a description that is not clamped: the row grows with it',
  },
  'row-message-moves': {
    section: 'rowstay',
    cases: ['Field/RowCouldNotCheck'],
    says: /row\/Field\/RowCouldNotCheck: the row moved/,
    plant: style('[data-example="Field/RowCouldNotCheck"] [data-ov-part="lane"][data-ov-kind="retry"] { height: 24px; }'),
    fault: 'a lane that is taller for one message than for the next: the row moves when the message changes',
  },
  'row-tip-missing': {
    section: 'rowtip',
    cases: ['Field/RowLongDescription'],
    says: /row\/Field\/RowLongDescription: the tooltip of a description that is cut/,
    plant: (page) => page.evaluate(() => document.querySelector('[data-example="Field/RowLongDescription"] [data-ov-part="help"]')?.removeAttribute('data-ov-clip')),
    fault: 'a description that is cut and carries no clip marker: its tooltip never shows',
  },
  'row-title-weight': {
    section: 'parity',
    cases: ['row-rest'],
    says: /parity\/row-rest\/title: font/,
    plant: style('[data-example="Field/RowDefault"] [data-ov-part="label"] { font-weight: 400; }'),
    fault: 'a row title in weight 400 where the mock has 600',
  },
  'row-unavailable-title': {
    section: 'parity',
    cases: ['row-unavailable'],
    // A text colour is also the colour of the element's border of no width (`currentcolor`), which the part reads as `border`: the one fact is told on two lines.
    says: /parity\/row-unavailable\/title: (?:color|border)/,
    plant: style('[data-example="Field/RowUnavailable"] [data-ov-part="label"] { color: var(--ov-fg); }'),
    fault: 'the title of a row that cannot change in the text colour, where the settings page keeps it muted',
  },
  'row-reset-ring': {
    section: 'parity',
    cases: ['row-reset'],
    says: /parity\/row-reset\/focus: outline/,
    plant: style('[data-example="Field/RowModified"] [data-ov-part="trailing"] > button:focus-visible { outline-offset: 2px; }'),
    fault: 'the focus ring of the Reset command outside its slot, where the row has no room beyond its end',
  },
};

// ---- the run ---------------------------------------------------------------------------------------------------------------
const SECTIONS = { parity, states, secret, keyboard, themes, axe: axeRun, row: rowGeometry, rowstay: rowStays, rowtip: rowTip };
const wants = (section) => only === null || only.test(section);
const seconds = {};
const timed = async (section, run) => {
  const start = Date.now();
  await run();
  seconds[section] = (seconds[section] ?? 0) + (Date.now() - start) / 1000;
};

async function runAll(partsUrl) {
  for (const engine of engines) {
    const browser = await launch(engine);
    for (const viewport of viewports) {
      const { page, context, errors } = await open(browser, SIZES[viewport], partsUrl);
      for (const theme of Object.keys(THEMES)) {
        const where = `${engine}@${viewport}/${theme}`;
        await setTheme(page, THEMES[theme].kit);
        if (wants('parity')) await timed('parity', () => parity(page, where, theme, engine));
        if (wants('axe')) await timed('axe', () => axeRun(page, where));
        if (SHOTS !== undefined && viewport === '1440x900') await shots(page, engine, theme);
      }

      await setTheme(page, 'void');
      const where = `${engine}@${viewport}/void`;
      for (const name of ['states', 'themes', 'secret', 'keyboard', 'row', 'rowstay', 'rowtip']) if (wants(name)) await timed(name, () => SECTIONS[name](page, where, 'void', engine));
      for (const message of errors) fail(`${engine}@${viewport}`, 'page', `error: ${message}`);
      await context.close();
    }

    await browser.close();
  }
}

async function runControl(partsUrl) {
  const control = CONTROLS[CONTROL];
  if (control === undefined) throw new Error(`no control named ${CONTROL}; the controls are ${Object.keys(CONTROLS).join(', ')}`);
  if (process.env.ASSERTION_OFF === 'says') OFF = control.says;
  const browser = await launch('chromium');
  const run = async (plant) => {
    failures.length = 0;
    const { page, context } = await open(browser, SIZES['1440x900'], partsUrl);
    await setTheme(page, 'void');
    if (plant) await control.plant(page);
    await SECTIONS[control.section](page, 'chromium@1440x900/void', 'void', 'chromium', control.cases);
    await context.close();
    return [...failures];
  };
  const clean = await run(false);
  const planted = await run(true);
  await browser.close();
  if (clean.length > 0) {
    console.log(`INVALID: ${CONTROL}: the clean run is not silent, so the control proves nothing:\n  ${clean.join('\n  ')}`);
    return 3;
  }

  // A control is valid when its fault trips the assertion it is named for and no other (exit 2 otherwise, which is not the 1 of NOT DETECTED). With that
  // assertion removed (ASSERTION_OFF=says) nothing at all may be left: the same fault passes undetected.
  const strays = planted.filter((text) => !control.says.test(text));
  if (strays.length > 0) {
    console.log(`INVALID: ${CONTROL} (${control.fault}) trips assertions it is not named for: ${strays.join(' | ')}`);
    return 2;
  }

  if (planted.length === 0) {
    console.log(`NOT DETECTED: ${CONTROL} (${control.fault}); ${control.section} said: nothing`);
    return 1;
  }

  console.log(`detected: ${CONTROL} (${control.fault}): ${planted[0]}`);
  return 0;
}

const started = Date.now();
const dist = buildUiNext();
const { server, partsUrl } = await serve(dist);
let code = 0;
try {
  if (CONTROL !== '') {
    code = await runControl(partsUrl);
  } else {
    await runAll(partsUrl);
    const unique = [...new Set(failures)];
    for (const text of unique) console.log(`FAIL ${text}`);
    const sections = Object.entries(seconds).map(([name, s]) => `${name} ${s.toFixed(1)}s`).join(', ');
    console.log(`form-probe: ${checks} checks, ${unique.length} failures (${sections}; ${((Date.now() - started) / 1000).toFixed(1)}s in all)`);
    if (REPORT !== undefined) {
      mkdirSync(REPORT, { recursive: true });
      writeFileSync(path.join(REPORT, 'form-probe.json'), `${JSON.stringify({ checks, failures: unique, seconds })}\n`);
    }

    code = unique.length === 0 ? 0 : 1;
  }
} finally {
  server.close();
}

process.exit(code);
