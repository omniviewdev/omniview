import type { CSSProperties } from 'react';

// Layout only: base-ui owns surface, typography, control and code styling.
// Keep layout in the runtime bundle so consumers need no extra CSS entry point.
export const styles = {
  Panel: {
    position: 'fixed', right: 'var(--ov-space-3)', bottom: 36,
    zIndex: 'calc(var(--ov-z-toast, 9999) + 1)',
    width: 'min(480px, calc(100vw - 24px))', minWidth: 0,
    maxHeight: 'min(560px, calc(100dvh - 64px))',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0,
  },
  Header: {
    flex: 'none', gap: 'var(--ov-space-2)', paddingInline: 'var(--ov-space-3)',
    background: 'var(--ov-color-bg-surface-raised)',
    borderBottom: '1px solid var(--ov-color-border-muted)',
  },
  HeaderActions: { marginLeft: 'auto' },
  List: { minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' },
  Notice: { borderTop: '1px solid var(--ov-color-border-muted)' },
  Row: {
    display: 'flex', alignItems: 'center', gap: 'var(--ov-space-1)',
    padding: 'var(--ov-space-2) var(--ov-space-2) var(--ov-space-2) var(--ov-space-3)',
  },
  ErrorIcon: { flex: 'none', color: 'var(--ov-color-danger)' },
  Message: { flex: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'left' },
  MessageText: { minWidth: 0, overflowWrap: 'anywhere' },
  Details: { padding: '0 var(--ov-space-3) var(--ov-space-3) 36px' },
  Code: {
    display: 'block', margin: 'var(--ov-space-2) 0', padding: 'var(--ov-space-3)',
    maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    lineHeight: 1.5, userSelect: 'text',
  },
  Actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--ov-space-2)' },
  CopyError: {
    margin: 0, padding: 'var(--ov-space-3)',
    borderTop: '1px solid var(--ov-color-border-muted)',
  },
} satisfies Record<string, CSSProperties>;
