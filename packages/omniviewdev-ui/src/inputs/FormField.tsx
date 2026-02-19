import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

export interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  helperText?: string;
  children: React.ReactNode;
  layout?: 'vertical' | 'horizontal';
  sx?: SxProps<Theme>;
}

export default function FormField({
  label,
  required = false,
  error,
  helperText,
  children,
  layout = 'vertical',
  sx,
}: FormFieldProps) {
  const isHorizontal = layout === 'horizontal';

  return (
    <Box
      sx={{
        mb: 2,
        ...(isHorizontal && {
          display: 'grid',
          gridTemplateColumns: '1fr 2fr',
          gap: 2,
          alignItems: 'start',
        }),
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Typography
        component="label"
        variant="body2"
        sx={{
          fontWeight: 500,
          color: 'var(--ov-fg-default)',
          fontSize: 'var(--ov-text-sm)',
          mb: isHorizontal ? 0 : 0.5,
          pt: isHorizontal ? 1 : 0,
          display: 'block',
        }}
      >
        {label}
        {required && (
          <Box component="span" sx={{ color: 'var(--ov-danger-default)', ml: 0.25 }}>
            *
          </Box>
        )}
      </Typography>

      <Box>
        {children}
        {(error || helperText) && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mt: 0.5,
              fontSize: 'var(--ov-text-xs)',
              color: error ? 'var(--ov-danger-default)' : 'var(--ov-fg-faint)',
            }}
          >
            {error ?? helperText}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

FormField.displayName = 'FormField';
