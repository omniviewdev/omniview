import { createPluginsPage } from './PluginsPage';
import { productionDeps } from './host';

// The Plugins page of the host, over the real host. `ui-next/plugins/host/PluginHost.tsx` registers it (`registerHostPage`); a test or a probe registers `createPluginsPage(deps)` instead.
export { createPluginsPage, PLUGINS_PAGE, PLUGINS_ROUTE } from './PluginsPage';
export type { PluginsPageDeps } from './PluginsPage';

export const pluginsPage = createPluginsPage(productionDeps);
