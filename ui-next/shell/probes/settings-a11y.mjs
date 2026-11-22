// Section `a11y` of the Settings probe: axe-core (every rule it runs by default, colour contrast included, which jsdom cannot judge) on the real Settings in a real engine, in both containers: the sheet (the open dialog, the page behind it is
// inert and is not Settings') and the Settings window's content. Zero violations of any impact.
//
//   pages     every page of the host in Void and in Light, in the sheet (at each viewport) and in the window (1060 x 640, once for an engine)
//   themes    one page, Terminal, which has a switch, a choice, a whole number, a text and a Reset, in each of the nine themes the host persists, in both containers
//   states    the page with what a row can say: an error and the host's words, a restart note, a Reset, a saved secret; and the three states of the body (loading, could not load, nothing to show), in Void and Light
//
// What axe judges is the DOM and its paint as the engine computes them, so a violation names the rule, its impact, the number of nodes and the first node's markup.
import { check, fail, goToPage, note, openFixture, openSheet, PAGES, plant, round, sleep, THEMES, WINDOW_SIZES, wants } from './settings-lib.mjs';

const enc = (value) => encodeURIComponent(JSON.stringify(value));
const ROOTS = { sheet: 'dialog[open]', window: '[data-settings-part="window"]' };
const REFERENCE_THEMES = ['void', 'light'];

async function axeOf(page, axe, selector) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: axe });
  return page.evaluate(async (context) => {
    const result = await window.axe.run(context, { resultTypes: ['violations'] });
    return result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length, first: `${violation.nodes[0]?.target.join(' ')} ${violation.nodes[0]?.html.slice(0, 120)}` }));
  }, selector);
}

const theme = (page, id) => page.evaluate((value) => document.documentElement.setAttribute('data-ov-theme', value), id);

const judge = (where, violations) => {
  check(violations.length === 0, where, 'a11y.axe', violations.map((violation) => `${violation.id} (${violation.impact}, ${violation.nodes}): ${violation.first}`).join(' | '));
  return violations.length;
};

/** Settings open in a container, on its first page. */
async function open(env, container, query = 'case=sheet') {
  if (container === 'sheet') {
    const opened = await openFixture(env, query);
    await openSheet(opened.page);
    return opened;
  }

  const opened = await openFixture(env, `case=window&request=${enc({ requestId: 1, target: '/settings?category=appearance', visible: true })}`, { viewport: WINDOW_SIZES['1060x640'] });
  await opened.page.waitForSelector('[data-settings-part="window"][data-visible="true"] [data-settings-row]', { timeout: 10_000 });
  return opened;
}

const whereOf = (env, container) => `${env.engine}@${container === 'window' ? '1060x640' : env.viewportName} ${container}`;

async function pagesPart(env, container) {
  const found = {};
  const { page, context, errors } = await open(env, container, `case=sheet&values=${enc({ 'terminal.cursorBlink': false })}`);
  try {
    await plant(env, page);
    for (const id of REFERENCE_THEMES) {
      await theme(page, id);
      for (const entry of PAGES) {
        await goToPage(page, entry.id);
        await sleep(60);
        found[`${id} ${entry.id}`] = judge(`${whereOf(env, container)} ${id} ${entry.id}`, await axeOf(page, env.axe, ROOTS[container]));
      }
    }
    for (const message of errors) fail(whereOf(env, container), 'a11y.axe', `page error: ${message}`);
    note('a11y', `pages ${whereOf(env, container)}`, found);
  } finally {
    await context.close();
  }
}

async function themesPart(env, container) {
  const found = {};
  const { page, context } = await open(env, container, `case=sheet&values=${enc({ 'terminal.cursorBlink': false })}`);
  try {
    await goToPage(page, 'terminal');
    await plant(env, page);
    for (const id of THEMES) {
      await theme(page, id);
      await sleep(80);
      found[id] = judge(`${whereOf(env, container)} theme ${id} terminal`, await axeOf(page, env.axe, ROOTS[container]));
    }
    note('a11y', `themes ${whereOf(env, container)}`, found);
  } finally {
    await context.close();
  }
}

async function statesPart(env) {
  const where = `${env.engine}@${env.viewportName} sheet`;
  // What a row can say: the host's refusal on a number, a restart note, a Reset, a secret that is saved.
  {
    const { page, context } = await open(env, 'sheet', `case=sheet&values=${enc({ 'developer.show_feature_channels': true, 'developer.marketplace_url': 'https://mkt.example.test' })}&stored=${enc({ 'telemetry.auth_value': true })}`);
    try {
      await goToPage(page, 'developer');
      await plant(env, page);
      await page.evaluate(() => {
        window.__host.next.validate = () => ({ valid: false, code: 'port_range', message: 'Enter a whole-number port from 0 to 65535.' });
      });
      const port = page.getByRole('spinbutton', { name: 'Host profiling port' });
      await port.click();
      await page.keyboard.press((await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+a' : 'Control+a');
      await page.keyboard.type('70000');
      await page.keyboard.press('Enter');
      await page.getByRole('switch', { name: 'Enable local pprof' }).click();
      await sleep(300);
      const lanes = await page.evaluate(() => [...document.querySelectorAll('[data-settings-row] [data-ov-part="lane"]')].map((lane) => lane.textContent.trim()).filter(Boolean));
      check(lanes.some((text) => /whole-number port/.test(text)) && lanes.some((text) => /restart/i.test(text)), where, 'a11y.axe', `the page for the states has the lanes ${JSON.stringify(lanes)}, wanted the host's error and a restart note`);
      for (const id of REFERENCE_THEMES) {
        await theme(page, id);
        await sleep(60);
        judge(`${where} ${id} developer with messages`, await axeOf(page, env.axe, ROOTS.sheet));
      }
      await goToPage(page, 'telemetry');
      for (const id of REFERENCE_THEMES) {
        await theme(page, id);
        await sleep(60);
        judge(`${where} ${id} telemetry with a saved secret`, await axeOf(page, env.axe, ROOTS.sheet));
      }
    } finally {
      await context.close();
    }
  }
  // The body's three states.
  for (const [label, query, ready] of [
    ['loading', 'case=sheet&host=held', '[data-settings-state="loading"]'],
    ['could not load', 'case=sheet&host=down', '[data-settings-state="failed"]'],
    ['nothing to show', 'case=sheet&host=empty', '[data-settings-state="empty"]'],
  ]) {
    const { page, context } = await openFixture(env, query);
    try {
      await page.keyboard.press((await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+Comma' : 'Control+Comma');
      await page.waitForSelector(`dialog[open] ${ready}`, { timeout: 10_000 });
      await plant(env, page);
      for (const id of REFERENCE_THEMES) {
        await theme(page, id);
        await sleep(60);
        judge(`${where} ${id} ${label}`, await axeOf(page, env.axe, ROOTS.sheet));
      }
    } finally {
      await context.close();
    }
  }
}

/** Runs the parts of the section `a11y` for one engine and viewport; the window's are run once for an engine, with the first viewport. */
export async function a11ySection(env) {
  const timed = async (part, run) => {
    const from = Date.now();
    await run();
    note('a11y', `seconds ${env.engine}@${env.viewportName} ${part}`, round((Date.now() - from) / 1000));
  };
  if (wants(env, 'pages')) {
    await timed('pages sheet', async () => pagesPart(env, 'sheet'));
    if (env.first) await timed('pages window', async () => pagesPart(env, 'window'));
  }

  if (wants(env, 'themes')) {
    await timed('themes sheet', async () => themesPart(env, 'sheet'));
    if (env.first) await timed('themes window', async () => themesPart(env, 'window'));
  }

  if (wants(env, 'states')) await timed('states', async () => statesPart(env));
}
