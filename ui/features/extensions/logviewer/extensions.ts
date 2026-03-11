import { type ExtensionPointSettings } from '@omniviewdev/runtime';
import { type LogFilterComponentProps } from './types';

const logFilters: ExtensionPointSettings<LogFilterComponentProps> = {
  pluginId: 'core',
  id: 'omniview/logs/filters',
  mode: 'multiple',
};

export default [logFilters];
