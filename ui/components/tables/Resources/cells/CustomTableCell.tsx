import React from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';

import { Text } from '@omniviewdev/base-ui';
import {
  RESOURCE_CELL_EXTENSION_POINT_ID,
  resolveResourceCell,
  useExtensionPointSnapshot,
  type ExtensionContributionRegistration,
  type ResourceCellContribution,
} from '@omniviewdev/runtime';
import { logPluginBoundaryError } from '@/features/plugins/components/PluginSurfaceBoundary';
import { PluginServiceContext } from '@/features/plugins/react/context';
import styles from './cells.module.css';

type Props = {
  /** The provider plugin whose column declaration named the component. */
  plugin: string;
  /** The opaque resource type ID of the table that owns the column. */
  resourceKey: string;
  /** The `ColumnDefinition.component` value to resolve. */
  component: string;
  /** The value the column accessor produced for this row. */
  data: unknown;
  /** The column declaration's `componentParams`, forwarded to the renderer unchanged. */
  componentParams?: unknown;
};

type CellStateProps = {
  state: 'unavailable' | 'loading' | 'error';
  label: string;
  detail: string;
};

/** An explicit, compact cell state: a missing renderer must never render as a blank cell. */
const CellState: React.FC<CellStateProps> = ({ state, label, detail }) => (
  <div className={styles.Cell} data-align='left' data-state={state} title={detail}>
    <Text size='xs' tone={state === 'error' ? 'danger' : 'muted'} className={styles.TextCellText}>
      {label}
    </Text>
  </div>
);

type ContributedCellProps = {
  registration: ExtensionContributionRegistration<ResourceCellContribution>;
  resourceKey: string;
  data: unknown;
  componentParams?: unknown;
};

/**
 * Renders one resolved contribution behind its own boundary. The boundary resets when the
 * registration is replaced (plugin reload) or the row's value changes.
 */
const ContributedCell: React.FC<ContributedCellProps> = ({ registration, resourceKey, data, componentParams }) => {
  const service = React.useContext(PluginServiceContext);
  const Renderer = registration.value.component;

  const handleError = (caught: unknown, info: React.ErrorInfo) => {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    logPluginBoundaryError({
      pluginId: registration.plugin,
      boundary: 'resource-cell',
      extensionPointId: RESOURCE_CELL_EXTENSION_POINT_ID,
      contributionId: registration.id,
      resourceKey,
      message: error.message,
      stack: error.stack ?? '',
      componentStack: info.componentStack ?? '',
    });
    service?.recordBoundaryCrash({
      contributionId: registration.id,
      pluginId: registration.plugin,
      extensionPointId: RESOURCE_CELL_EXTENSION_POINT_ID,
      boundary: 'resource-cell',
      resourceKey,
      errorMessage: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      timestamp: Date.now(),
    });
  };

  const renderFallback = ({ error }: FallbackProps) => (
    <CellState
      state='error'
      label='Failed to render'
      detail={`Cell renderer "${registration.value.name}" from plugin "${registration.plugin}" failed: ${error instanceof Error ? error.message : String(error)}`}
    />
  );

  return (
    <ErrorBoundary fallbackRender={renderFallback} onError={handleError} resetKeys={[registration, data, componentParams]}>
      <React.Suspense fallback={<CellState state='loading' label='Loading…' detail={`Loading cell renderer "${registration.value.name}" from plugin "${registration.plugin}".`} />}>
        <div className={styles.Cell} data-align='left' data-state='ready'>
          <Renderer data={data} componentParams={componentParams} />
        </div>
      </React.Suspense>
    </ErrorBoundary>
  );
};

/**
 * Renders a provider-declared custom column through the extension registry. The renderer is
 * resolved from the live contributions on every registry change, so plugin load, reload and
 * unload update mounted cells; nothing about a resolved renderer is cached here.
 */
const CustomTableCell: React.FC<Props> = ({ plugin, resourceKey, component, data, componentParams }) => {
  const { contributions } = useExtensionPointSnapshot<ResourceCellContribution>(RESOURCE_CELL_EXTENSION_POINT_ID);
  const resolution = resolveResourceCell(contributions, { pluginId: plugin, resourceKey, component });

  if (resolution.status === 'resolved') {
    return <ContributedCell registration={resolution.registration} resourceKey={resourceKey} data={data} componentParams={componentParams} />;
  }

  return (
    <CellState
      state='unavailable'
      label='Unavailable'
      detail={resolution.status === 'ambiguous'
        ? `Cell renderer "${component}" for plugin "${plugin}" is ambiguous: ${resolution.registrations.length} equally specific contributions.`
        : `Cell renderer "${component}" is not provided by plugin "${plugin}" for this resource type.`}
    />
  );
};

export default CustomTableCell;
