// Looks at the Terminal tool in a real engine: the fixture (terminal-fixture.tsx: the real host, a synthetic shell) is built, served, opened in WebKit and Chromium, the panel is opened, a terminal is started
// and a few commands run, and what is on screen is measured and photographed. This is the tool for LOOKING (docs/ui-next/status/T1.md, "Dev tools"); terminal-probe.mjs is the one that asserts.
//
//   node ui-next/shell/probes/terminal-look.mjs                    builds the fixture (OMNIVIEW_UI=next) into a temp dir, serves it, looks in WebKit and Chromium at 1440 x 900
//   FIXTURE_DIST=<dir>   look at an existing build          ENGINES=webkit      VIEWPORT=1280x800      SHOTS=<dir>  where the screenshots go (default: a temp dir)      THEME=<id>  the theme to look in
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch } from '../../../packages/kit/probes/probe-lib.mjs';
import { serve } from '../../../packages/kit/probes/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const [width, height] = (process.env.VIEWPORT ?? '1440x900').split('x').map(Number);
const renderer = process.env.RENDERER ?? 'gpu';
const shots = process.env.SHOTS ?? mkdtempSync(path.join(os.tmpdir(), 'terminal-look-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync(shots, { recursive: true });

function build() {
  if (process.env.FIXTURE_DIST !== undefined && process.env.FIXTURE_DIST !== '') return process.env.FIXTURE_DIST;
  const out = mkdtempSync(path.join(os.tmpdir(), 'terminal-fixture-'));
  execFileSync('node', [path.join(here, 'terminal-build.mjs'), out], { cwd: repo, env: { ...process.env, OMNIVIEW_UI: 'next', NODE_ENV: 'production' }, stdio: 'pipe' });
  return out;
}

const dist = build();
const { server, url } = await serve(dist);
const origin = url.replace(/\/$/, '');
const report = {};
try {
  for (const engine of engineNames) {
    const browser = await launch(engine);
    try {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = [];
      const requests = [];
      page.on('pageerror', (error) => errors.push(error.message.slice(0, 300)));
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text().slice(0, 300)}`);
      });
      page.on('request', (request) => {
        if (/xtermEngine|addon-webgl/.test(request.url())) requests.push({ at: Date.now(), url: request.url().split('/').pop() });
      });
      await page.goto(`${origin}/shell/probes/terminal-fixture.html?renderer=${renderer}`, { waitUntil: 'load' });
      await page.waitForSelector('[data-shell-part="window"]');
      if (process.env.THEME) await page.evaluate((id) => document.documentElement.setAttribute('data-ov-theme', id), process.env.THEME);
      const before = { requests: requests.length };
      await page.click('[data-shell-part="panelToggle"]');
      await page.waitForSelector('[data-shell-part="panelEmpty"]');
      await sleep(200);
      await page.screenshot({ path: path.join(shots, `${engine}-${renderer}-${width}x${height}-empty.png`) });
      const empty = await page.evaluate(() => ({ text: document.querySelector('[data-shell-part="panelEmpty"]')?.textContent, buttons: [...document.querySelectorAll('[data-shell-part="panelEmpty"] button')].map((b) => b.textContent) }));
      const afterOpenPanel = { requests: requests.length };
      await page.click('[data-shell-part="panelEmpty"] button');
      await page.waitForSelector('.xterm', { timeout: 15000 });
      // The GPU draws on a canvas: there is no text to wait for, so it waits for the shell to have said its prompt (the page's own log of what it wrote is not it: the probe asks the shell's pty).
      const prompt = renderer === 'dom' ? await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('$'), null, { timeout: 8000 }).then(() => true, () => false) : (await sleep(1200), true);
      if (!prompt) {
        report[engine] = { stuck: await page.evaluate(() => ({ log: { created: window.__pty.log.created.length, writes: window.__pty.log.writes, resizes: window.__pty.log.resizes }, listeners: window.__pty.listenerCount(), html: document.querySelector('[data-shell-part="terminalBody"]')?.outerHTML.slice(0, 1500) ?? null, lane: document.querySelector('[data-shell-part="terminalLane"]')?.textContent })), errors, requests };
        await page.screenshot({ path: path.join(shots, `${engine}-${renderer}-${width}x${height}-stuck.png`) });
        continue;
      }
      await sleep(400);
      const type = async (text) => {
        await page.keyboard.type(text);
        await page.keyboard.press('Enter');
        await sleep(250);
      };
      await type('hello');
      await type('colors');
      await type('size');
      await sleep(300);
      await page.screenshot({ path: path.join(shots, `${engine}-${renderer}-${width}x${height}-running.png`) });
      const read = await page.evaluate(() => {
        const rect = (selector) => {
          const el = document.querySelector(selector);
          if (el === null) return null;
          const box = el.getBoundingClientRect();
          return [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 100) / 100);
        };
        const rows = document.querySelector('.xterm-rows');
        const firstRow = rows?.firstElementChild;
        const style = (selector, props) => {
          const el = document.querySelector(selector);
          if (el === null) return null;
          const computed = getComputedStyle(el);
          return Object.fromEntries(props.map((p) => [p, computed.getPropertyValue(p)]));
        };
        return {
          panel: rect('[data-shell-part="panel"]'),
          body: rect('[data-shell-part="terminalBody"]'),
          tools: rect('[data-shell-part="terminalTools"]'),
          screen: rect('[data-shell-part="terminalScreen"]'),
          xterm: rect('.xterm'),
          lane: rect('[data-shell-part="terminalLane"]'),
          laneText: document.querySelector('[data-shell-part="terminalLane"]')?.textContent ?? null,
          rowCount: rows?.children.length ?? null,
          rowHeight: firstRow instanceof HTMLElement ? firstRow.style.height : null,
          rowRect: firstRow instanceof HTMLElement ? (() => { const b = firstRow.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })() : null,
          canvases: document.querySelectorAll('.xterm canvas').length,
          activeElement: document.activeElement === null ? null : `${document.activeElement.tagName}.${document.activeElement.className}`.slice(0, 80),
          input: document.querySelector('.xterm-helper-textarea')?.getAttribute('aria-label') ?? null,
          measure: style('.xterm-char-measure-element', ['font-family', 'font-size', 'line-height']),
          swatchFont: style('[data-swatch="font"]', ['font-family', 'font-size', 'line-height']),
          background: style('[data-shell-part="terminalScreen"]', ['background-color']),
          text: (rows?.textContent ?? '').slice(0, 400),
          tabs: [...document.querySelectorAll('[data-shell-part="sessionTab"] [role="tab"], [role="tab"]')].map((t) => t.getAttribute('aria-label')).filter(Boolean),
          pty: window.__pty.log.resizes.slice(-3),
          created: window.__pty.log.created.length,
        };
      });
      report[engine] = { viewport: `${width}x${height}`, empty, read, requests: { beforeOpenPanel: before.requests, afterOpenPanel: afterOpenPanel.requests, afterNew: requests.length, list: requests }, errors, shots };
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}

console.log(JSON.stringify(report, null, 1));
