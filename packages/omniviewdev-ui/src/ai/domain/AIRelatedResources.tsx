import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import type { SxProps, Theme } from '@mui/material/styles';

interface ResourceNode {
  kind: string;
  name: string;
  icon?: React.ReactNode;
}

interface RelatedResource extends ResourceNode {
  relationship: string;
}

export interface AIRelatedResourcesProps {
  primary: ResourceNode;
  related: RelatedResource[];
  onNavigate?: (kind: string, name: string) => void;
  sx?: SxProps<Theme>;
}

export default function AIRelatedResources({
  primary,
  related,
  onNavigate,
  sx,
}: AIRelatedResourcesProps) {
  return (
    <Box
      sx={{
        borderRadius: '8px',
        border: '1px solid var(--ov-border-default)',
        bgcolor: 'var(--ov-bg-surface)',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Primary resource */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: '1px solid var(--ov-border-default)',
        }}
      >
        {primary.icon && (
          <Box sx={{ color: 'var(--ov-accent)', display: 'flex' }}>
            {primary.icon}
          </Box>
        )}
        <Chip
          size="small"
          label={primary.kind}
          sx={{
            bgcolor: 'var(--ov-accent-subtle)',
            color: 'var(--ov-accent-fg)',
            fontWeight: 'var(--ov-weight-semibold)',
            fontSize: 'var(--ov-text-xs)',
            height: 22,
          }}
        />
        <Typography
          sx={{
            fontFamily: 'var(--ov-font-mono)',
            fontSize: 'var(--ov-text-sm)',
            fontWeight: 'var(--ov-weight-medium)',
            color: 'var(--ov-fg-default)',
          }}
        >
          {primary.name}
        </Typography>
      </Box>

      {/* Related resources */}
      <Box>
        {related.map((res, i) => (
          <Box
            key={i}
            onClick={onNavigate ? () => onNavigate(res.kind, res.name) : undefined}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 0.75,
              cursor: onNavigate ? 'pointer' : 'default',
              '&:hover': onNavigate
                ? { bgcolor: 'var(--ov-state-hover)' }
                : undefined,
              borderBottom:
                i < related.length - 1
                  ? '1px solid var(--ov-border-muted)'
                  : 'none',
            }}
          >
            {/* Connector line */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  width: 16,
                  height: 1,
                  bgcolor: 'var(--ov-border-default)',
                  flexShrink: 0,
                }}
              />
              <Typography
                sx={{
                  fontSize: '10px',
                  color: 'var(--ov-fg-faint)',
                  whiteSpace: 'nowrap',
                  fontStyle: 'italic',
                }}
              >
                {res.relationship}
              </Typography>
            </Box>

            {res.icon && (
              <Box sx={{ color: 'var(--ov-fg-muted)', display: 'flex' }}>
                {res.icon}
              </Box>
            )}

            <Chip
              size="small"
              label={res.kind}
              variant="outlined"
              sx={{
                borderColor: 'var(--ov-border-default)',
                color: 'var(--ov-fg-muted)',
                fontSize: 'var(--ov-text-xs)',
                height: 20,
              }}
            />
            <Typography
              sx={{
                fontFamily: 'var(--ov-font-mono)',
                fontSize: 'var(--ov-text-xs)',
                color: 'var(--ov-fg-default)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {res.name}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

AIRelatedResources.displayName = 'AIRelatedResources';
