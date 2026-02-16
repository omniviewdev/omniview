import { type CreateExtensionPointOptions } from '@omniviewdev/runtime';
import { type LogFilterComponentProps } from './types';

const logFilters: CreateExtensionPointOptions<LogFilterComponentProps> = {
  owner: 'core',
  id: 'omniview/logs/filters',
  name: 'Log Viewer Filters',
  description:
    'Custom filter components for the log viewer toolbar. Plugins can register components to provide custom source filtering UI beyond the generic label-based dropdowns.',
  mode: 'multiple',
};

export default [logFilters];
