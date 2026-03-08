import { type CreateExtensionPointOptions } from '@omniviewdev/runtime';
import { type HomepageCardProps } from './types';

const card: CreateExtensionPointOptions<HomepageCardProps> = {
  owner: 'core',
  id: 'omniview/home/card',
  name: 'Homepage Card',
  description: 'Card displayed on the application home page.',
  mode: 'multiple',
};

export default [card];
