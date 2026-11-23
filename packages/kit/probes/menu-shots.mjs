// Capture real menu interactions on the built ui-next parts page. Build the kit first.
//   DIST=<existing ui-next build> SHOTS_DIR=<output> ENGINE=webkit node packages/kit/probes/menu-shots.mjs
// Omit DIST to build ui-next here; ENGINE defaults to WebKit, SHOTS_DIR to a new temporary directory.
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { awaitFonts, launch, VIEWPORTS } from './probe-lib.mjs';
import { buildUiNext, serve } from './serve.mjs';

const out = process.env.SHOTS_DIR ?? mkdtempSync(path.join(os.tmpdir(), 'menu-shots-'));
const engine = process.env.ENGINE ?? 'webkit';
const viewport = VIEWPORTS['1440x900'];
const targets = [
  { file: 'workspace-overflow', example: 'WorkspaceOverflow', trigger: 'Workspace actions', item: 'Create folder…' },
  { file: 'terminal-targets', example: 'TerminalTargets', trigger: 'Terminal targets', item: 'SSM session', above: true },
  { file: 'tab-context', example: 'TabContext', trigger: 'Connections', item: 'Duplicate tab', context: true },
  { file: 'connection-actions', example: 'ConnectionActions', trigger: 'Actions for prod-eu', item: 'Remove connection…' },
  { file: 'view-options', example: 'ViewOptions', trigger: 'View options', item: 'Most recent', role: 'menuitemradio' },
  { file: 'virtual-rows-20000', example: 'VirtualRows', trigger: 'Actions for worker-1', item: 'Inspect' },
];

async function save(page, figure, name, panels) {
  await page.waitForFunction((count) => {
    const open = [...document.querySelectorAll('[data-ov-menu-popup]:popover-open')];
    return open.length === count && open.every((menu) => menu.hasAttribute('data-ov-side'));
  }, panels, { timeout: 5000 });
  // The popup lives in the top layer, not inside the figure. Crop their union in the viewport, keeping room for the popup shadow.
  const clip = await figure.evaluate((element) => {
    const boxes = [...element.children, ...document.querySelectorAll('[data-ov-menu-popup]')].map((child) => child.getBoundingClientRect());
    const padding = 16;
    const x = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.left)) - padding));
    const y = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.top)) - padding));
    const right = Math.min(window.innerWidth, Math.ceil(Math.max(...boxes.map((box) => box.right)) + padding));
    const bottom = Math.min(window.innerHeight, Math.ceil(Math.max(...boxes.map((box) => box.bottom)) + padding));
    return { x, y, width: right - x, height: bottom - y };
  });
  const file = path.join(out, `${engine}-${name}.png`);
  await page.screenshot({ path: file, clip });
  console.log(file);
}

mkdirSync(out, { recursive: true });
const { server, partsUrl } = await serve(buildUiNext());
try {
  const browser = await launch(engine);
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    await page.goto(partsUrl);
    await page.locator('[data-example="Menu/WorkspaceOverflow"]').waitFor();
    await awaitFonts(page);
    for (const target of targets) {
      const figure = page.locator(`[data-example="Menu/${target.example}"]`);
      const trigger = figure.getByRole('button', { name: target.trigger, exact: true });
      await trigger.evaluate((button, block) => button.scrollIntoView({ block }), target.above ? 'end' : 'center');
      await trigger.click({ button: target.context ? 'right' : 'left' });
      await page.getByRole(target.role ?? 'menuitem', { name: target.item, exact: true }).waitFor({ timeout: 5000 });
      await save(page, figure, target.file, 1);
      if (target.example === 'TerminalTargets') {
        await page.keyboard.press('End');
        await page.keyboard.press('ArrowRight');
        await page.getByRole('menuitem', { name: 'app', exact: true }).waitFor({ timeout: 5000 });
        await save(page, figure, 'terminal-submenu', 2);
        await page.keyboard.press('Escape');
      }
      await page.keyboard.press('Escape');
      await page.locator('[data-ov-menu-popup]').first().waitFor({ state: 'detached', timeout: 5000 });
    }
  } finally {
    await browser.close();
  }
} finally {
  server.close();
}
