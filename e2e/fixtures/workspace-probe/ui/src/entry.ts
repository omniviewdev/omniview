import {
  PluginWindow,
  createCompletionSession,
  SETTINGS_EDITOR_EXTENSION_POINT_ID,
  type ExtensionRegistration,
  type SettingsEditorV1,
} from '@omniviewdev/runtime';
import { ProbeCounterEditor, ProbePage } from './ProbePage';
import { resourceCellRegistrations, type ProbeResourceCellV1 } from './ResourceCell';
import { resourceDrawers } from './ResourceDrawer';

// E2E-only access to the published runtime helper; calls still use real Wails bindings.
Object.assign(window, { __probeCompletionSession: createCompletionSession });

export const plugin = new PluginWindow()
  .setRootPage(ProbePage)
  .withRoutes([{ path: '/', Component: ProbePage }]);

export const extensionRegistrations: ExtensionRegistration<SettingsEditorV1 | ProbeResourceCellV1>[] = [{
  extensionPointId: SETTINGS_EDITOR_EXTENSION_POINT_ID,
  registration: {
    id: 'probe-counter-editor',
    label: 'Probe counter',
    value: { schemaVersion: 1, settingId: 'probe_counter', editor: ProbeCounterEditor },
  },
}, ...resourceCellRegistrations];

// Legacy export: the host registers each entry as the resource drawer of that resource type.
export const drawers = resourceDrawers;
