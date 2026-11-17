import { describe, expect, it } from 'vitest';
import { laneMode } from './lane';

// The widths of the mock's heuristic (shell-page-kit.js, `fits`): a labelled command is 43 px and 7.5 px a character, an icon command 28 px,
// 8 px between controls, the title 10 px a character after a 32 px tile and gap, and 12 px of air; the lane stays beside the title when
// the sum is at most 700 px, the width of a 1030 px window's page less its inset.
const lane = (overrides: Partial<Parameters<typeof laneMode>[0]> = {}) =>
  laneMode({ labels: [], icons: 0, titleLength: 5, hasTile: false, ...overrides });

describe('laneMode', () => {
  it('is short for three controls or fewer: they stay on the title row until the page is 520 px wide', () => {
    expect(lane({ icons: 1 })).toBe('short');
    expect(lane({ labels: ['Create item'], icons: 2 })).toBe('short');
    expect(lane({ labels: ['Edit', 'Delete'], icons: 1 })).toBe('short');
  });

  it('is short for no control at all', () => {
    expect(lane()).toBe('short');
  });

  it('is beside for four controls or more that fit one row of 700 px with a short title', () => {
    // Scale, Edit, Restart, Delete (80.5 + 73 + 95.5 + 88 = 337) + 2 icon controls (56) + 5 gaps (40) = 433; title 10 x 10; tile 32; air 12 = 577
    expect(lane({ labels: ['Scale', 'Edit', 'Restart', 'Delete'], icons: 2, titleLength: 10, hasTile: true })).toBe('beside');
  });

  it('is default for four controls or more with a title that leaves them no room: they drop under the identity line below 800 px', () => {
    expect(lane({ labels: ['Scale', 'Edit', 'Restart', 'Delete'], icons: 2, titleLength: 60, hasTile: true })).toBe('default');
  });

  it('counts the secondary run of the title as part of the title, and a space before it', () => {
    const short = lane({ labels: ['Scale', 'Edit', 'Restart', 'Delete'], icons: 2, titleLength: 10 + 1 + 10, hasTile: true });
    expect(short).toBe('beside');
    expect(lane({ labels: ['Scale', 'Edit', 'Restart', 'Delete'], icons: 2, titleLength: 10 + 1 + 80, hasTile: true })).toBe('default');
  });

  it('puts the line exactly at 700: that still fits, one more character does not', () => {
    // 433 + 10 x n + 12 <= 700  gives n <= 25 without a tile
    const edge = { labels: ['Scale', 'Edit', 'Restart', 'Delete'], icons: 2, hasTile: false };
    expect(lane({ ...edge, titleLength: 25 })).toBe('beside');
    expect(lane({ ...edge, titleLength: 26 })).toBe('default');
  });
});
