import React from 'react';
import { ErrorBoundary } from 'react-error-boundary';

// ui
import { Button, Stack, Text } from '@omniviewdev/base-ui';
import { InlineErrorFallback } from '@/components/errors/ErrorFallback';

// types
import { jsonToValue, valueToJSON, type Value, type DrawerComponent, type DrawerContext } from '@omniviewdev/runtime';
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

function ResourceEditorSchemas({ resource }: { resource: NonNullable<DrawerContext['resource']> }) {
  const { error } = useSchemaRegistration({
    pluginID: resource.pluginID,
    connectionID: resource.route.connection,
  });
  return error ? <Text tone="danger">Editor schema: {String(error)}</Text> : null;
}

/**
 * Editable YAML view with submit/cancel/reset/diff — same pattern as
 * BaseEditorPage used in the Pod row-click drawer.
 */
const LinkedResourceEditor: React.FC<{
  ctx: DrawerContext;
  onSubmit: (ctx: DrawerContext, value: Record<string, any>, canonical?: Value) => void;
  onClose: () => void;
}> = ({ ctx, onSubmit, onClose }) => {
  const original = React.useMemo(() => ctx.resource?.record?.record.body ?? jsonToValue(ctx.data ?? null), [ctx]);
  const originalData = React.useMemo(() => resourceYaml(original), [original]);
  const editorPath = ctx.resource
    ? `file:///resource/${encodeURIComponent(ctx.resource.pluginID)}/${encodeURIComponent(ctx.resource.route.connection)}/${encodeURIComponent(ctx.resource.reference.address.type)}/draft.yaml`
    : 'file:///resource/draft.yaml';

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
        {ctx.resource && <ResourceEditorSchemas resource={ctx.resource} />}
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
};

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
