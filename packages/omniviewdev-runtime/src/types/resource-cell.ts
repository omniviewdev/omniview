import type { ComponentType } from 'react';
import type { ExtensionRenderContext } from './extensions';

/**
 * Host-owned extension point for renderers of provider-declared resource table cells.
 *
 * A provider names a renderer in `ColumnDefinition.component`; a UI plugin supplies the
 * renderer as a `ResourceCellContribution` registered at this point.
 */
export const RESOURCE_CELL_EXTENSION_POINT_ID = 'omniview/resource/cell' as const;

/** Props the host passes to every contributed resource cell renderer. */
export interface ResourceCellProps {
  /**
   * The value the host's column accessor extracted from the row. Its shape is defined by the
   * provider's column declaration, so renderers must validate it before use.
   */
  readonly data: unknown;
  /**
   * The column declaration's `componentParams`, exactly as the provider declared them, or
   * `undefined` when the declaration has none. It is provider-supplied data of unknown shape
   * and is shared by every cell of the column: validate it before use and never mutate it.
   */
  readonly componentParams?: unknown;
}

/**
 * Register as the `value` of an `ExtensionRegistration<ResourceCellContribution>` at
 * `RESOURCE_CELL_EXTENSION_POINT_ID`. The host assigns the contribution ID and owning plugin
 * from the authenticated loader; neither is read from this descriptor.
 */
export interface ResourceCellContribution {
  /** Contract version. Only `1` is supported. */
  contractVersion: 1;
  /** The exact `ColumnDefinition.component` value this renderer serves. */
  name: string;
  /**
   * Opaque provider-defined resource type IDs (the same IDs that key `sidebars` and `drawers`)
   * this renderer serves. The host compares them for equality and never parses them. Omit to
   * serve every resource type that declares `name`.
   */
  resourceKeys?: readonly string[];
  /**
   * Provider plugin IDs, in addition to the registering plugin, whose column declarations this
   * renderer may serve. Without it, a plugin can only resolve its own declared component names.
   */
  providers?: readonly string[];
  /** The renderer. Function, class, memo, forwardRef and lazy components are accepted. */
  component: ComponentType<ResourceCellProps>;
}

/** Structured lookup context for one column declaration of one resource type. */
export interface ResourceCellContext extends ExtensionRenderContext {
  /** The provider plugin whose column declaration named the component. */
  readonly pluginId: string;
  /** The opaque resource type ID of the table that owns the column. */
  readonly resourceKey: string;
  /** The `ColumnDefinition.component` value to resolve. */
  readonly component: string;
}
