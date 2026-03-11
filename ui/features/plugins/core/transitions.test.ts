import { describe, it, expect } from 'vitest';
import { VALID_TRANSITIONS, assertValidTransition } from './transitions';
import type { PluginPhase } from './types';

const ALL_PHASES: PluginPhase[] = [
  'idle',
  'loading',
  'ready',
  'error',
  'retrying',
  'unloading',
];

// ─── Group 2: State Machine Transitions ──────────────────────────────

describe('State Machine Transitions', () => {
  // ── 2.1 Valid Transitions ──────────────────────────────────────────

  describe('valid transitions', () => {
    const validCases: Array<[PluginPhase, PluginPhase, string]> = [
      ['idle', 'loading', '#1 Initial load'],
      ['loading', 'ready', '#2 Successful import'],
      ['loading', 'error', '#3 Import failure'],
      ['ready', 'loading', '#4 Hot reload'],
      ['ready', 'unloading', '#5 User uninstall'],
      ['error', 'retrying', '#6 Retry attempt'],
      ['error', 'idle', '#7 Uninstall failed plugin'],
      ['retrying', 'loading', '#8 Retry timer fires'],
      ['unloading', 'idle', '#9 Unload complete'],
    ];

    it.each(validCases)(
      '%s → %s does not throw (%s)',
      (from, to) => {
        expect(() => assertValidTransition(from, to)).not.toThrow();
      },
    );
  });

  // ── 2.2 Invalid Transitions ────────────────────────────────────────

  describe('invalid transitions', () => {
    const invalidCases: Array<[PluginPhase, PluginPhase, string]> = [
      ['idle', 'ready', '#10 Cannot skip loading'],
      ['idle', 'error', '#11 Must attempt load first'],
      ['idle', 'unloading', '#12 Nothing to unload'],
      ['idle', 'retrying', '#13 Nothing to retry'],
      ['idle', 'idle', '#14 Self-transition meaningless'],
      ['loading', 'idle', '#15 Must complete or fail'],
      ['loading', 'unloading', '#16 Must finish loading first'],
      ['loading', 'retrying', '#17 Must error first'],
      ['loading', 'loading', '#18 Already loading'],
      ['ready', 'error', '#19 Must go through loading'],
      ['ready', 'idle', '#20 Must go through unloading'],
      ['ready', 'retrying', '#21 Not in error state'],
      ['ready', 'ready', '#22 Self-transition meaningless'],
      ['error', 'loading', '#23 Must go through retrying'],
      ['error', 'ready', '#24 Cannot skip loading'],
      ['error', 'unloading', '#25 Nothing loaded to unload'],
      ['error', 'error', '#26 Self-transition meaningless'],
      ['unloading', 'loading', '#27 Must reach idle first'],
      ['unloading', 'ready', '#28 Cannot skip idle'],
      ['unloading', 'error', '#29 Unload does not fail'],
      ['unloading', 'retrying', '#30 Not applicable'],
      ['unloading', 'unloading', '#31 Already unloading'],
      ['retrying', 'idle', '#32 Must load or error'],
      ['retrying', 'ready', '#33 Must go through loading'],
      ['retrying', 'error', '#34 Must go through loading'],
      ['retrying', 'unloading', '#35 Not applicable'],
      ['retrying', 'retrying', '#36 Already retrying'],
    ];

    it.each(invalidCases)(
      '%s → %s throws (%s)',
      (from, to) => {
        expect(() => assertValidTransition(from, to)).toThrow();
      },
    );

    it('error message contains both phase names', () => {
      expect(() => assertValidTransition('idle', 'ready')).toThrow(/idle/);
      expect(() => assertValidTransition('idle', 'ready')).toThrow(/ready/);
    });
  });

  // ── 2.3 Transition Completeness ────────────────────────────────────

  describe('completeness', () => {
    it('#37 every PluginPhase has an entry in VALID_TRANSITIONS', () => {
      for (const phase of ALL_PHASES) {
        expect(VALID_TRANSITIONS).toHaveProperty(phase);
        expect(Array.isArray(VALID_TRANSITIONS[phase])).toBe(true);
      }
    });

    it('#38 no unreachable phases — every phase appears as a target', () => {
      const allTargets = new Set<string>();
      for (const targets of Object.values(VALID_TRANSITIONS)) {
        for (const t of targets) {
          allTargets.add(t);
        }
      }

      // 'idle' is the initial state and also a target of unloading/error→idle.
      // Every phase should appear as a transition target at least once.
      for (const phase of ALL_PHASES) {
        expect(
          allTargets.has(phase),
          `Phase "${phase}" is never a transition target`,
        ).toBe(true);
      }
    });
  });
});
