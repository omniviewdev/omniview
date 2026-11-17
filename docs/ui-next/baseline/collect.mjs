#!/usr/bin/env node
// Collects the N8 baseline numbers into JSON and Markdown. No harness code: it reads files the existing tools wrote.
//
//   node docs/ui-next/baseline/collect.mjs bytes <dist-dir> <label> [out.json]   bundle bytes of one Vite build
//   node docs/ui-next/baseline/collect.mjs report <raw-dir> <out.md-fragment>    tables from the bench result files
//
// `bytes` expects a build made with `--sourcemap hidden` (maps are only read for the contributor table and are not counted).
// Sizes: raw bytes, gzip level 9, brotli quality 11. Contributors: generated UTF-16 code units attributed to the source
// module's package through the source map, so they are measured on the same bytes (minified or not) as the chunk.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [mode, ...args] = process.argv.slice(2);

const gzip = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const brotli = (buf) => zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Int8Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

/** Decodes a source map `mappings` string into per generated line arrays of [column, sourceIndex | -1]. */
function decodeColumns(mappings) {
  const lines = [];
  let line = [];
  let value = 0;
  let shift = 0;
  const fields = [];
  const flush = () => {
    if (fields.length) {
      line.push([fields[0], fields.length >= 4 ? fields[1] : -1]);
      fields.length = 0;
    }
  };
  let column = 0;
  let src = 0;
  const takeField = (v) => {
    const i = fields.length;
    if (i === 0) { column += v; fields.push(column); }
    else if (i === 1) { src += v; fields.push(src); }
    else fields.push(v);
  };
  for (let i = 0; i < mappings.length; i++) {
    const c = mappings.charCodeAt(i);
    if (c === 59) { flush(); lines.push(line); line = []; column = 0; continue; } // ;
    if (c === 44) { flush(); continue; } // ,
    const digit = B64_INDEX[c];
    value += (digit & 31) << shift;
    if (digit & 32) { shift += 5; continue; }
    const negative = value & 1;
    value >>>= 1;
    takeField(negative ? -value : value);
    value = 0;
    shift = 0;
  }
  flush();
  lines.push(line);
  return lines;
}

function packageOf(source) {
  const marker = 'node_modules/';
  const at = source.lastIndexOf(marker);
  if (at !== -1) {
    const rest = source.slice(at + marker.length).split('/');
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  if (source.startsWith('\0') || source.includes('\0')) return '(vite/rollup virtual)';
  const parts = source.replace(/^(\.\.\/)+/, '').split('/');
  if (parts[0] === 'packages') return `packages/${parts[1]}`;
  return parts[0] || '(unknown)';
}

function contributors(file) {
  const map = JSON.parse(fs.readFileSync(`${file}.map`, 'utf8'));
  const code = fs.readFileSync(file, 'utf8').split('\n');
  const lines = decodeColumns(map.mappings);
  const totals = new Map();
  const add = (key, n) => totals.set(key, (totals.get(key) ?? 0) + n);
  const owner = map.sources.map((s) => {
    if (s.includes('\0')) return packageOf(s);
    const absolute = path.resolve(path.dirname(file), s.replaceAll('\\', '/'));
    const relative = path.relative(process.cwd(), absolute);
    return packageOf(relative.startsWith('..') ? absolute : relative);
  });
  for (let l = 0; l < code.length; l++) {
    const segs = lines[l] ?? [];
    const length = code[l].length + 1; // + newline
    if (!segs.length) { add('(unmapped)', length); continue; }
    if (segs[0][0] > 0) add('(unmapped)', segs[0][0]);
    for (let i = 0; i < segs.length; i++) {
      const start = segs[i][0];
      const end = i + 1 < segs.length ? segs[i + 1][0] : length;
      add(segs[i][1] === -1 ? '(unmapped)' : owner[segs[i][1]], Math.max(0, end - start));
    }
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name, chars]) => ({ name, chars, share: chars / sum }));
}

function bytes(dist, label, out) {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!entry.name.endsWith('.map')) files.push(full);
    }
  };
  walk(dist);
  const stat = (file) => {
    const buf = fs.readFileSync(file);
    return { file: path.relative(dist, file), raw: buf.length, gzip: gzip(buf), brotli: brotli(buf) };
  };
  const kind = (f) => (f.endsWith('.js') || f.endsWith('.mjs') ? 'js' : f.endsWith('.css') ? 'css' : 'other');
  const totals = {};
  for (const f of files) {
    const k = kind(f);
    totals[k] ??= { files: 0, raw: 0 };
    totals[k].files += 1;
    totals[k].raw += fs.statSync(f).size;
  }
  const entries = scripts.map((s) => path.join(dist, s.replace(/^\//, '')));
  const result = {
    label,
    entry: entries.map((f) => ({ ...stat(f), top5: fs.existsSync(`${f}.map`) ? contributors(f).slice(0, 5) : null })),
    eagerPreloads: preloads.map((s) => stat(path.join(dist, s.replace(/^\//, '')))),
    css: files.filter((f) => kind(f) === 'css').map(stat).sort((a, b) => b.raw - a.raw).slice(0, 3),
    totals,
    largestJs: files.filter((f) => kind(f) === 'js').map((f) => ({ file: path.relative(dist, f), raw: fs.statSync(f).size })).sort((a, b) => b.raw - a.raw).slice(0, 5),
  };
  const text = JSON.stringify(result, null, 2);
  if (out) fs.writeFileSync(out, `${text}\n`);
  else console.log(text);
}

const median = (values) => {
  const s = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const fmt = (v) => (v == null ? '-' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
/** "median [min-max]"; a trailing `~` marks a range wider than 25% of the median (noisy at this sample count). */
function cell(values) {
  const s = values.filter((v) => typeof v === 'number');
  if (!s.length) return '-';
  const m = median(s);
  const min = Math.min(...s);
  const max = Math.max(...s);
  const wide = m > 0 && (max - min) / m > 0.25 ? ' ~' : '';
  return `${fmt(m)} [${fmt(min)}-${fmt(max)}]${wide}`;
}

const VARIANTS = [
  ['normal-off', 'app-normal-minify-off'],
  ['normal-on', 'app-normal-minify-on'],
  ['prof-off', 'app-profiling-minify-off'],
  ['prof-on', 'app-profiling-minify-on'],
];
const METRICS = [
  ['readyMs', 'interactive'],
  ['pluginReadyMs', 'plugin home shown'],
  ['wallMs', 'wall'],
  ['taskMs', 'main thread busy'],
  ['scriptMs', 'script'],
  ['layoutStyleMs', 'layout + style'],
  ['blockingMs', 'TBT'],
  ['longTasks', 'long tasks'],
  ['heapMB', 'heap MB'],
];

function report(dir) {
  const results = VARIANTS.map(([, file]) => JSON.parse(fs.readFileSync(path.join(dir, `${file}.json`), 'utf8')));
  const out = [];
  const scenarios = Object.keys(results[0].results);
  for (const scenario of scenarios) {
    const stepsOf = (run) => {
      const nested = Object.entries(run).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && 'taskMs' in v);
      return nested.length ? nested : [[scenario, run]];
    };
    const stepNames = stepsOf(results[0].results[scenario][0]).map(([name]) => name);
    for (const step of stepNames) {
      const rows = [];
      for (const [key, label] of METRICS) {
        const columns = results.map((r) => r.results[scenario].map((run) => {
          const metrics = stepsOf(run).find(([name]) => name === step)?.[1];
          if (!metrics) return null;
          return key === 'layoutStyleMs' ? (metrics.layoutMs ?? 0) + (metrics.styleMs ?? 0) : metrics[key];
        }));
        if (columns.every((values) => values.every((v) => v == null))) continue;
        rows.push(`| ${label} | ${columns.map(cell).join(' | ')} |`);
      }
      out.push(`**${scenario}${step === scenario ? '' : ` / ${step}`}** (ms unless noted; median [min-max] of ${results[0].results[scenario].length} runs)`, '', `| metric | ${VARIANTS.map(([name]) => name).join(' | ')} |`, `|---|${VARIANTS.map(() => '--:').join('|')}|`, ...rows, '');
    }
  }
  return out.join('\n');
}

/** One row per render benchmark: median, p99 and sample count of each pass. */
function renderTable(rawDir, passes) {
  const byPass = passes.map((pass) => {
    const data = JSON.parse(fs.readFileSync(path.join(rawDir, pass, 'render.json'), 'utf8'));
    const rows = new Map();
    for (const file of data.testResults) {
      for (const test of file.assertionResults) {
        const group = test.ancestorTitles.join(' > ') || path.basename(file.name);
        for (const benchmark of test.benchmarks ?? []) {
          for (const task of benchmark.tasks) rows.set(`${group} | ${task.name}`, task.latency);
        }
      }
    }
    return rows;
  });
  const header = passes.flatMap((pass) => [`${pass} median`, `${pass} p99`, `${pass} n`]);
  const out = [`| scenario | bench | ${header.join(' | ')} |`, `|---|---|${header.map(() => '--:').join('|')}|`];
  for (const key of byPass[0].keys()) {
    const cells = byPass.flatMap((rows) => {
      const l = rows.get(key);
      return l ? [fmt(l.p50), fmt(l.p99), String(l.samplesCount)] : ['-', '-', '-'];
    });
    out.push(`| ${key} | ${cells.join(' | ')} |`);
  }
  return out.join('\n');
}

if (mode === 'report') {
  const passes = fs.readdirSync(args[0]).filter((name) => /^pass\d+$/.test(name)).sort();
  const text = [
    ...passes.flatMap((pass) => [`#### App benchmark, ${pass}`, '', report(path.join(args[0], pass))]),
    '#### Render benchmark (ms)', '', renderTable(args[0], passes),
  ].join('\n');
  if (args[1]) fs.writeFileSync(args[1], `${text}\n`);
  else console.log(text);
} else
if (mode === 'bytes') bytes(args[0], args[1], args[2]);
else {
  console.error('usage: collect.mjs bytes <dist-dir> <label> [out.json]');
  process.exit(2);
}
