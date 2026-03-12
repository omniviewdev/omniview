import type React from 'react';
import { type ExtensionPointSettings, type ExtensionRenderContext } from '@omniviewdev/runtime';
import { type HomepageCardProps } from './types';

const card: ExtensionPointSettings<ExtensionRenderContext, React.FC<HomepageCardProps>> = {
  pluginId: 'core',
  id: 'omniview/home/card',
  mode: 'multiple',
};

export default [card];
