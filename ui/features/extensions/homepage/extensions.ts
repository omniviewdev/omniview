import { type ExtensionPointSettings } from '@omniviewdev/runtime';
import { type HomepageCardProps } from './types';

const card: ExtensionPointSettings<HomepageCardProps> = {
  pluginId: 'core',
  id: 'omniview/home/card',
  mode: 'multiple',
};

export default [card];
