import {
  PluginWindow,
  SETTINGS_EDITOR_EXTENSION_POINT_ID,
  type ExtensionRegistration,
  type SettingsEditorV1,
} from '@omniviewdev/runtime';
import { ProbeCounterEditor, ProbePage } from './ProbePage';

export const plugin = new PluginWindow()
  .setRootPage(ProbePage)
  .withRoutes([{ path: '/', Component: ProbePage }]);

export const extensionRegistrations: ExtensionRegistration<SettingsEditorV1>[] = [{
  extensionPointId: SETTINGS_EDITOR_EXTENSION_POINT_ID,
  registration: {
    id: 'probe-counter-editor',
    label: 'Probe counter',
    value: { schemaVersion: 1, settingId: 'probe_counter', editor: ProbeCounterEditor },
  },
}];
