import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface LegendItem {
  label: string;
  color: string;
}

interface ChartLegendProps {
  items: LegendItem[];
  /** Compact mode: smaller dots/font, tighter spacing, left-aligned */
  compact?: boolean;
}

export default function ChartLegend({ items, compact = false }: ChartLegendProps) {
  if (items.length === 0) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: compact ? 0.75 : 1.5,
        justifyContent: compact ? 'flex-start' : 'center',
        px: 1,
        py: 0.5,
      }}
    >
      {items.map((item) => (
        <Box
          key={item.label}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
        >
          <Box
            sx={{
              width: compact ? 6 : 8,
              height: compact ? 6 : 8,
              borderRadius: '50%',
              bgcolor: item.color,
              flexShrink: 0,
            }}
          />
          <Typography
            variant="caption"
            sx={{
              fontSize: compact ? '0.625rem' : '0.6875rem',
              color: 'var(--ov-fg-muted)',
              lineHeight: 1,
            }}
          >
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
