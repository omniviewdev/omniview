// Auto-generated shim for 'yaml'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['yaml'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "yaml" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const Alias = mod.Alias;
export const CST = mod.CST;
export const Composer = mod.Composer;
export const Document = mod.Document;
export const Lexer = mod.Lexer;
export const LineCounter = mod.LineCounter;
export const Pair = mod.Pair;
export const Parser = mod.Parser;
export const Scalar = mod.Scalar;
export const Schema = mod.Schema;
export const YAMLError = mod.YAMLError;
export const YAMLMap = mod.YAMLMap;
export const YAMLParseError = mod.YAMLParseError;
export const YAMLSeq = mod.YAMLSeq;
export const YAMLWarning = mod.YAMLWarning;
export const isAlias = mod.isAlias;
export const isCollection = mod.isCollection;
export const isDocument = mod.isDocument;
export const isMap = mod.isMap;
export const isNode = mod.isNode;
export const isPair = mod.isPair;
export const isScalar = mod.isScalar;
export const isSeq = mod.isSeq;
export const parse = mod.parse;
export const parseAllDocuments = mod.parseAllDocuments;
export const parseDocument = mod.parseDocument;
export const stringify = mod.stringify;
export const visit = mod.visit;
export const visitAsync = mod.visitAsync;

export default mod.default !== undefined ? mod.default : mod;
