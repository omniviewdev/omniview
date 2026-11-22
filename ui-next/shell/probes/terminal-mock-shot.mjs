// Photographs the design mock's Terminal tool (read-only) in WebKit and Chromium, in the states the host's look script (terminal-look.mjs) photographs the host's: the empty tool and a running shell after `echo hello`, `ls` and
// `pwd`. The mock is served from a CommonJS copy of its server.js with `root` set to the mock directory (see mock-panel-measure.mjs); the mock itself is never written to.
//
//   node ui-next/shell/probes/terminal-mock-shot.mjs      MOCK_DIR=<dir>  ENGINES=webkit  VIEWPORT=1280x800  SHOTS=<dir>  THEME=<id>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENGINES, launch } from '../../../packages/kit/probes/probe-lib.mjs';

const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const [width, height] = (process.env.VIEWPORT ?? '1440x900').split('x').map(Number);
const shots = process.env.SHOTS ?? mkdtempSync(path.join(tmpdir(), 'terminal-mock-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync(shots, { recursive: true });

const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-terminal-')), 'server.cjs');
writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
const server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: '49481' }, stdio: 'ignore' });
await sleep(1500);
try {
  for (const engine of engineNames) {
    const browser = await launch(engine);
    try {
      const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US', timezoneId: 'UTC' });
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:49481/', { waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.Shell?.panel?.show === 'function');
      await sleep(800);
      if (process.env.THEME) await page.evaluate((id) => document.documentElement.setAttribute('data-theme', id), process.env.THEME);
      await page.evaluate(() => window.Shell.panel.show('terminal'));
      await sleep(400);
      await page.screenshot({ path: path.join(shots, `mock-${engine}-${width}x${height}-empty.png`) });
      await page.evaluate(async () => {
        const targets = window.Shell.panel.targets.list('terminal').find((group) => group.plugin === 'host').targets;
        const id = window.Shell.panel.terminal.open(targets.find((target) => target.id === 'local/zsh'));
        window.Shell.panel.sessions.rename(id, 'zsh');
        for (let i = 0; i < 100 && window.Shell.panel.sessions.get(id)?.state !== 'running'; i += 1) await new Promise((r) => setTimeout(r, 50));
        await new Promise((r) => setTimeout(r, 500));
        for (const line of ['echo hello', 'ls', 'pwd']) {
          await window.Shell.panel.terminal.run(id, line);
          await new Promise((r) => setTimeout(r, 500));
        }
      });
      await sleep(600);
      await page.screenshot({ path: path.join(shots, `mock-${engine}-${width}x${height}-running.png`) });
      console.log(JSON.stringify({ engine, shots }));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
