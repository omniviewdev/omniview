/**
 * Emits declarations for the curated entries into `<dist>/ui-v1/`, without the legacy barrel (tsconfig.ui-v1.json).
 * Managed builds can stage `<dist>` elsewhere, in the same directory the Vite build writes to. Declaration errors fail the build.
 */
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(path.resolve(root, process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY || 'dist'), 'ui-v1');

const configPath = path.join(root, 'tsconfig.ui-v1.json');
const read = ts.readConfigFile(configPath, ts.sys.readFile);
if (read.error !== undefined) {
  throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
}

const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, { outDir, rootDir: path.join(root, 'src') }, configPath);
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const emitted = program.emit();
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics];
if (diagnostics.length > 0 || emitted.emitSkipped) {
  throw new Error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (name) => name, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
}

console.log(`ui/v1 declarations: ${String(program.getSourceFiles().filter((file) => !file.isDeclarationFile).length)} files into ${path.relative(root, outDir)}/`);
