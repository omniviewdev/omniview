// Auto-generated shim for '@mui/joy/AccordionSummary'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/joy/AccordionSummary'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/joy/AccordionSummary" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const accordionSummaryClasses = mod.accordionSummaryClasses;
export const getAccordionSummaryUtilityClass = mod.getAccordionSummaryUtilityClass;

export default mod.default !== undefined ? mod.default : mod;
