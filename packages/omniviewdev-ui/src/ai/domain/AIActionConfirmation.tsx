import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import type { SxProps, Theme } from '@mui/material/styles';

type Risk = 'low' | 'medium' | 'high' | 'critical';

const riskConfig: Record<Risk, { color: string; label: string; icon: React.ReactNode }> = {
  low: {
    color: 'var(--ov-info-default)',
    label: 'Low Risk',
    icon: null,
  },
  medium: {
    color: 'var(--ov-warning-default)',
    label: 'Medium Risk',
    icon: <WarningAmberIcon sx={{ fontSize: 14 }} />,
  },
  high: {
    color: 'var(--ov-danger-default)',
    label: 'High Risk',
    icon: <WarningAmberIcon sx={{ fontSize: 14 }} />,
  },
  critical: {
    color: 'var(--ov-danger-emphasis)',
    label: 'Critical',
    icon: <ErrorOutlineIcon sx={{ fontSize: 14 }} />,
  },
};

interface AffectedResource {
  kind: string;
  name: string;
  icon?: React.ReactNode;
}

export interface AIActionConfirmationProps {
  action: string;
  description?: string;
  affectedResources?: AffectedResource[];
  risk: Risk;
  onConfirm: () => void;
  onCancel: () => void;
  sx?: SxProps<Theme>;
}

export default function AIActionConfirmation({
  action,
  description,
  affectedResources,
  risk,
  onConfirm,
  onCancel,
  sx,
}: AIActionConfirmationProps) {
  const config = riskConfig[risk];

  return (
    <Box
      sx={{
        borderRadius: '8px',
        border: `1px solid ${risk === 'low' ? 'var(--ov-border-default)' : config.color}`,
        bgcolor: 'var(--ov-bg-surface)',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          bgcolor: `color-mix(in srgb, ${config.color} 8%, transparent)`,
          borderBottom: '1px solid var(--ov-border-default)',
        }}
      >
        {config.icon && (
          <Box sx={{ color: config.color, display: 'flex' }}>
            {config.icon}
          </Box>
        )}
        <Typography
          sx={{
            fontSize: 'var(--ov-text-sm)',
            fontWeight: 'var(--ov-weight-semibold)',
            color: 'var(--ov-fg-default)',
            flex: 1,
          }}
        >
          {action}
        </Typography>
        <Chip
          size="small"
          label={config.label}
          sx={{
            height: 20,
            fontSize: 'var(--ov-text-xs)',
            fontWeight: 'var(--ov-weight-medium)',
            bgcolor: `color-mix(in srgb, ${config.color} 15%, transparent)`,
            color: config.color,
          }}
        />
      </Box>

      {/* Description */}
      {description && (
        <Box sx={{ px: 1.5, py: 0.75 }}>
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-fg-muted)',
              lineHeight: 1.5,
            }}
          >
            {description}
          </Typography>
        </Box>
      )}

      {/* Affected resources */}
      {affectedResources && affectedResources.length > 0 && (
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            borderTop: '1px solid var(--ov-border-muted)',
          }}
        >
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-fg-faint)',
              fontWeight: 'var(--ov-weight-medium)',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              mb: 0.5,
            }}
          >
            Affected Resources
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {affectedResources.map((res, i) => (
              <Chip
                key={i}
                size="small"
                icon={res.icon ? <span style={{ display: 'flex', alignItems: 'center' }}>{res.icon}</span> : undefined}
                label={`${res.kind}/${res.name}`}
                variant="outlined"
                sx={{
                  fontFamily: 'var(--ov-font-mono)',
                  fontSize: 'var(--ov-text-xs)',
                  borderColor: 'var(--ov-border-default)',
                  color: 'var(--ov-fg-default)',
                  height: 22,
                  '& .MuiChip-icon': { ml: 0.5, mr: 0 },
                }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Actions */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 0.75,
          px: 1.5,
          py: 0.75,
          borderTop: '1px solid var(--ov-border-default)',
          bgcolor: 'var(--ov-bg-surface-inset)',
        }}
      >
        <Button
          size="small"
          onClick={onCancel}
          sx={{
            fontSize: 'var(--ov-text-xs)',
            color: 'var(--ov-fg-muted)',
            textTransform: 'none',
          }}
        >
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={onConfirm}
          sx={{
            fontSize: 'var(--ov-text-xs)',
            bgcolor: risk === 'low' ? 'var(--ov-accent)' : config.color,
            color: '#fff',
            textTransform: 'none',
            '&:hover': {
              bgcolor: risk === 'low' ? 'var(--ov-accent-muted)' : config.color,
              filter: 'brightness(0.9)',
            },
          }}
        >
          Confirm
        </Button>
      </Box>
    </Box>
  );
}

AIActionConfirmation.displayName = 'AIActionConfirmation';
