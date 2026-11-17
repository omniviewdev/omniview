// The examples entry, `@omniviewdev/kit/examples`: development and documentation only.
//
// Every part ships a typed `<Part>.examples.tsx` next to it: named examples, one per state worth seeing, each a component without
// props written the way a consumer writes it (from "@omniviewdev/kit", never from a relative path). They are rendered on the
// `ui-next` parts page, run by the tests of their part, and are what the future workshop and docs site are generated from
// (tracker row N20).
//
// This is NOT the root entry and never part of it: the root entry is the plugin-facing API and plugins load it as a singleton
// at run time. Only `ui-next/parts/**`, the kit's tests and the workshop may import this entry (lint: eslint/config.cjs), and it
// is never listed among the plugin shared modules. Adding a part means adding one line here.
import type { ReactElement } from 'react';

/** One example: a component without props that renders one state of a part. Its name is its title, its JSDoc its description. */
export type Example = () => ReactElement;

/** The named examples of one part: the exports of its `<Part>.examples.tsx`. */
export type ExampleSet = Readonly<Record<string, Example>>;

/** The examples of every part, keyed by the part's public name. */
export type PartExamples = Readonly<Record<string, ExampleSet>>;

/** The examples of every part. Dev and docs only: the parts page, the kit tests and the workshop render and read this. */
export const examples: PartExamples = {};
