/**
 * generate-shims.ts
 *
 * Generates .mjs shim files in the shims/ directory. Each shim file
 * re-exports a shared dependency from window.__OMNIVIEW_SHARED__.
 *
 * Run: pnpm --filter @omniviewdev/vite-plugin generate-shims
 *   or: npx tsx scripts/generate-shims.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHIMS_DIR = path.resolve(__dirname, '..', 'shims');

// Import from source directly (tsx handles it)
import { SHARED_PACKAGES } from '../src/sharedPackages';
import { safeFilename } from '../src/safeFilename';

/**
 * Known named exports for critical packages. These are generated with
 * explicit export statements for maximum compatibility.
 */
const KNOWN_EXPORTS: Record<string, string[]> = {
  'react': [
    'Children', 'Component', 'Fragment', 'Profiler', 'PureComponent',
    'StrictMode', 'Suspense', '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
    'act', 'cloneElement', 'createContext', 'createElement', 'createFactory',
    'createRef', 'forwardRef', 'isValidElement', 'lazy', 'memo',
    'startTransition', 'unstable_act', 'useCallback', 'useContext',
    'useDebugValue', 'useDeferredValue', 'useEffect', 'useId',
    'useImperativeHandle', 'useInsertionEffect', 'useLayoutEffect', 'useMemo',
    'useReducer', 'useRef', 'useState', 'useSyncExternalStore', 'useTransition',
    'version',
  ],
  'react/jsx-runtime': [
    'Fragment', 'jsx', 'jsxs',
  ],
  'react-dom': [
    'createPortal', 'flushSync', 'hydrate', 'render', 'unmountComponentAtNode',
    'unstable_batchedUpdates', 'unstable_renderSubtreeIntoContainer', 'version',
  ],
  'react-router-dom': [
    'BrowserRouter', 'HashRouter', 'Link', 'MemoryRouter', 'NavLink',
    'Navigate', 'Outlet', 'Route', 'Router', 'Routes', 'ScrollRestoration',
    'UNSAFE_DataRouterContext', 'UNSAFE_DataRouterStateContext',
    'UNSAFE_LocationContext', 'UNSAFE_NavigationContext', 'UNSAFE_RouteContext',
    'createBrowserRouter', 'createHashRouter', 'createMemoryRouter',
    'createPath', 'createRoutesFromChildren', 'createRoutesFromElements',
    'createSearchParams', 'generatePath', 'isRouteErrorResponse',
    'matchPath', 'matchRoutes', 'parsePath', 'redirect', 'renderMatches',
    'resolvePath', 'unstable_useBlocker', 'useActionData', 'useFetcher',
    'useFetchers', 'useFormAction', 'useHref', 'useInRouterContext',
    'useLinkClickHandler', 'useLoaderData', 'useLocation', 'useMatch',
    'useMatches', 'useNavigate', 'useNavigation', 'useNavigationType',
    'useOutlet', 'useOutletContext', 'useParams', 'useResolvedPath',
    'useRevalidator', 'useRouteError', 'useRouteLoaderData', 'useRoutes',
    'useSearchParams', 'useSubmit',
  ],
};

/**
 * Generate a shim file for a package with known named exports.
 */
function generateExplicitShim(packageName: string, exports: string[]): string {
  const lines: string[] = [
    `// Auto-generated shim for '${packageName}'`,
    `// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims`,
    ``,
    `const mod = window.__OMNIVIEW_SHARED__['${packageName}'];`,
    ``,
    `if (!mod) {`,
    `  throw new Error(`,
    `    '[omniview] Shared dependency "${packageName}" is not available on window.__OMNIVIEW_SHARED__. ' +`,
    `    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'`,
    `  );`,
    `}`,
    ``,
  ];

  for (const name of exports) {
    lines.push(`export const ${name} = mod.${name};`);
  }

  lines.push(``);
  lines.push(`export default mod.default !== undefined ? mod.default : mod;`);

  return lines.join('\n') + '\n';
}

/**
 * Generate a generic shim for a package where we do not know the exact exports.
 */
function generateGenericShim(packageName: string): string {
  const lines: string[] = [
    `// Auto-generated shim for '${packageName}'`,
    `// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims`,
    ``,
    `const mod = window.__OMNIVIEW_SHARED__['${packageName}'];`,
    ``,
    `if (!mod) {`,
    `  throw new Error(`,
    `    '[omniview] Shared dependency "${packageName}" is not available on window.__OMNIVIEW_SHARED__. ' +`,
    `    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'`,
    `  );`,
    `}`,
    ``,
    `// Default export: prefer mod.default, fall back to the module namespace itself.`,
    `export default mod.default !== undefined ? mod.default : mod;`,
  ];

  return lines.join('\n') + '\n';
}

/**
 * Attempt to dynamically import a package and return its named export keys.
 * Falls back to KNOWN_EXPORTS or empty array on failure.
 */
async function discoverExports(packageName: string): Promise<string[]> {
  // Use hardcoded list if available
  if (KNOWN_EXPORTS[packageName]) {
    return KNOWN_EXPORTS[packageName];
  }

  try {
    const mod = await import(packageName);
    const keys = Object.keys(mod).filter(
      (k) => k !== 'default' && k !== '__esModule' && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)
    );
    return keys;
  } catch {
    // Package can't be imported at generation time (e.g. native module, missing peer dep)
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Ensure shims directory exists
  if (!fs.existsSync(SHIMS_DIR)) {
    fs.mkdirSync(SHIMS_DIR, { recursive: true });
  }

  // Clean existing shims
  const existingFiles = fs.readdirSync(SHIMS_DIR).filter(f => f.endsWith('.mjs'));
  for (const file of existingFiles) {
    fs.unlinkSync(path.join(SHIMS_DIR, file));
  }

  let generated = 0;
  let autoDiscovered = 0;

  for (const pkg of SHARED_PACKAGES) {
    const filename = safeFilename(pkg) + '.mjs';
    const filepath = path.join(SHIMS_DIR, filename);

    const exports = await discoverExports(pkg);
    let content: string;
    if (exports.length > 0) {
      content = generateExplicitShim(pkg, exports);
      if (!KNOWN_EXPORTS[pkg]) autoDiscovered++;
    } else {
      content = generateGenericShim(pkg);
    }

    fs.writeFileSync(filepath, content, 'utf-8');
    generated++;
  }

  console.log(`Generated ${generated} shim files in ${SHIMS_DIR} (${autoDiscovered} auto-discovered)`);
}

main();
