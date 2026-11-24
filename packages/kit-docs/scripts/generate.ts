import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { COLOR_ROLE_GROUPS, TOKEN_PREFIX } from '../../kit/tokens/manifest.ts';
import {
  DEFAULT_DENSITY, DEFAULT_TEXT_SIZE, DEFAULT_THEME_ID, DENSITIES, TEXT_SIZES, THEMES, TOKEN_NAMES,
} from '../../kit/src/generated/tokenNames.ts';
import { guidance } from '../content/catalog.ts';
import { exampleSources, kitInputs, type ExampleSource, type SourceFile } from './exampleSources.ts';

const docs = resolve(fileURLToPath(new URL('..', import.meta.url)));
const kit = resolve(docs, '../kit');
const output = join(docs, 'public');
const git = (...args: string[]) => execFileSync('git', args, { cwd: docs, encoding: 'utf8' }).trim();
// Pin links to the latest commit that changed Kit, not the moving docs branch HEAD.
const revision = git('log', '-1', '--format=%H', '--', '../kit');
if (!revision) throw new Error('Kit revision not found in repository history');
const sourceRoot = `https://github.com/omniviewdev/omniview/blob/${revision}/packages/kit`;
const source = (path: string, line?: number) => `${sourceRoot}/${path}${line === undefined ? '' : `#L${line}`}`;
const readKit = (path: string) => readFileSync(join(kit, path), 'utf8');
const codeFence = (code: string, language = 'ts') => `\`\`\`${language}\n${code.trimEnd()}\n\`\`\``;
const read = (path: string) => ts.createSourceFile(path, readKit(path), ts.ScriptTarget.Latest, true);
const names = (values: readonly string[]) => values.map((value) => `\`${value}\``).join(', ');

function assertCleanKit() {
  const changed = git('diff', '--name-only', 'HEAD', '--', '../kit');
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', '../kit');
  if (changed || untracked) {
    const details = [changed, untracked].filter(Boolean).join('\n');
    throw new Error(`Commit or restore Kit changes before generating revision-pinned docs.\n${details}`);
  }
}

function publicParts() {
  return read('src/index.ts').statements.flatMap((statement) => {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    const path = statement.moduleSpecifier.text;
    return path.startsWith('./components/') ? [basename(path)] : [];
  });
}

function barrelExports(path: string) {
  return read(path).statements.flatMap((statement) => {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
      throw new Error(`Expected named exports in ${path}`);
    }
    return statement.exportClause.elements.map(({ name }) => name.text);
  });
}

function apiDeclarations(report: string) {
  const match = /^```ts\n([\s\S]*?)^```\s*$/m.exec(report.replaceAll('\r\n', '\n'));
  if (!match?.[1]) throw new Error('Kit API report is missing its TypeScript block');
  const ast = ts.createSourceFile('kit-api.ts', match[1], ts.ScriptTarget.Latest);
  const entries = new Map<string, string[]>();
  const locals = new Map<string, string>();
  for (const statement of ast.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause) || statement.moduleSpecifier) {
        throw new Error(`Unsupported API re-export: ${statement.getText(ast)}`);
      }
      for (const { name, propertyName } of statement.exportClause.elements) {
        const local = locals.get((propertyName ?? name).text);
        if (!local) throw new Error(`Missing local declaration for public export ${name.text}`);
        entries.set(name.text, [local, statement.getText(ast)]);
      }
      continue;
    }
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
    const identifiers = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.map(({ name }) => name)
      : ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
        || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)
        ? [statement.name]
        : [undefined];
    for (const identifier of identifiers) {
      if (!identifier || !ts.isIdentifier(identifier)) {
        if (exported) throw new Error(`Unsupported API report declaration: ${statement.getText(ast)}`);
        continue;
      }
      const declaration = statement.getText(ast);
      if (exported) {
        entries.set(identifier.text, [...(entries.get(identifier.text) ?? []), declaration]);
      } else {
        locals.set(identifier.text, declaration);
      }
    }
  }
  return entries;
}

const appExample = `import { MenuHost, Stack, Text, ThemeProvider } from '@omniviewdev/kit';
import '@omniviewdev/kit/styles.css';

export function App() {
  return (
    <ThemeProvider>
      <MenuHost>
        <Stack gap={8}>
          <Text>Preferences</Text>
        </Stack>
      </MenuHost>
    </ThemeProvider>
  );
}`;

function stylingGuide() {
  const path = 'src/styles/layers.css';
  const layers = /^@layer (.+);$/m.exec(readKit(path))?.[1];
  if (!layers) throw new Error(`No layer order found in ${path}`);
  return `# Styling Kit\n\nLoad the stylesheet once from the host entry. Mount one ThemeProvider per document. In an Omniview plugin, use the host's stylesheet and provider rather than mounting your own.\n\n${codeFence(appExample, 'tsx')}\n\n## Theme, density and text size\n\nThemeProvider controls the document through data attributes, not inline overrides. The theme defaults to \`${DEFAULT_THEME_ID}\`. An unknown theme ID falls back to that default; \`useTheme().isFallback\` reports the fallback.\n\n- Themes: ${names(THEMES.map(({ id }) => id))}.\n- Densities: ${names(DENSITIES)} (default: \`${DEFAULT_DENSITY}\`).\n- Text sizes: ${names(TEXT_SIZES)} (default: \`${DEFAULT_TEXT_SIZE}\`).\n\n## Compose without restyling Kit internals\n\nUse public component props for visual variants. Use [tokens](tokens.md) for your own layout and semantic colors. Do not write Kit tokens onto the document root or target Kit's private CSS Module classes. In TypeScript, \`tokenVar\` accepts only names in the public \`TokenName\` type.\n\nKit declares this [layer order](${source(path)}), from lowest to highest precedence: ${names(layers.split(', '))}. Host-wrapped plugin styles belong in \`ov.plugin\`, below Kit's own parts.\n\n${codeFence(`@layer ov.plugin {
  .pane {
    padding: var(--ov-spacing-12);
    background: var(--ov-bg-island);
    color: var(--ov-fg);
  }
}`, 'css')}\n\n[Theme provider source](${source('src/theme/ThemeProvider.tsx')}) · [Full public API](api.md)\n`;
}

function tokenArtifacts() {
  const colorGroups = Object.entries(COLOR_ROLE_GROUPS).map(([name, roles]) => ({
    name,
    kind: 'color',
    tokens: roles.map((role) => `${TOKEN_PREFIX}${role}`),
  }));
  const colorTokens = new Set(colorGroups.flatMap(({ tokens }) => tokens));
  const other = { name: 'scales-and-other-roles', kind: 'other', tokens: TOKEN_NAMES.filter((token) => !colorTokens.has(token)) };
  const bullets = (tokens: readonly string[]) => tokens.map((token) => `- \`${token}\``).join('\n');
  const colors = colorGroups.map(({ name, tokens }) => `### ${name}\n\n${bullets(tokens)}`).join('\n\n');
  return {
    markdown: `# Kit token index\n\nUse these custom properties with \`var(...)\` in CSS. Their values can depend on theme, density or text size. See the [styling guide](styling.md) for setup or download the [machine-readable token index](tokens.json).\n\n## Scales and other roles\n\n${bullets(other.tokens)}\n\n## Color roles\n\n${colors}\n\n[Token manifest](${source('tokens/manifest.ts')}) · [Generated token list](${source('src/generated/tokenNames.ts')})\n`,
    json: JSON.stringify({ revision, tokens: TOKEN_NAMES, groups: [other, ...colorGroups] }, null, 2) + '\n',
  };
}

function typecheck(bundles: ReadonlyMap<string, SourceFile[]>) {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  for (const [name, bundle] of bundles) {
    const directory = join(docs, 'content', '.copyable', name);
    for (let path = directory; path !== docs; path = dirname(path)) directories.add(path);
    for (const file of bundle) files.set(join(directory, file.name), file.code);
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    exactOptionalPropertyTypes: true,
    noUnusedLocals: true,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    noUncheckedSideEffectImports: true,
    skipLibCheck: true,
    noEmit: true,
    types: ['vite/client'],
  };
  const host = ts.createCompilerHost(options);
  const { directoryExists, fileExists, readFile, getSourceFile } = host;
  host.getCurrentDirectory = () => docs;
  host.directoryExists = (path) => directories.has(path) || directoryExists?.(path) === true;
  host.fileExists = (path) => files.has(path) || fileExists(path);
  host.readFile = (path) => files.get(path) ?? readFile(path);
  host.getSourceFile = (path, target, onError, fresh) => {
    const code = files.get(path);
    return code === undefined ? getSourceFile(path, target, onError, fresh) : ts.createSourceFile(path, code, target);
  };
  const roots = [...files.keys()].filter((path) => !path.endsWith('.css'));
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(roots, options, host));
  if (diagnostics.length) {
    throw new Error(`Copyable examples failed typecheck (build @omniviewdev/kit first):\n${ts.formatDiagnosticsWithColorAndContext(diagnostics, host)}`);
  }
}

function generate(check: boolean) {
  assertCleanKit();
  const report = readKit('api/kit.api.md');
  const api = apiDeclarations(report);
  const files = new Map<string, string>();
  const snippets = new Map<string, SourceFile[]>([['styling', [{ name: 'App.tsx', code: appExample }]]]);
  const parts = publicParts();
  const revisionPath = `revisions/${revision}`;
  const foundations = join(docs, 'content', 'foundations.tsx');
  const examples = exampleSources([
    ...kitInputs(kit),
    { group: 'Stack', path: foundations, exportName: 'StackDefault', name: 'Default' },
    { group: 'Text', path: foundations, exportName: 'TextDefault', name: 'Default' },
  ], kit);
  const parityParents: Record<string, string> = { DataTableParity: 'DataTable', LogViewParity: 'LogView' };
  const examplesByPart = new Map(parts.map((part) => [part, [] as ExampleSource[]]));
  const examplePath = ({ group, name }: ExampleSource) => `examples/${group}/${name}.json`;
  for (const example of examples) {
    const owner = parityParents[example.group] ?? example.group;
    const list = examplesByPart.get(owner);
    if (!list) throw new Error(`Example group ${example.group} has no public component`);
    const path = examplePath(example);
    if (files.has(path)) throw new Error(`Duplicate example ${example.group}.${example.name}`);
    list.push(example);
    snippets.set(`${example.group}.${example.name}`, example.files);
    files.set(path, JSON.stringify({ files: example.files }, null, 2) + '\n');
  }
  for (const [group, part] of Object.entries(parityParents)) {
    if (!examplesByPart.get(part)?.some((example) => example.group === group)) {
      throw new Error(`Missing parity examples for ${part}`);
    }
  }
  for (const part of Object.keys(guidance)) {
    if (!examplesByPart.has(part)) throw new Error(`Guidance has no public component: ${part}`);
  }
  const curated: Record<string, string> = {
    Button: 'Primary',
    Chip: 'WithCount',
    IconButton: 'Secondary',
    MissingValue: 'WithReason',
    TextInput: 'Idle',
    Toggle: 'Idle',
  };
  const page = (part: string) => `components/${part.toLowerCase()}.md`;
  const pinned = `Kit source revision: [\`${revision}\`](https://github.com/omniviewdev/omniview/tree/${revision}/packages/kit).`;
  const catalogue = (prefix: string) => JSON.stringify({
    revision,
    parts: Object.fromEntries([...examplesByPart].map(([part, list]) => [
      part,
      { examples: list.map((example) => ({ group: example.group, name: example.name, source: `${prefix}${examplePath(example)}` })) },
    ])),
  }, null, 2) + '\n';

  for (const part of parts) {
    const barrel = `src/components/${part}/index.ts`;
    const exports = barrelExports(barrel);
    const declarations = exports.flatMap((name) => {
      const entry = api.get(name);
      if (!entry) throw new Error(`Public export ${name} is missing from the Kit API report`);
      return entry;
    });
    const guide = guidance[part];
    if (!guide) throw new Error(`Missing guidance for public component ${part}`);
    const list = examplesByPart.get(part) ?? [];
    const regular = list.filter(({ group }) => group === part);
    const preferred = curated[part] ?? (regular.some(({ name }) => name === 'Default') ? 'Default' : regular[0]?.name);
    const primary = regular.find(({ name }) => name === preferred);
    if (!primary) throw new Error(`Missing copyable example for ${part}${preferred ? `.${preferred}` : ''}`);
    const location = (example: ExampleSource) => {
      const bundle = `../${examplePath(example)}`;
      if (example.path === foundations) return `[${example.name}](${bundle})`;
      const url = source(relative(kit, example.path), example.line);
      return `[${example.name}](${url}) · [Copyable files](${bundle})`;
    };
    const lines = [
      `# ${part}`,
      pinned,
      guide.summary,
      `## Usage\n\n${guide.guidance.map((line) => `- ${line}`).join('\n')}`,
    ];
    if (guide.tokens.length) {
      lines.push(`## Tokens\n\n${guide.tokens.map(({ name, label, property }) => `- \`${name}\` — ${label} (\`${property}\`)`).join('\n')}`);
    }
    lines.push(`## Copyable example: ${primary.name}\n\nUse the [styling setup](../styling.md).${primary.files.length > 1 ? ' Save these files in the same directory.' : ''}\n\n${primary.files.map(({ name, code }) => `\`${name}\`\n\n${codeFence(code, name.split('.').at(-1))}`).join('\n\n')}\n\n[Download example bundle](../${examplePath(primary)})`);
    lines.push(`## Public API\n\nImport ${names(exports)} from \`@omniviewdev/kit\`. This declaration excerpt is for reference; see the [full API report](../api.md) for referenced types.\n\n${codeFence(declarations.join('\n\n'))}\n\n[Public exports source](${source(barrel)})`);
    lines.push(`## Examples\n\n${list.map((example) => `- ${location(example)}${example.group !== part ? ' (parity)' : ''}`).join('\n')}`);
    files.set(page(part), `${lines.join('\n\n')}\n`);
  }

  typecheck(snippets);
  const index = (prefix: string) => `# Omniview Kit\n\n> Public components, styling and typed examples for @omniviewdev/kit.\n\n${pinned}\n\n## Reference\n\n- [Styling guide](${prefix}styling.md): stylesheet, theme provider and cascade.\n- [Token index](${prefix}tokens.md): CSS custom property names.\n- [Machine-readable tokens](${prefix}tokens.json): token names and groups.\n- [Public API report](${prefix}api.md): exact exported declarations.\n- [Machine-readable example catalog](${prefix}catalog.json): component groups and copyable source bundles.\n\n## Components\n\n${parts.map((part) => `- [${part}](${prefix}${page(part)})`).join('\n')}\n`;
  const tokens = tokenArtifacts();
  files.set('llms.txt', index(''));
  files.set('styling.md', stylingGuide());
  files.set('tokens.md', tokens.markdown);
  files.set('tokens.json', tokens.json);
  files.set('api.md', report);

  files.set('catalog.json', catalogue(''));
  const stale: string[] = [];
  for (const directory of ['components', 'examples']) {
    const path = join(output, revisionPath, directory);
    if (!existsSync(path)) continue;
    const extension = directory === 'components' ? '.md' : '.json';
    for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(extension)) continue;
      const artifact = relative(join(output, revisionPath), join(entry.parentPath, entry.name));
      if (!files.has(artifact)) stale.push(`${revisionPath}/${artifact}`);
    }
  }
  const outputs = [...files].map(([path, text]): [string, string] => [`${revisionPath}/${path}`, text]);
  outputs.push(['llms.txt', index(`${revisionPath}/`)]);
  outputs.push(['catalog.json', catalogue(`${revisionPath}/`)]);
  for (const [path, text] of outputs) {
    const target = join(output, path);
    if (existsSync(target) && readFileSync(target, 'utf8') === text) continue;
    if (check) {
      stale.push(path);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
  }
  if (check && stale.length) throw new Error(`Generated docs differ. Run node scripts/generate.ts.\n${stale.join('\n')}`);
  for (const path of stale) rmSync(join(output, path));
  console.log(`${check ? 'Checked' : 'Generated'} ${outputs.length} Kit docs at ${revision.slice(0, 12)}; typechecked ${examples.length} example bundles and styling setup.`);
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  throw new Error('Usage: node scripts/generate.ts [--check]');
}
generate(args[0] === '--check');
