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
// An examples file that has a CSS Module of its own (DataTable.parity.module.css) puts its rules in this entry's graph: the layer order
// statement still has to be the first rule of the stylesheet, so this entry imports it first, as entry.ts does.
import './styles/layers.css';
import type { ReactElement } from 'react';
import * as buttonExamples from './components/Button/Button.examples';
import * as iconButtonExamples from './components/IconButton/IconButton.examples';
import * as iconExamples from './components/Icon/Icon.examples';
import * as dataTableExamples from './components/DataTable/DataTable.examples';
import * as dataTableParityExamples from './components/DataTable/DataTable.parity.examples';
import * as rowMenuExamples from './components/RowMenu/RowMenu.examples';
import * as chipExamples from './components/Chip/Chip.examples';
import * as rovingGroupExamples from './components/RovingGroup/RovingGroup.examples';
import * as quickFiltersExamples from './components/QuickFilters/QuickFilters.examples';
import * as statusExamples from './components/Status/Status.examples';
import * as missingValueExamples from './components/MissingValue/MissingValue.examples';
import * as kindTileExamples from './components/KindTile/KindTile.examples';
import * as middleEllipsisExamples from './components/MiddleEllipsis/MiddleEllipsis.examples';
import * as collectionFooterExamples from './components/CollectionFooter/CollectionFooter.examples';
import * as searchFieldExamples from './components/SearchField/SearchField.examples';
import * as workspaceToolbarExamples from './components/WorkspaceToolbar/WorkspaceToolbar.examples';
import * as pageHeaderExamples from './components/PageHeader/PageHeader.examples';
import * as dataViewExamples from './components/DataView/DataView.examples';

/** One example: a component without props that renders one state of a part. Its name is its title, its JSDoc its description. */
export type Example = () => ReactElement;

/** The named examples of one part: the exports of its `<Part>.examples.tsx`. */
export type ExampleSet = Readonly<Record<string, Example>>;

/** The examples of every part, keyed by the part's public name. */
export type PartExamples = Readonly<Record<string, ExampleSet>>;

/** The examples of every part. Dev and docs only: the parts page, the kit tests and the workshop render and read this. */
export const examples: PartExamples = {
  Icon: iconExamples,
  Button: buttonExamples,
  IconButton: iconButtonExamples,
  DataTable: dataTableExamples,
  DataTableParity: dataTableParityExamples,
  RowMenu: rowMenuExamples,
  Chip: chipExamples,
  RovingGroup: rovingGroupExamples,
  QuickFilters: quickFiltersExamples,
  Status: statusExamples,
  MissingValue: missingValueExamples,
  KindTile: kindTileExamples,
  MiddleEllipsis: middleEllipsisExamples,
  CollectionFooter: collectionFooterExamples,
  SearchField: searchFieldExamples,
  WorkspaceToolbar: workspaceToolbarExamples,
  PageHeader: pageHeaderExamples,
  DataView: dataViewExamples,
};
