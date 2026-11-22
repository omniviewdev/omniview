// The types of world.mjs for the fixture (fixture.tsx imports the same plugins the mock side is written with): the probes are plain ESM and carry no types of their own, and the TypeScript projects of the repository do not read
// a .mjs file's members.

export type WorldPlugin = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly category: string;
  readonly license: string;
  readonly summary: string;
  readonly state: 'running' | 'failed' | 'disabled' | 'starting';
};

export const WORLD: readonly WorldPlugin[];

export const SELECTED: string;
