// Auto-generated shim for '@mui/joy/AccordionGroup'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/joy/AccordionGroup'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/joy/AccordionGroup" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const accordionGroupClasses = mod.accordionGroupClasses;
export const getAccordionGroupUtilityClass = mod.getAccordionGroupUtilityClass;

export default mod.default !== undefined ? mod.default : mod;
