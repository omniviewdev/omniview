import { getDesignTokens, customShadows, gray, brand, green, orange, red, purple } from '../../../primitives';
import { createInputsCustomizations } from '../../../customizations/inputs';
import { createNavigationCustomizations } from '../../../customizations/navigation';
import { createFeedbackCustomizations } from '../../../customizations/feedback';
import { createDataDisplayCustomizations } from '../../../customizations/dataDisplay';
import type { ThemeDefinition } from '../../types';

const palettes = { gray, brand, green, orange, red, purple };

export const defaultTheme: ThemeDefinition = {
  palettes,
  getDesignTokens,
  getShadows: customShadows,
  getCustomizations: () => ({
    ...createInputsCustomizations(),
    ...createNavigationCustomizations(),
    ...createFeedbackCustomizations(),
    ...createDataDisplayCustomizations(),
  }),
};
