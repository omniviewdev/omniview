import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../stories/**/*.stories.tsx'],
  typescript: { reactDocgen: false },
  viteFinal(config, { configType }) {
    if (configType === 'PRODUCTION') config.base = './';
    return config;
  },
};

export default config;
