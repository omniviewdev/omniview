import React from 'react';
import { ErrorBoundary } from 'react-error-boundary';

// ui
import { Button, Stack, Text } from '@omniviewdev/base-ui';
import { InlineErrorFallback } from '@/components/errors/ErrorFallback';

// types
import { jsonToValue, resourceEditorModelURI, useResourceType, valueToJSON, type Value, type DrawerComponent, type DrawerContext, type SchemaRequest } from '@omniviewdev/runtime';
import { resourceYaml, parseResourceYaml } from './resourceYaml';

// icons
import { LuCode, LuFileDiff, LuFileCode, LuLink, LuRotateCw, LuSquareChartGantt } from 'react-icons/lu';

// third-party
import { stringify } from 'yaml';
import MonacoEditor, { DiffEditor } from '@monaco-editor/react';
import { useResolvedMonacoTheme } from '@/components/displays/CodeEditor';
import { useSchemaRegistration } from '@/providers/monaco/useSchemaRegistration';

// -- Overview View ────────────────────────────────────────────────────

/**
 * Read-only YAML overview of a linked resource. Receives data through ctx.data,
 * exactly like PodSidebar and other row-click views.
 */
const LinkedResourceOverview: React.FC<{ ctx: DrawerContext }> = ({ ctx }) => {
  const themeRootRef = React.useRef<HTMLDivElement>(null);
  const theme = useResolvedMonacoTheme(themeRootRef);

  if (!ctx.data) {
    return null;
  }

  return (
    <div ref={themeRootRef} style={{ display: 'contents' }}>
      <MonacoEditor
        defaultLanguage='yaml'
        theme={theme}
        height='100%'
        value={stringify(ctx.data, null, 2)}
        options={{
          readOnly: true,
          fontSize: 11,
        }}
      />
    </div>
  );
};

// -- Editor View ─────────────────────────────────────────────────────


/**
 * Editable YAML view with submit/cancel/reset/diff — same pattern as
 * BaseEditorPage used in the Pod row-click drawer.
 */
const LinkedResourceEditor: React.FC<{
  ctx: DrawerContext;
  onSubmit: (ctx: DrawerContext, value: Record<string, any>, canonical?: Value) => void;
  onClose: () => void;
}> = (props) => {
  const { ctx } = props;
  if (!ctx.data || !ctx.resource) return null;
  const key = JSON.stringify([ctx.resource.pluginID, ctx.resource.route, ctx.resource.reference, ctx.resource.representation]);
  return <LinkedResourceEditorSession key={key} {...props} resource={ctx.resource} />;
};

function LinkedResourceEditorSession({ ctx, resource, onSubmit, onClose }: {
  ctx: DrawerContext;
  resource: NonNullable<DrawerContext['resource']>;
  onSubmit: (ctx: DrawerContext, value: Record<string, any>, canonical?: Value) => void;
  onClose: () => void;
}) {
  const original = React.useMemo(() => resource.record?.record.body ?? jsonToValue(ctx.data ?? null), [ctx.data, resource.record]);
  const originalData = React.useMemo(() => resourceYaml(original), [original]);
  const editorID = React.useId();
  const { resourceType } = useResourceType({ pluginID: resource.pluginID, route: resource.route, type: resource.reference.address.type });
  const format = resource.record?.record.representation
    ?? resourceType.data?.representations.find((entry) => entry.id === resource.representation);
  const request = React.useMemo<SchemaRequest | undefined>(() => format ? {
    route: resource.route, type: resource.reference.address.type, target: { representation: format },
  } : undefined, [format, resource.route, resource.reference.address.type]);
  const editorPath = resourceEditorModelURI({
    pluginID: resource.pluginID, route: resource.route, type: resource.reference.address.type,
    target: { representation: { id: resource.representation, revision: '' } },
    name: JSON.stringify([resource.reference, editorID, 'draft']),
  });
  const schema = useSchemaRegistration({ pluginID: resource.pluginID, request, modelURI: editorPath });

  const [value, setValue] = React.useState<string>(originalData);
  const [changed, setChanged] = React.useState(false);
  const [viewDiff, setViewDiff] = React.useState(false);
  const themeRootRef = React.useRef<HTMLDivElement>(null);
  const theme = useResolvedMonacoTheme(themeRootRef);

  if (!ctx.data) {
    return null;
  }

  const handleChange = (val: string | undefined) => {
    if (!val) {
      return;
    }

    if (!changed) {
      setChanged(true);
    }

    setValue(val);
  };

  const handleSubmit = () => {
    const parsed = parseResourceYaml(value, original, originalData);
    onSubmit(ctx, valueToJSON(parsed) as Record<string, any>, parsed);
  };

  return (
    <div ref={themeRootRef} style={{ display: 'contents' }}>
      <Stack direction="column" spacing={2} style={{ flex: 1 }}>
        {schema.error && <Text tone="danger">Editor schema is unavailable. Raw YAML remains usable.</Text>}
        {schema.result && schema.result.status !== 'available' && <Text tone="muted">Editor schema: {schema.result.status}.</Text>}
        {viewDiff ? (
          <DiffEditor
            height='100%'
            original={originalData}
            theme={theme}
            modified={value}
            language='yaml'
            options={{ readOnly: true, fontSize: 11 }}
          />
        ) : (
          <MonacoEditor
            defaultLanguage='yaml'
            theme={theme}
            height='100%'
            value={value}
            language='yaml'
            path={editorPath}
            options={{ readOnly: false, fontSize: 11 }}
            onChange={handleChange}
          />
        )}
        <Stack direction="row" justify="between" spacing={2}>
          <Stack direction="row" spacing={2}>
            <Button size='sm' variant='soft' color='brand' disabled={!changed} onClick={handleSubmit}>
              Submit
            </Button>
            <Button size='sm' variant='outline' color='neutral' onClick={onClose}>
              Cancel
            </Button>
          </Stack>
          <Stack direction="row" spacing={2}>
            <Button
              size='sm'
              variant='outline'
              color='warning'
              startDecorator={<LuRotateCw size={16} />}
              onClick={() => {
                setValue(originalData);
                setChanged(false);
              }}
            >
              Reset Changes
            </Button>
            <Button
              size='sm'
              variant='outline'
              color='neutral'
              startDecorator={viewDiff ? <LuFileCode size={18} /> : <LuFileDiff size={16} />}
              onClick={() => {
                setViewDiff(!viewDiff);
              }}
            >
              {viewDiff ? 'Return to Code Editor' : 'View in Diff Editor'}
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </div>
  );
}

// -- Factory ─────────────────────────────────────────────────────────

/**
 * Build a DrawerComponent for a linked resource. Views receive data
 * through ctx.data — same pattern as row-click drawers.
 *
 * When a SidebarComponent is provided (looked up from the plugin's sidebar
 * registry), it replaces the generic YAML overview with the plugin's rich
 * sidebar — the same component used for table row clicks.
 */
export const createLinkedResourceDrawer = (
  resourceKey: string,
  onSubmit: (ctx: DrawerContext, value: Record<string, any>, canonical?: Value) => void,
  onClose: () => void,
  SidebarComponent?: React.ComponentType<{ ctx: DrawerContext }>,
): DrawerComponent => ({
  title: resourceKey,
  icon: <LuLink />,
  views: [
    {
      title: 'Overview',
      icon: <LuSquareChartGantt />,
      component: (ctx) => (
        <ErrorBoundary
          FallbackComponent={(props) => <InlineErrorFallback {...props} label="Sidebar" />}
          resetKeys={[resourceKey]}
        >
          {SidebarComponent
            ? <SidebarComponent ctx={ctx} />
            : <LinkedResourceOverview ctx={ctx} />}
        </ErrorBoundary>
      ),
    },
    {
      title: 'Editor',
      icon: <LuCode />,
      component: (ctx) => <LinkedResourceEditor ctx={ctx} onSubmit={onSubmit} onClose={onClose} />,
    },
  ],
  actions: [],
});
