// Auto-generated shim for '@omniviewdev/runtime/models'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/runtime/models'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/runtime/models" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const config = mod.config;
export const exec = mod.exec;
export const logs = mod.logs;
export const main = mod.main;
export const networker = mod.networker;
export const plugin = mod.plugin;
export const registry = mod.registry;
export const settings = mod.settings;
export const trivy = mod.trivy;
export const types = mod.types;
export const ui = mod.ui;
export const utils = mod.utils;

export default mod.default !== undefined ? mod.default : mod;
