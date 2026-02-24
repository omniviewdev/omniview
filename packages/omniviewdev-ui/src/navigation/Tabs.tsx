import MuiTabs from '@mui/material/Tabs';
import MuiTab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import MuiIconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ComponentSize } from '../types';

export interface TabItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (key: string) => void;
  variant?: 'line' | 'pill' | 'segmented';
  size?: ComponentSize;
  closable?: boolean;
  onClose?: (key: string) => void;
  scrollable?: boolean;
  addButton?: boolean;
  onAdd?: () => void;
  sx?: SxProps<Theme>;
}

export default function Tabs({
  tabs,
  value,
  onChange,
  variant = 'line',
  size = 'md',
  closable = false,
  onClose,
  scrollable = false,
  addButton = false,
  onAdd,
  sx,
}: TabsProps) {
  const sizeMap: Record<string, { fontSize: string; minHeight: number; py: number }> = {
    xs: { fontSize: '0.6875rem', minHeight: 28, py: 0.25 },
    sm: { fontSize: '0.75rem', minHeight: 32, py: 0.5 },
    md: { fontSize: '0.8125rem', minHeight: 40, py: 1 },
    lg: { fontSize: '0.875rem', minHeight: 48, py: 1.5 },
    xl: { fontSize: '1rem', minHeight: 56, py: 2 },
  };
  const sizeStyles = sizeMap[size] || sizeMap.md;

  const variantSx: Record<string, SxProps<Theme>> = {
    line: {},
    pill: {
      '& .MuiTabs-indicator': { display: 'none' },
      '& .MuiTab-root': {
        borderRadius: '999px',
        minHeight: sizeStyles.minHeight,
        '&.Mui-selected': {
          bgcolor: 'var(--ov-accent-subtle)',
          color: 'var(--ov-accent-fg)',
        },
      },
    },
    segmented: {
      bgcolor: 'var(--ov-bg-surface-inset)',
      borderRadius: '8px',
      p: 0.5,
      minHeight: 'auto',
      '& .MuiTabs-indicator': { display: 'none' },
      '& .MuiTab-root': {
        borderRadius: '6px',
        minHeight: sizeStyles.minHeight - 8,
        '&.Mui-selected': {
          bgcolor: 'var(--ov-bg-surface)',
          color: 'var(--ov-fg-base)',
          boxShadow: 'var(--ov-shadow-sm)',
        },
      },
    },
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}) }}>
      <MuiTabs
        value={value}
        onChange={(_, newValue) => onChange(newValue)}
        variant={scrollable ? 'scrollable' : 'standard'}
        scrollButtons={scrollable ? 'auto' : false}
        sx={{
          minHeight: sizeStyles.minHeight,
          ...variantSx[variant],
        } as SxProps<Theme>}
      >
        {tabs.map((tab) => (
          <MuiTab
            key={tab.key}
            value={tab.key}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {tab.icon}
                <span>{tab.label}</span>
                {closable && (
                  <CloseIcon
                    sx={{ fontSize: 14, ml: 0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose?.(tab.key);
                    }}
                  />
                )}
              </Box>
            }
            disabled={tab.disabled}
            sx={{
              fontSize: sizeStyles.fontSize,
              minHeight: sizeStyles.minHeight,
              py: sizeStyles.py,
              textTransform: 'none',
              color: 'var(--ov-fg-default)',
            }}
          />
        ))}
      </MuiTabs>
      {addButton && (
        <MuiIconButton size="small" onClick={onAdd} sx={{ ml: 0.5 }}>
          <AddIcon fontSize="small" />
        </MuiIconButton>
      )}
    </Box>
  );
}

Tabs.displayName = 'Tabs';
