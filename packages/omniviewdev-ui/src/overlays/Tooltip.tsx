import MuiTooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';

export interface TooltipProps {
  title: React.ReactNode;
  variant?: 'default' | 'rich' | 'code';
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
  delay?: number;
  children: React.ReactElement;
}

export default function Tooltip({
  title,
  variant = 'default',
  placement = 'top',
  delay,
  children,
}: TooltipProps) {
  const tooltipContent =
    variant === 'code' ? (
      <Box
        sx={{
          fontFamily: 'var(--ov-font-mono)',
          fontSize: 'var(--ov-text-xs)',
          bgcolor: 'var(--ov-bg-surface-inset)',
          px: 1,
          py: 0.5,
          borderRadius: '3px',
        }}
      >
        {title}
      </Box>
    ) : variant === 'rich' ? (
      <Box sx={{ p: 1, maxWidth: 320 }}>{title}</Box>
    ) : (
      title
    );

  return (
    <MuiTooltip
      title={tooltipContent}
      placement={placement}
      enterDelay={delay}
      enterNextDelay={delay}
      arrow={variant === 'default'}
    >
      {children}
    </MuiTooltip>
  );
}

Tooltip.displayName = 'Tooltip';
