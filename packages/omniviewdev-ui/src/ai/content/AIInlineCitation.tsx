import Box from '@mui/material/Box';
import MuiTooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AIInlineCitationProps {
  index: number;
  title?: string;
  url?: string;
  sx?: SxProps<Theme>;
}

export default function AIInlineCitation({
  index,
  title,
  url,
  sx,
}: AIInlineCitationProps) {
  const content = (
    <Box
      component={url ? 'a' : 'span'}
      {...(url ? { href: url, target: '_blank', rel: 'noopener noreferrer' } : {})}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: '50%',
        bgcolor: 'var(--ov-accent)',
        color: '#fff',
        fontSize: '10px',
        fontWeight: 700,
        lineHeight: 1,
        textDecoration: 'none',
        cursor: url ? 'pointer' : 'default',
        verticalAlign: 'super',
        mx: '1px',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {index}
    </Box>
  );

  if (title) {
    return <MuiTooltip title={title}>{content}</MuiTooltip>;
  }

  return content;
}

AIInlineCitation.displayName = 'AIInlineCitation';
