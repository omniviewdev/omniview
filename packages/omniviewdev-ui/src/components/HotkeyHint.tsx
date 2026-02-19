import Box from '@mui/material/Box';

export interface HotkeyHintProps {
  keys: string[];
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);

function mapKey(key: string): string {
  if (key === 'Meta') return isMac ? '\u2318' : 'Ctrl';
  if (key === 'Control') return isMac ? '\u2303' : 'Ctrl';
  if (key === 'Alt') return isMac ? '\u2325' : 'Alt';
  if (key === 'Shift') return '\u21E7';
  if (key === 'Enter') return '\u23CE';
  if (key === 'Escape') return 'Esc';
  if (key === 'Backspace') return '\u232B';
  if (key === 'Delete') return 'Del';
  if (key === 'ArrowUp') return '\u2191';
  if (key === 'ArrowDown') return '\u2193';
  if (key === 'ArrowLeft') return '\u2190';
  if (key === 'ArrowRight') return '\u2192';
  return key;
}

export default function HotkeyHint({ keys }: HotkeyHintProps) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
      {keys.map((key, i) => (
        <Box
          key={i}
          component="kbd"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 20,
            minWidth: 20,
            px: '5px',
            fontFamily: 'var(--ov-font-ui)',
            fontSize: '0.6875rem',
            fontWeight: 500,
            lineHeight: 1,
            color: 'var(--ov-fg-muted)',
            bgcolor: 'var(--ov-bg-subtle)',
            border: '1px solid var(--ov-border-default)',
            borderRadius: '4px',
            boxShadow: '0 1px 0 var(--ov-border-muted)',
          }}
        >
          {mapKey(key)}
        </Box>
      ))}
    </Box>
  );
}

HotkeyHint.displayName = 'HotkeyHint';
