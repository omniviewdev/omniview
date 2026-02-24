// Auto-generated shim for '@omniviewdev/ui/typography'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/typography'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/typography" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const CodeBlock = mod.CodeBlock;
export const CodeInline = mod.CodeInline;
export const Heading = mod.Heading;
export const Link = mod.Link;
export const Text = mod.Text;

export default mod.default !== undefined ? mod.default : mod;
