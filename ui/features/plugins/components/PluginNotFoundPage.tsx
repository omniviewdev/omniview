import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuArrowLeft, LuFileQuestion } from 'react-icons/lu';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Rendered when no route matches within a plugin. Shows a clean "page not found"
 * message with the unmatched path and a back button.
 */
export default function PluginNotFoundPage() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        minHeight: '60vh',
        py: 8,
        px: 3,
      }}
    >
      <LuFileQuestion
        size={56}
        style={{ color: 'var(--ov-fg-muted)', marginBottom: 16, opacity: 0.6 }}
      />

      <Typography
        variant="h5"
        sx={{ color: 'var(--ov-fg-default)', fontWeight: 600, mb: 0.5 }}
      >
        Page not found
      </Typography>

      <Typography
        variant="body1"
        sx={{ color: 'var(--ov-fg-muted)', mb: 2, maxWidth: 460 }}
      >
        The route you navigated to doesn't exist within this plugin.
      </Typography>

      {/* Path detail */}
      <Box
        sx={{
          maxWidth: 560,
          width: '100%',
          mb: 3,
          p: 1.5,
          borderRadius: '6px',
          bgcolor: 'action.hover',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontFamily: 'var(--ov-font-mono, monospace)',
            fontSize: '0.75rem',
            color: 'var(--ov-fg-muted)',
            wordBreak: 'break-word',
          }}
        >
          {location.pathname}
        </Typography>
      </Box>

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 1.5 }}>
        <Box
          component="button"
          onClick={() => navigate(-1)}
          sx={{
            all: 'unset',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            px: 2,
            py: 1,
            fontSize: '0.8125rem',
            fontWeight: 500,
            fontFamily: 'var(--ov-font-ui)',
            color: '#fff',
            bgcolor: 'var(--ov-accent-default)',
            borderRadius: '6px',
            cursor: 'pointer',
            '&:hover': { filter: 'brightness(1.1)' },
          }}
        >
          <LuArrowLeft size={14} />
          Go Back
        </Box>
      </Box>
    </Box>
  );
}
