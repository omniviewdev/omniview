import {
  DEFAULT_DENSITY,
  DEFAULT_TEXT_SIZE,
  DEFAULT_THEME_ID,
  DENSITIES,
  TEXT_SIZES,
  THEMES,
  ThemeProvider,
} from '@omniviewdev/kit';
import '@omniviewdev/kit/styles.css';
import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  initialGlobals: {
    theme: DEFAULT_THEME_ID,
    density: DEFAULT_DENSITY,
    textSize: DEFAULT_TEXT_SIZE,
  },
  globalTypes: {
    theme: {
      description: 'Kit theme',
      toolbar: {
        title: 'Theme',
        dynamicTitle: true,
        items: THEMES.map(({ id, name }) => ({ value: id, title: name })),
      },
    },
    density: {
      description: 'Kit density',
      toolbar: {
        title: 'Density',
        dynamicTitle: true,
        items: DENSITIES.map((density) => ({
          value: density,
          title: density === 'comfortable' ? 'Comfortable' : 'Compact',
        })),
      },
    },
    textSize: {
      description: 'Kit text size',
      toolbar: {
        title: 'Text size',
        dynamicTitle: true,
        items: TEXT_SIZES.map((size) => ({ value: size, title: `${size}%` })),
      },
    },
  },
  parameters: { layout: 'centered' },
  decorators: [
    (Story, { globals }) => (
      <ThemeProvider
        themeId={globals.theme}
        density={DENSITIES.find((density) => density === globals.density) ?? DEFAULT_DENSITY}
        textSize={TEXT_SIZES.find((size) => size === String(globals.textSize)) ?? DEFAULT_TEXT_SIZE}
      >
        <Story />
      </ThemeProvider>
    ),
  ],
};

export default preview;
