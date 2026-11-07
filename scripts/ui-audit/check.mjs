import ts from 'typescript';
import postcss from 'postcss';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const controls = new Set(['input', 'select', 'textarea', 'button']);
const guidance = 'Use @omniviewdev/base-ui Input, Select, Textarea, or Button; report a library gap instead of rebuilding controls.';
const forbidden = /^(?:@mui\/|@emotion\/|@material-ui\/|@omniviewdev\/ui(?:\/|$))/;
const sourceExtension = /\.(?:[cm]?[jt]sx?|css)$/i;

export function isUIFile(file) {
  return sourceExtension.test(file) && !/(?:^|\/)(?:node_modules|dist|build|coverage|__tests__|__fixtures__|generated|bindings)(?:\/|$)/.test(file)
    && !/(?:\.(?:test|spec|stories|story|generated|bundle)|\.d)\.[^.]+$/.test(file)
    && !/^(?:packages\/(?:base-ui|ai-ui|editors|omniviewdev-ui)\/|ui\/providers\/monaco\/.*\.worker\.)/.test(file);
}

function inspect(file, text) {
  const findings = [];
  const add = (rule, line, message, identity) => findings.push({ rule, file, line, message, identity });
  if (file.endsWith('.css')) {
    try {
      const css = postcss.parse(text, { from: file });
      css.walkDecls('all', decl => {
        if (decl.value.trim().toLowerCase() !== 'unset') return;
        const selector = decl.parent?.selector ?? '';
        // Class names only count when they explicitly name a control, not arbitrary layout classes.
        if (/(?:\b(?:input|select|textarea|button)\b|[.#][\w-]*(?:Button|Input|Select|Textarea|Control|Trigger|ActionBtn)\b)/.test(selector)) {
          add('control-reset', decl.source.start.line, `Do not reset control styling with all: unset. ${guidance}`, `${selector}:all:unset`);
        }
      });
    } catch (error) {
      add('parse-error', error.line ?? 1, `Cannot parse CSS: ${error.reason ?? error.message}`, '');
    }
    return findings;
  }
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx?$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  for (const diagnostic of source.parseDiagnostics) {
    add('parse-error', source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
      `Cannot parse source: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`, '');
  }
  const host = {
    getSourceFile: name => name === file ? source : undefined,
    getDefaultLibFileName: () => '', writeFile() {}, getCurrentDirectory: () => '',
    getDirectories: () => [], fileExists: name => name === file,
    readFile: name => name === file ? text : undefined,
    getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  };
  const checker = ts.createProgram([file], { noResolve: true, noLib: true, allowJs: true, jsx: ts.JsxEmit.Preserve }, host).getTypeChecker();
  const literal = node => node && (ts.isStringLiteralLike(node) ? node.text : ts.isJsxExpression(node) ? literal(node.expression) : undefined);
  const key = node => node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) ? node.text : undefined;
  const assignments = new Map();
  function indexAssignments(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      const symbol = checker.getSymbolAtLocation(node.left);
      if (symbol) {
        const values = assignments.get(symbol) ?? [];
        values.push(node);
        assignments.set(symbol, values);
      }
    }
    ts.forEachChild(node, indexAssignments);
  }
  indexAssignments(source);
  function executionScope(node) {
    while (node.parent && !ts.isFunctionLike(node) && !ts.isSourceFile(node)) node = node.parent;
    return node;
  }
  function statementContainer(node) {
    while (node.parent && !ts.isStatement(node)) node = node.parent;
    return node.parent;
  }
  function provenance(node, seen = new Set()) {
    if (!node || seen.has(node)) return undefined;
    seen.add(node);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return provenance(node.expression, seen);
    if (ts.isPropertyAccessExpression(node)) {
      const parent = provenance(node.expression, seen);
      return parent ? `${parent}.${node.name.text}` : undefined;
    }
    if (ts.isElementAccessExpression(node)) {
      const parent = provenance(node.expression, seen);
      const member = literal(node.argumentExpression);
      return parent && member ? `${parent}.${member}` : undefined;
    }
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = checker.getSymbolAtLocation(node);
    for (const declaration of symbol?.declarations ?? []) {
      if (ts.isImportSpecifier(declaration)) {
        const module = declaration.parent.parent.parent.moduleSpecifier;
        return `${literal(module)}.${(declaration.propertyName ?? declaration.name).text}`;
      }
      if (ts.isNamespaceImport(declaration)) return literal(declaration.parent.parent.moduleSpecifier);
      if (ts.isImportClause(declaration) && declaration.name?.text === node.text) {
        return literal(declaration.parent.moduleSpecifier);
      }
      if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
        const variable = declaration.parent.parent;
        if (ts.isVariableDeclaration(variable)) {
          const parent = provenance(variable.initializer, seen);
          if (parent) return `${parent}.${key(declaration.propertyName ?? declaration.name)}`;
        }
      }
      if (ts.isVariableDeclaration(declaration)) {
        const writes = (assignments.get(symbol) ?? []).filter(write =>
          write.getStart(source) < node.getStart(source) && executionScope(write) === executionScope(node));
        if (!writes.length) return provenance(declaration.initializer, seen);
        const latest = writes.at(-1);
        if (writes.every(write => ts.isExpressionStatement(write.parent) && statementContainer(write) === statementContainer(node))) {
          return provenance(latest.right, seen);
        }
        // Branch-dependent writes cannot be proven to be the effective value. Require review
        // only if an actual React binding is one of the possible values.
        const values = [declaration.initializer, ...writes.map(write => write.right)]
          .map(value => provenance(value, new Set(seen)));
        if (values.some(value => value === 'react.createElement' || value === 'react.createElement:ambiguous')) return 'react.createElement:ambiguous';
        return undefined;
      }
    }
    return undefined;
  }
  const emit = (rule, node, message, identity = node.getText(source)) => add(rule,
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message, identity.replace(/\s+/g, ' '));
  function resolveObject(node, seen = new Set()) {
    if (!node || seen.has(node)) return undefined;
    seen.add(node);
    if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return resolveObject(node.expression, seen);
    if (ts.isObjectLiteralExpression(node)) return node;
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = checker.getSymbolAtLocation(node);
    if (assignments.has(symbol)) return undefined;
    for (const declaration of symbol?.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent)
        && declaration.parent.flags & ts.NodeFlags.Const) return resolveObject(declaration.initializer, seen);
    }
    return undefined;
  }
  function expandedProps(properties, seen = new Set()) {
    const effective = new Map();
    for (const property of properties) {
      if (seen.has(property)) continue;
      const nextSeen = new Set(seen).add(property);
      if (ts.isJsxSpreadAttribute(property) || ts.isSpreadAssignment(property)) {
        const object = resolveObject(property.expression);
        if (object) {
          for (const [name, value] of expandedProps(object.properties, nextSeen)) effective.set(name, value);
        }
      } else {
        const name = key(property.name);
        if (name) effective.set(name, property);
      }
    }
    return effective;
  }
  function inspectProps(properties) {
    for (const [name, property] of expandedProps(properties)) {
      const value = ts.isJsxAttribute(property) ? literal(property.initializer) : ts.isPropertyAssignment(property) ? literal(property.initializer) : undefined;
      if (name === 'type' && value === 'datetime-local') emit('native-datetime', property,
        'Native datetime-local lacks the shared temporal UX. Use the library temporal picker or report the missing picker.');
      if (name === 'style') {
        const object = resolveObject(property.initializer);
        if (object) {
          for (const entry of expandedProps(object.properties).values()) {
            if (ts.isPropertyAssignment(entry) && key(entry.name) === 'all' && literal(entry.initializer) === 'unset') {
              emit('control-reset', entry, `Do not reset control styling with all: unset. ${guidance}`);
            }
          }
        }
      }
    }
  }
  function visit(node) {
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const module = node.moduleReference.expression;
      if (literal(module) && forbidden.test(literal(module))) emit('legacy-ui-import', module, 'Replace legacy UI dependency with @omniviewdev/base-ui.');
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && literal(node.moduleSpecifier) && forbidden.test(literal(node.moduleSpecifier))) {
      emit('legacy-ui-import', node.moduleSpecifier, 'Legacy UI packages are not shared with plugins. Import @omniviewdev/base-ui (or its ai-ui/editors entrypoints).');
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require' && !checker.getSymbolAtLocation(node.expression))) {
      if (literal(node.arguments[0]) && forbidden.test(literal(node.arguments[0]))) emit('legacy-ui-import', node.arguments[0], 'Replace legacy UI dependency with @omniviewdev/base-ui.');
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const native = ts.isIdentifier(node.tagName) && controls.has(node.tagName.text);
      if (native) emit('native-control', node.tagName, guidance);
      if (native || provenance(node.tagName)?.startsWith('@omniviewdev/base-ui.')) {
        inspectProps(node.attributes.properties);
      }
    }
    if (ts.isCallExpression(node) && ['react.createElement', 'react.createElement:ambiguous'].includes(provenance(node.expression))) {
      const native = controls.has(literal(node.arguments[0]));
      if (native && provenance(node.expression) === 'react.createElement:ambiguous') {
        emit('ambiguous-react-control', node, `A branch-dependent alias may call React.createElement for a native control. Resolve its binding for review. ${guidance}`);
      } else if (native) emit('native-control', node.arguments[0], guidance);
      const props = resolveObject(node.arguments[1]);
      if (props) {
        if (native || provenance(node.arguments[0])?.startsWith('@omniviewdev/base-ui.')) inspectProps(props.properties);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return findings;
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
}

function resolveBase(root, options = {}) {
  const explicit = Object.hasOwn(options, 'base');
  const base = explicit ? options.base : 'HEAD';
  if (typeof base !== 'string' || !base || base.includes('\0')) throw new Error('Audit base must be a nonempty Git revision');
  try {
    return git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  } catch (error) {
    // Only the implicit HEAD may be absent in a temporary fixture or unborn repository.
    if (!explicit && /not a git repository|Needed a single revision|unknown revision|bad revision|ambiguous argument/i.test(String(error.stderr))) return null;
    throw new Error(`Cannot resolve audit base ${base}: ${String(error.stderr || error.message).trim()}`);
  }
}

export async function changedFiles(root, options = {}) {
  const base = resolveBase(root, options);
  // Separate commands avoid newline quoting and include staged, unstaged, and untracked files.
  const tracked = git(root, ['diff', '--name-only', '-z', base ?? '--cached', '--diff-filter=ACMR']);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  return [...new Set(`${tracked}\0${untracked}`.split('\0').filter(Boolean))].filter(isUIFile).sort();
}

export async function checkFiles(root, files, options = {}) {
  root = await realpath(root);
  const base = resolveBase(root, options);
  const results = [];
  for (const input of [...new Set(files)].sort()) {
    if (typeof input !== 'string' || input.includes('\0') || path.isAbsolute(input)) throw new Error(`Unsafe audit path: ${input}`);
    const file = input.split(path.sep).join('/');
    const absolute = path.resolve(root, input);
    if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) throw new Error(`Audit path escapes root: ${input}`);
    if (!isUIFile(file)) continue;
    const resolved = await realpath(absolute);
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Audit symlink escapes root: ${input}`);
    const current = inspect(file, await readFile(resolved, 'utf8'));
    const counts = new Map();
    if (base) {
      const tracked = git(root, ['ls-tree', '-z', base, '--', file]);
      if (tracked) {
        const baseline = inspect(file, git(root, ['show', `${base}:${file}`]));
        for (const finding of baseline) {
          if (finding.rule === 'parse-error') continue;
          const signature = `${finding.rule}\0${finding.identity}`;
          counts.set(signature, (counts.get(signature) ?? 0) + 1);
        }
      }
    }
    for (const finding of current) {
      const signature = `${finding.rule}\0${finding.identity}`;
      const count = counts.get(signature) ?? 0;
      if (finding.rule !== 'parse-error' && count > 0) counts.set(signature, count - 1);
      else results.push(finding);
    }
  }
  return results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
}

async function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  const index = args.indexOf('--root');
  if (index !== -1) {
    if (!args[index + 1]) throw new Error('--root requires a path');
    root = path.resolve(args[index + 1]);
    args.splice(index, 2);
  }
  const options = {};
  const baseIndex = args.indexOf('--base');
  if (baseIndex !== -1) {
    if (!args[baseIndex + 1] || args[baseIndex + 1].startsWith('--')) throw new Error('--base requires a revision');
    options.base = args[baseIndex + 1];
    args.splice(baseIndex, 2);
  } else if (process.env.GITHUB_BASE_REF) {
    const ref = `refs/remotes/origin/${process.env.GITHUB_BASE_REF}`;
    try {
      options.base = git(root, ['merge-base', 'HEAD', ref]).trim();
      if (!options.base) throw new Error('merge-base returned no revision');
    } catch (error) {
      throw new Error(`Cannot determine GitHub PR audit base ${ref}: ${String(error.stderr || error.message).trim()}`);
    }
  }
  if (args.some(arg => arg.startsWith('--'))) throw new Error('Unknown audit option');
  const findings = await checkFiles(root, args.length ? args : await changedFiles(root, options), options);
  for (const finding of findings) console.error(`${finding.file}:${finding.line} ${finding.rule}: ${finding.message}`);
  if (findings.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`UI audit failed: ${error.message}`); process.exitCode = 1; });
}
