import {
  solarizedGray,
  solarizedBrand,
  solarizedGreen,
  solarizedOrange,
  solarizedRed,
  solarizedPurple,
  getSolarizedDesignTokens,
  solarizedCustomShadows,
} from './palettes';
import { createInputsCustomizations } from '../../../customizations/inputs';
import { createNavigationCustomizations } from '../../../customizations/navigation';
import { createFeedbackCustomizations } from '../../../customizations/feedback';
import { createDataDisplayCustomizations } from '../../../customizations/dataDisplay';
import type { ThemeDefinition } from '../../types';

const palettes = {
  gray: solarizedGray,
  brand: solarizedBrand,
  green: solarizedGreen,
  orange: solarizedOrange,
  red: solarizedRed,
  purple: solarizedPurple,
};

export const solarizedTheme: ThemeDefinition = {
  palettes,
  getDesignTokens: getSolarizedDesignTokens,
  getShadows: solarizedCustomShadows,
  getCustomizations: () => ({
    ...createInputsCustomizations(palettes),
    ...createNavigationCustomizations(palettes),
    ...createFeedbackCustomizations(palettes),
    ...createDataDisplayCustomizations(palettes),
  }),
};
