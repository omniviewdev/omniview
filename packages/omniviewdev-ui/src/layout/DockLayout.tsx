import React from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import ResizableSplitPane from './ResizableSplitPane';

export interface DockLeaf {
  type: 'leaf';
  id: string;
  minSize?: number;
}

export interface DockSplit {
  type: 'horizontal' | 'vertical';
  children: DockNode[];
  sizes?: number[];
}

export type DockNode = DockLeaf | DockSplit;

export interface DockLayoutProps {
  layout: DockNode;
  renderPanel: (id: string) => React.ReactNode;
  sx?: SxProps<Theme>;
}

function renderNode(
  node: DockNode,
  renderPanel: (id: string) => React.ReactNode,
): React.ReactNode {
  if (node.type === 'leaf') {
    return (
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
        {renderPanel(node.id)}
      </Box>
    );
  }

  const direction = node.type === 'horizontal' ? 'horizontal' : 'vertical';
  const children = node.children;

  if (children.length === 0) return null;
  if (children.length === 1) return renderNode(children[0], renderPanel);

  // Build nested ResizableSplitPane for N children
  return buildSplitTree(children, direction, node.sizes, renderPanel);
}

function buildSplitTree(
  nodes: DockNode[],
  direction: 'horizontal' | 'vertical',
  sizes: number[] | undefined,
  renderPanel: (id: string) => React.ReactNode,
): React.ReactNode {
  if (nodes.length === 1) return renderNode(nodes[0], renderPanel);

  const defaultSize = sizes?.[0] ?? 50;
  const first = nodes[0];
  const rest = nodes.slice(1);
  const restSizes = sizes?.slice(1);

  const minSize = first.type === 'leaf' ? (first.minSize ?? 100) : 100;

  return (
    <ResizableSplitPane
      direction={direction}
      defaultSize={defaultSize}
      minSize={minSize}
    >
      {renderNode(first, renderPanel)}
      {rest.length === 1
        ? renderNode(rest[0], renderPanel)
        : buildSplitTree(rest, direction, restSizes, renderPanel)
      }
    </ResizableSplitPane>
  );
}

export default function DockLayout({
  layout,
  renderPanel,
  sx,
}: DockLayoutProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {renderNode(layout, renderPanel)}
    </Box>
  );
}

DockLayout.displayName = 'DockLayout';
