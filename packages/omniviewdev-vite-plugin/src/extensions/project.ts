import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fail, inside, SDK, type Data, type LiteralExport, type Role, type Watch } from './data';

function diagnostic(d: ts.Diagnostic): never {
  const position = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
  const where = d.file && position ? `${d.file.fileName}:${position.line + 1}:${position.character + 1}: ` : '';
  return fail(`${where}TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

/** Solution-style tsconfigs are common. Use the actual project containing the descriptor. */
export function authorConfig(root: string, descriptor: string, watch: Watch): ts.ParsedCommandLine {
  const seen = new Set<string>();
  function visit(file: string): ts.ParsedCommandLine | undefined {
    if (seen.has(file)) {
      return;
    }

    seen.add(file);
    const config = ts.getParsedCommandLineOfConfigFile(file, {}, {
      ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic,
      readFile(name) {
        watch(name); return ts.sys.readFile(name);
      },
    });
    if (!config) {
      fail('expected a readable UI TypeScript project');
    }

    if (config.errors.length) {
      diagnostic(config.errors[0]);
    }

    if (config.fileNames.includes(descriptor)) {
      return config;
    }

    for (const ref of config.projectReferences ?? []) {
      const project = visit(ts.resolveProjectReferencePath(ref));
      if (project) {
        return project;
      }
    }
  }

  const project = visit(path.join(root, 'tsconfig.json'));
  if (!project) {
    fail('tsconfig.json: src/extension.ts must be included in the checked project');
  }

  const options = project.options;
  if (!options.strict || options.strictNullChecks === false || options.strictFunctionTypes === false || options.noImplicitAny === false ||
      !options.exactOptionalPropertyTypes || options.noCheck === true || (options.noEmit !== true && options.noEmitOnError !== true)) {
    fail('tsconfig.json: require strict, strictNullChecks, strictFunctionTypes, noImplicitAny, exactOptionalPropertyTypes and checked emit (noEmit or noEmitOnError)');
  }

  return project;
}

/** A declared type is not proof of a value. Check that it describes precisely the independently collected literal. */
function literalType(checker: ts.TypeChecker, type: ts.Type, value: Data, anchor: ts.Node, field: string): void {
  const mismatch = () => fail(`${field}: expected an exact literal declaration matching the JavaScript value`);
  if (typeof value === 'string' || typeof value === 'number') {
    if (!(type.isStringLiteral() || type.isNumberLiteral()) || type.value !== value) {
      mismatch();
    }

    return;
  }

  if (typeof value === 'boolean') {
    if (!(type.flags & ts.TypeFlags.BooleanLiteral) || checker.typeToString(type) !== String(value)) {
      mismatch();
    }

    return;
  }

  if (Array.isArray(value)) {
    if (!checker.isTupleType(type)) {
      return mismatch();
    }

    const tuple = type as ts.TupleTypeReference;
    const members = checker.getTypeArguments(tuple);
    if (members.length !== value.length || tuple.target.elementFlags.some(flag => flag !== ts.ElementFlags.Required)) {
      mismatch();
    }

    members.forEach((member, i) => {
      literalType(checker, member, value[i], anchor, `${field}[${i}]`);
    });
    return;
  }

  if (!(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) || checker.getIndexInfosOfType(type).length ||
      type.getCallSignatures().length || type.getConstructSignatures().length) {
    mismatch();
  }

  const props = checker.getPropertiesOfType(type);
  if (props.length !== Object.keys(value).length) {
    mismatch();
  }

  for (const prop of props) {
    if ((prop.flags & (ts.SymbolFlags.Optional | ts.SymbolFlags.Accessor)) || !Object.hasOwn(value, prop.name)) {
      mismatch();
    }

    literalType(checker, checker.getTypeOfSymbolAtLocation(prop, anchor), value[prop.name], anchor, `${field}.${prop.name}`);
  }
}

function signatureChecks(roles: readonly Role[]): string {
  if (!roles.length) {
    return 'export {};';
  }

  const lines = [
    'import type descriptor from \'./extension.js\';',
    'type Fits<T extends true> = T;',
    'type IsAny<T> = 0 extends 1 & T ? true : false;',
  ];
  let i = 0;
  for (const role of roles) {
    const view = role.source === 'views.tsx';
    if (view) {
      lines.push('import type * as views from \'./views.js\';', `import type {ViewProps} from '${SDK}';`, 'import type {ReactElement} from \'react\';');
    } else {
      lines.push('import type * as features from \'./features.js\';', `import type {OfferInput, OfferResult} from '${SDK}';`,
        'type ExactResult<R, E> = R extends unknown ? Exclude<keyof R, keyof E> extends never ? true : false : never;');
    }

    for (const name of role.names) {
      const key = JSON.stringify(name);
      const offer = `O${i}`, impl = `F${i}`, result = `R${i}`;
      lines.push(`type ${offer} = typeof descriptor.offers[${key}];`,
        `type ${impl} = typeof ${view ? 'views' : 'features'}[${key}];`,
        `export type Callable${i} = Fits<IsAny<${impl}> extends true ? false : ${impl} extends ${view
          ? `(props: ViewProps<${offer}>) => ReactElement | null`
          : `(input: OfferInput<${offer}>, signal: AbortSignal) => OfferResult<${offer}> | PromiseLike<OfferResult<${offer}>>`} ? true : false>;`,
        `type ${result} = ${view ? `ReturnType<${impl}>` : `Awaited<ReturnType<${impl}>>`};`,
        `export type Result${i} = Fits<IsAny<${result}> extends true ? false : ${view ? 'true' : `ExactResult<${result}, OfferResult<${offer}>>`}>;`);
      i++;
    }
  }

  return lines.join('\n');
}

export function checkAuthor(root: string, config: ts.ParsedCommandLine, proofs: readonly LiteralExport[], roles: readonly Role[], watch: Watch): ts.Program {
  const file = path.join(root, 'src/__omniview_extensions_v1_checks__.ts');
  if (existsSync(file)) {
    fail('reserved compiler check filename already exists');
  }

  const source = signatureChecks(roles);
  const options = { ...config.options, noEmit: true };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  host.readFile = name => name === file ? source : read(name);
  host.fileExists = name => name === file || exists(name);
  const get = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, ...rest) => name === file
    ? ts.createSourceFile(name, source, language, true)
    : get(name, language, ...rest);
  const program = ts.createProgram({ rootNames: [...config.fileNames, file], options, host, projectReferences: config.projectReferences });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    diagnostic(diagnostics[0]);
  }

  for (const sf of program.getSourceFiles()) {
    if (sf.fileName === file || sf.isDeclarationFile || !inside(root, sf.fileName) || sf.fileName.split(path.sep).includes('node_modules')) {
      continue;
    }

    watch(sf.fileName);
    if (/^\s*(?:\/\/\/?|\/\*+|\*)\s*@ts-(?:ignore|nocheck|expect-error)\b/m.test(sf.text)) {
      fail(`${sf.fileName}: unchecked TypeScript directives are not allowed`);
    }
  }

  const checker = program.getTypeChecker();
  for (const proof of proofs) {
    const sf = program.getSourceFile(proof.file) ?? program.getSourceFiles().find(s => existsSync(s.fileName) && realpathSync(s.fileName) === proof.file);
    const mod = sf && checker.getSymbolAtLocation(sf);
    const symbol = mod && checker.getExportsOfModule(mod).find(s => s.name === proof.name);
    if (!sf || !symbol) {
      fail(`${proof.name}: expected a public named value declaration`);
    }

    const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    if (!(resolved.flags & ts.SymbolFlags.Value)) {
      fail(`${proof.name}: expected a value export`);
    }

    watch(sf.fileName);
    if (resolved.valueDeclaration) {
      watch(resolved.valueDeclaration.getSourceFile().fileName);
    }

    literalType(checker, checker.getTypeOfSymbolAtLocation(resolved, resolved.valueDeclaration ?? sf), proof.value, sf, proof.name);
  }

  return program;
}
