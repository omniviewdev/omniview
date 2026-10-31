#!/usr/bin/env node
// Extract real react-icons SVG markup for a static prototype.
//
//   node extract-react-icons.mjs --react-icons <react-icons package dir> --out icons.js SiKubernetes LuPlus fa6/FaGithub
//
// The pack is derived from the name prefix (SiKubernetes -> si, LuPlus -> lu,
// FaGithub -> fa). Packs whose exports share a prefix (fa6, hi2, io5) need an
// explicit `pack/Name`. Writes `window.ICONS = {...};`.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function usage(message) {
  console.error(`${message}\nUsage: node extract-react-icons.mjs --react-icons <dir> --out <file> <IconName|pack/IconName>...`);
  process.exit(2);
}

const args = process.argv.slice(2);
let root;
let out;
const names = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--react-icons') root = args[++i];
  else if (args[i] === '--out') out = args[++i];
  else if (args[i].startsWith('--')) usage(`Unknown option: ${args[i]}`);
  else names.push(args[i]);
}
if (!root || !out || names.length === 0) usage('Missing --react-icons, --out or icon names.');

const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const kebab = (key) => (key === 'viewBox' ? key : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));

function toSvg(node, isRoot = false) {
  const attr = { ...node.attr };
  if (isRoot && attr.fill === undefined) attr.fill = 'currentColor';
  const attrs = Object.entries(attr).map(([k, v]) => ` ${kebab(k)}="${escapeAttr(v)}"`).join('');
  const children = (node.child || []).map((child) => toSvg(child)).join('');
  return `<${node.tag}${attrs}>${children}</${node.tag}>`;
}

const sources = new Map();
function packSource(pack) {
  if (!sources.has(pack)) {
    const file = join(root, pack, 'index.mjs');
    try {
      sources.set(pack, readFileSync(file, 'utf8'));
    } catch (error) {
      console.error(`Cannot read react-icons pack "${pack}" at ${file}: ${error.code || error.message}`);
      process.exit(1);
    }
  }
  return sources.get(pack);
}

const icons = {};
const missing = [];
for (const spec of names) {
  const [explicitPack, name] = spec.includes('/') ? spec.split('/', 2) : [undefined, spec];
  const prefix = /^[A-Z][a-z]*/.exec(name);
  if (!prefix) usage(`Not a react-icons export name: ${spec}`);
  const pack = explicitPack || prefix[0].toLowerCase();
  const match = new RegExp(`function ${name} \\(props\\) \\{\\s*return GenIcon\\((\\{.*?\\})\\)\\(props\\);`, 's')
    .exec(packSource(pack));
  if (!match) {
    missing.push(`${name} (pack ${pack})`);
    continue;
  }
  icons[name] = toSvg(JSON.parse(match[1]), true);
}
if (missing.length) {
  console.error(`Icons not found: ${missing.join(', ')}`);
  process.exit(1);
}

const body = Object.entries(icons).map(([name, svg]) => `${JSON.stringify(name)}: ${JSON.stringify(svg)}`).join(',\n');
writeFileSync(out, `window.ICONS = {\n${body},\n};\n`);
console.log(`Wrote ${Object.keys(icons).length} icons to ${out}`);
