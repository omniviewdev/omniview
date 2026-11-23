import type { StorybookConfig } from '@storybook/react-vite';
import { writeStories } from '../scripts/stories.ts';

writeStories(new URL('../', import.meta.url));

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../stories/generated/*.stories.ts'],
  typescript: { reactDocgen: false },
  viteFinal(config, { configType }) {
    if (configType === 'PRODUCTION') config.base = './';
    return config;
  },
};

export default config;
