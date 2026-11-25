import { entries as controls } from './controls.ts';
import { entries as collections } from './collections.ts';
import { entries as feedback } from './feedback.ts';
import { entries as overlays } from './overlays.ts';
import { entries as primitives } from './primitives.ts';

export type Guide = {
  category: string;
  summary: string;
  guidance: readonly string[];
};

export const guidance: Record<string, Guide> = { ...controls, ...collections, ...feedback, ...overlays, ...primitives };
