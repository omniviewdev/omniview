import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import MuiCheckbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import { LuChevronRight, LuChevronDown } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

export interface TreeNode {
  id: string;
  label: string;
  icon?: React.ReactNode;
  children?: TreeNode[];
  badge?: React.ReactNode;
  disabled?: boolean;
}

export interface TreeViewProps {
  nodes: TreeNode[];
  selected?: string;
  onSelect?: (id: string) => void;
  expanded?: string[];
  onToggle?: (id: string) => void;
  multiSelect?: boolean;
  checkboxes?: boolean;
  lazyLoad?: boolean;
  onLoadChildren?: (id: string) => Promise<TreeNode[]>;
  contextMenu?: (node: TreeNode) => React.ReactNode;
  sx?: SxProps<Theme>;
}

function TreeItem({
  node,
  depth,
  selected,
  onSelect,
  expanded,
  onToggle,
  checkboxes,
  lazyLoad,
  onLoadChildren,
  loadingNodes,
  setLoadingNodes,
  dynamicChildren,
  setDynamicChildren,
}: {
  node: TreeNode;
  depth: number;
  selected?: string;
  onSelect?: (id: string) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  checkboxes?: boolean;
  lazyLoad?: boolean;
  onLoadChildren?: (id: string) => Promise<TreeNode[]>;
  loadingNodes: Set<string>;
  setLoadingNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
  dynamicChildren: Map<string, TreeNode[]>;
  setDynamicChildren: React.Dispatch<React.SetStateAction<Map<string, TreeNode[]>>>;
}) {
  const isExpanded = expanded.has(node.id);
  const isSelected = selected === node.id;
  const children = dynamicChildren.get(node.id) ?? node.children;
  const hasChildren = (children && children.length > 0) || (lazyLoad && !dynamicChildren.has(node.id));
  const isLoading = loadingNodes.has(node.id);

  const handleToggle = async () => {
    if (lazyLoad && !dynamicChildren.has(node.id) && onLoadChildren) {
      setLoadingNodes((prev) => new Set(prev).add(node.id));
      try {
        const loaded = await onLoadChildren(node.id);
        setDynamicChildren((prev) => new Map(prev).set(node.id, loaded));
      } finally {
        setLoadingNodes((prev) => {
          const next = new Set(prev);
          next.delete(node.id);
          return next;
        });
      }
    }
    onToggle(node.id);
  };

  return (
    <Box>
      <Box
        onClick={() => {
          if (!node.disabled) onSelect?.(node.id);
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          py: 0.25,
          px: 1,
          pl: depth * 2 + 1,
          cursor: node.disabled ? 'default' : 'pointer',
          opacity: node.disabled ? 0.5 : 1,
          borderRadius: '4px',
          bgcolor: isSelected ? 'var(--ov-accent-subtle)' : 'transparent',
          color: isSelected ? 'var(--ov-accent-fg)' : 'var(--ov-fg-default)',
          '&:hover': {
            bgcolor: isSelected ? 'var(--ov-accent-subtle)' : 'var(--ov-state-hover)',
          },
          fontSize: '0.8125rem',
        }}
      >
        {hasChildren ? (
          <Box
            onClick={(e) => {
              e.stopPropagation();
              handleToggle();
            }}
            sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            {isLoading ? (
              <CircularProgress size={12} />
            ) : isExpanded ? (
              <LuChevronDown size={14} />
            ) : (
              <LuChevronRight size={14} />
            )}
          </Box>
        ) : (
          <Box sx={{ width: 14, flexShrink: 0 }} />
        )}
        {checkboxes && (
          <MuiCheckbox
            size="small"
            checked={isSelected}
            disabled={node.disabled}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onSelect?.(node.id)}
            sx={{ p: 0 }}
          />
        )}
        {node.icon && <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{node.icon}</Box>}
        <Typography variant="body2" sx={{ flex: 1, fontSize: 'inherit', color: 'inherit' }} noWrap>
          {node.label}
        </Typography>
        {node.badge}
      </Box>
      {hasChildren && children && (
        <Collapse in={isExpanded} unmountOnExit>
          {children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              expanded={expanded}
              onToggle={onToggle}
              checkboxes={checkboxes}
              lazyLoad={lazyLoad}
              onLoadChildren={onLoadChildren}
              loadingNodes={loadingNodes}
              setLoadingNodes={setLoadingNodes}
              dynamicChildren={dynamicChildren}
              setDynamicChildren={setDynamicChildren}
            />
          ))}
        </Collapse>
      )}
    </Box>
  );
}

export default function TreeView({
  nodes,
  selected,
  onSelect,
  expanded: controlledExpanded,
  onToggle: controlledOnToggle,
  checkboxes = false,
  lazyLoad = false,
  onLoadChildren,
  sx,
}: TreeViewProps) {
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(new Set());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [dynamicChildren, setDynamicChildren] = useState<Map<string, TreeNode[]>>(new Map());

  const expanded = controlledExpanded ? new Set(controlledExpanded) : internalExpanded;
  const onToggle = useCallback(
    (id: string) => {
      if (controlledOnToggle) {
        controlledOnToggle(id);
      } else {
        setInternalExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      }
    },
    [controlledOnToggle],
  );

  return (
    <Box sx={sx}>
      {nodes.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          selected={selected}
          onSelect={onSelect}
          expanded={expanded}
          onToggle={onToggle}
          checkboxes={checkboxes}
          lazyLoad={lazyLoad}
          onLoadChildren={onLoadChildren}
          loadingNodes={loadingNodes}
          setLoadingNodes={setLoadingNodes}
          dynamicChildren={dynamicChildren}
          setDynamicChildren={setDynamicChildren}
        />
      ))}
    </Box>
  );
}

TreeView.displayName = 'TreeView';
