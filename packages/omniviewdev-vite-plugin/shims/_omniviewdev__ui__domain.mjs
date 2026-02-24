// Auto-generated shim for '@omniviewdev/ui/domain'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/domain'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/domain" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const DescriptionList = mod.DescriptionList;
export const EventsList = mod.EventsList;
export const FilterBar = mod.FilterBar;
export const LogsViewer = mod.LogsViewer;
export const MetricCard = mod.MetricCard;
export const ObjectInspector = mod.ObjectInspector;
export const ResourceBreadcrumb = mod.ResourceBreadcrumb;
export const ResourceRef = mod.ResourceRef;
export const ResourceStatus = mod.ResourceStatus;
export const SecretValueMask = mod.SecretValueMask;
export const Timeline = mod.Timeline;

export default mod.default !== undefined ? mod.default : mod;
