import React from 'react';

// material-ui
import Stack from '@mui/joy/Stack';
import Button from '@mui/joy/Button';

// types
import type { DrawerComponent, DrawerContext } from '@omniviewdev/runtime';

// icons
import { LuCode, LuFileDiff, LuFileCode, LuLink, LuRotateCw, LuSquareChartGantt } from 'react-icons/lu';

// third-party
import { parse, stringify } from 'yaml';
import MonacoEditor, { DiffEditor } from '@monaco-editor/react';

// ── Overview View ────────────────────────────────────────────────────

/**
 * Read-only YAML overview of a linked resource. Receives data through ctx.data,
 * exactly like PodSidebar and other row-click views.
 */
const LinkedResourceOverview: React.FC<{ ctx: DrawerContext }> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  return (
    <MonacoEditor
      defaultLanguage='yaml'
      theme='vs-dark'
      height='100%'
      value={stringify(ctx.data, null, 2)}
      options={{
        readOnly: true,
        fontSize: 11,
      }}
    />
  );
};

// ── Editor View ─────────────────────────────────────────────────────

/**
 * Editable YAML view with submit/cancel/reset/diff — same pattern as
 * BaseEditorPage used in the Pod row-click drawer.
 */
const LinkedResourceEditor: React.FC<{
  ctx: DrawerContext;
  onSubmit: (ctx: DrawerContext, value: Record<string, any>) => void;
  onClose: () => void;
}> = ({ ctx, onSubmit, onClose }) => {
  const originalData = ctx.data ? stringify(ctx.data, null, 2) : '';
  const editorPath = `file:///${ctx.resource?.key ?? 'resource'}/draft.yaml`;

  const [value, setValue] = React.useState<string>(originalData);
  const [changed, setChanged] = React.useState(false);
  const [viewDiff, setViewDiff] = React.useState(false);

  if (!ctx.data) {
    return null;
  }

  const handleChange = (val: string | undefined) => {
    if (!val) return;
    if (!changed) setChanged(true);
    setValue(val);
  };

  const handleSubmit = () => {
    const parsed = parse(value);
    onSubmit(ctx, parsed);
  };

  return (
    <Stack direction="column" gap={1} display='flex' flex={1}>
      {viewDiff ? (
        <DiffEditor
          height='100%'
          original={originalData}
          theme='vs-dark'
          modified={value}
          language='yaml'
          options={{ readOnly: true, fontSize: 11 }}
        />
      ) : (
        <MonacoEditor
          defaultLanguage='yaml'
          theme='vs-dark'
          height='100%'
          value={value}
          language='yaml'
          path={editorPath}
          options={{ readOnly: false, fontSize: 11 }}
          onChange={handleChange}
        />
      )}
      <Stack direction="row" justifyContent="space-between" gap={1}>
        <Stack direction="row" gap={1}>
          <Button variant='soft' color='primary' disabled={!changed} onClick={handleSubmit}>
            Submit
          </Button>
          <Button variant='outlined' color='neutral' onClick={onClose}>
            Cancel
          </Button>
        </Stack>
        <Stack direction="row" gap={1}>
          <Button
            variant='outlined'
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
            variant='outlined'
            startDecorator={viewDiff ? <LuFileCode size={18} /> : <LuFileDiff size={16} />}
            onClick={() => setViewDiff(!viewDiff)}
          >
            {viewDiff ? 'Return to Code Editor' : 'View in Diff Editor'}
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
};

// ── Factory ─────────────────────────────────────────────────────────

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
  onSubmit: (ctx: DrawerContext, value: Record<string, any>) => void,
  onClose: () => void,
  SidebarComponent?: React.ComponentType<{ ctx: DrawerContext }>,
): DrawerComponent => ({
  title: resourceKey,
  icon: <LuLink />,
  views: [
    {
      title: 'Overview',
      icon: <LuSquareChartGantt />,
      component: (ctx) => SidebarComponent
        ? <SidebarComponent ctx={ctx} />
        : <LinkedResourceOverview ctx={ctx} />,
    },
    {
      title: 'Editor',
      icon: <LuCode />,
      component: (ctx) => <LinkedResourceEditor ctx={ctx} onSubmit={onSubmit} onClose={onClose} />,
    },
  ],
  actions: [],
});
