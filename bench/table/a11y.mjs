// Step 1 of the decision rule (docs/ui-next/status/1a.3.md): the accessibility veto, per candidate and engine.
//
//   AXE=/path/to/axe.min.js node bench/table/a11y.mjs [--variants s,a,r] [--dist bench/table/.dist-matrix --no-build]
//
// "A candidate is out in an engine if, in that engine, its accessibility tree (Playwright aria snapshot in both engines, plus the engine's own
//  tree through CDP in Chromium) does not expose a table with its row count, rows, column headers with their sort state, and cells; or if rows
//  become Tab stops; or if axe-core reports a serious or critical issue."
// What is read, on the real Pod rows (5,025) with the narrow row's real cells:
//   snapshot   Playwright's `locator.ariaSnapshot()` of the region: a table, row, columnheader and cell roles; the names of the headers
//   attributes `aria-rowcount` on the table, `aria-rowindex` on the header row and a mounted row, `aria-sort` on the Name header (the page's own
//              markup: what the engine is given; the snapshot and the tree are what it makes of it)
//   cdp        Chromium only: the full accessibility tree; the roles of the table's nodes and the sort of the header
//   tabstops   `tabIndex` of every mounted row and cell, and the first ten elements Tab reaches (Alt+Tab as well, which is what WebKit on macOS
//              needs to reach buttons): none may be a row
//   axe        axe-core over the region: the violations of impact serious or critical
// A candidate passes in an engine when every one of these holds. The raw readings are in the output so that a failure can be argued.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ENGINES, buildPage, ensureCorpus, environment, here, openPage, pageIdentity, serve } from './lib.mjs';

const { values: args } = parseArgs({ options: { variants: { type: 'string', default: 's,a,r' }, dist: { type: 'string' }, 'no-build': { type: 'boolean', default: false }, tag: { type: 'string', default: 'a11y' } } });
const AXE = process.env.AXE ?? '/tmp/axe-core/node_modules/axe-core/axe.min.js';
const dist = path.resolve(args.dist ?? path.join(here, '.dist-normal'));
if (!args['no-build']) {
  buildPage({ react: 'normal', dist });
}

ensureCorpus();
const kit = pageIdentity(dist);
const server = await serve(dist);
const out = path.join(here, 'results', args.tag);
mkdirSync(out, { recursive: true });
const result = { kit, environment: null };

/** Read the page's own markup that carries the semantics. */
const readAttributes = () => {
  const region = document.querySelector('[data-bench-scroller]');
  const table = region?.querySelector('table, [role=table]');
  const header = table?.querySelector('thead tr, [role=row]');
  const nameHeader = [...(table?.querySelectorAll('th, [role=columnheader]') ?? [])].find((cell) => cell.textContent?.startsWith('Name'));
  const row = table?.querySelector('tbody tr[data-ov-index], tbody tr[data-index]');
  const rows = [...(table?.querySelectorAll('tbody tr[data-ov-index], tbody tr[data-index]') ?? [])];
  const cells = [...(table?.querySelectorAll('tbody td') ?? [])];
  return {
    tableTag: table?.tagName ?? null,
    tableRole: table?.getAttribute('role') ?? null,
    ariaRowcount: table?.getAttribute('aria-rowcount') ?? null,
    headerRowIndex: header?.getAttribute('aria-rowindex') ?? null,
    firstRowIndex: row?.getAttribute('aria-rowindex') ?? null,
    nameHeaderTag: nameHeader?.tagName ?? null,
    nameHeaderRole: nameHeader?.getAttribute('role') ?? null,
    nameHeaderSort: nameHeader?.getAttribute('aria-sort') ?? null,
    mountedRows: rows.length,
    rowTabIndexes: [...new Set(rows.map((element) => element.tabIndex))],
    rowTabindexAttributes: rows.filter((element) => element.hasAttribute('tabindex')).length,
    cellTabindexAttributes: cells.filter((element) => element.hasAttribute('tabindex')).length,
    regionTabIndex: region?.tabIndex ?? null,
  };
};

async function tabStops(page) {
  const stops = [];
  for (const key of ['Tab', 'Alt+Tab']) {
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        active.blur();
      }

      window.scrollTo(0, 0);
    });
    await page.mouse.move(2, 2);
    const seen = [];
    for (let press = 0; press < 10; press += 1) {
      await page.keyboard.press(key);
      seen.push(await page.evaluate(() => {
        const element = document.activeElement;
        return element === null || element === document.body ? 'body' : `${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[role=${element.getAttribute('role')}]` : ''}${element.getAttribute('aria-label') ? `"${element.getAttribute('aria-label')}"` : ''}`;
      }));
    }

    stops.push({ key, seen });
  }

  return stops;
}

/** The roles of the nodes the engine's own tree holds below the table (Chromium). */
async function chromiumTree(cdp) {
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const named = (role) => nodes.filter((node) => node.role?.value === role && !node.ignored);
  const table = named('table')[0];
  const sortOf = (node) => node?.properties?.find((property) => property.name === 'sort')?.value?.value ?? null;
  const headers = named('columnheader');
  const nameHeader = headers.find((node) => node.name?.value?.startsWith('Name'));
  return {
    roles: Object.fromEntries(['table', 'rowgroup', 'row', 'columnheader', 'cell', 'gridcell', 'rowheader', 'generic'].map((role) => [role, named(role).length])),
    tableName: table?.name?.value ?? null,
    tableProperties: table?.properties?.map((property) => `${property.name}=${JSON.stringify(property.value?.value)}`) ?? null,
    columnHeaders: headers.map((node) => node.name?.value),
    nameHeaderProperties: nameHeader?.properties?.map((property) => `${property.name}=${JSON.stringify(property.value?.value)}`) ?? null,
    nameHeaderSort: sortOf(nameHeader),
  };
}

for (const engine of Object.keys(ENGINES)) {
  const browser = await ENGINES[engine].launch();
  result[engine] = {};
  result.environment ??= environment({ [engine]: browser.version() });
  for (const variant of args.variants.split(',')) {
    const { context, page, cdp, problems } = await openPage(browser, `${server.url}?variant=${variant}&rows=5025&cells=real`);
    const entry = { variant, problems };
    entry.attributes = await page.evaluate(readAttributes);
    entry.snapshot = await page.locator('[data-bench-scroller]').ariaSnapshot();
    const lines = entry.snapshot.split('\n');
    const count = (role) => lines.filter((line) => new RegExp(`^\\s*- ${role}\\b`).test(line)).length;
    entry.snapshotRoles = Object.fromEntries(['table', 'rowgroup', 'row', 'columnheader', 'cell', 'checkbox', 'button'].map((role) => [role, count(role)]));
    entry.snapshotNameHeader = lines.find((line) => /columnheader "Name/.test(line)) ?? null;
    if (cdp !== undefined) {
      entry.cdp = await chromiumTree(cdp);
    }

    entry.tabStops = await tabStops(page);
    await page.addScriptTag({ path: AXE });
    const axe = await page.evaluate(async () => {
      const run = await window.axe.run('[data-bench-scroller]');
      return {
        version: window.axe.version,
        violations: run.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length, help: violation.help })),
        passes: run.passes.length,
        incomplete: run.incomplete.map((item) => item.id),
      };
    });
    entry.axe = axe;

    // The decision of the rule's step 1.
    const a = entry.attributes;
    const failures = [];
    const rowsExposed = entry.snapshotRoles.row > 1 && entry.snapshotRoles.columnheader >= 5 && entry.snapshotRoles.cell >= 5;
    if (entry.snapshotRoles.table < 1) failures.push('snapshot: no table role');
    if (!rowsExposed) failures.push(`snapshot: rows ${entry.snapshotRoles.row}, columnheaders ${entry.snapshotRoles.columnheader}, cells ${entry.snapshotRoles.cell}`);
    if (a.ariaRowcount !== '5026') failures.push(`aria-rowcount ${a.ariaRowcount}`);
    if (a.nameHeaderSort !== 'ascending') failures.push(`aria-sort on Name ${a.nameHeaderSort}`);
    if (a.rowTabIndexes.some((index) => index >= 0) || a.rowTabindexAttributes > 0 || a.cellTabindexAttributes > 0) failures.push('rows or cells carry a tabindex');
    if (entry.tabStops.some((pass) => pass.seen.some((seen) => seen.startsWith('tr') || seen.includes('[role=row]')))) failures.push('a row is a Tab stop');
    if (entry.cdp !== undefined && (entry.cdp.roles.table < 1 || entry.cdp.roles.row < 2 || entry.cdp.roles.columnheader < 5 || entry.cdp.roles.cell + entry.cdp.roles.gridcell < 5)) failures.push(`chromium tree: ${JSON.stringify(entry.cdp.roles)}`);
    const serious = axe.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
    if (serious.length > 0) failures.push(`axe: ${serious.map((violation) => `${violation.id} (${violation.impact})`).join(', ')}`);
    entry.failures = failures;
    entry.pass = failures.length === 0;
    result[engine][variant] = entry;
    process.stdout.write(`${engine} ${variant}: ${entry.pass ? 'pass' : `FAIL ${failures.join('; ')}`}  roles ${JSON.stringify(entry.snapshotRoles)}  axe ${axe.violations.length} violations (${serious.length} serious or critical)\n`);
    await context.close();
  }

  await browser.close();
}

await server.close();
writeFileSync(path.join(out, 'a11y.json'), `${JSON.stringify(result, null, 2)}\n`);
