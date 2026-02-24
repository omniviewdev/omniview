import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiButton from '@mui/material/Button';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import NotificationStackProvider, { useNotificationStack } from '@omniviewdev/ui/feedback/NotificationStack';

function NotificationDemoButtons() {
  const { push, dismissAll } = useNotificationStack();

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      <MuiButton
        size="small"
        variant="outlined"
        onClick={() =>
          push({
            severity: 'info',
            title: 'Build started',
            message: 'Compiling kubernetes plugin...',
            timeout: 6000,
          })
        }
      >
        Info Toast
      </MuiButton>
      <MuiButton
        size="small"
        variant="outlined"
        color="success"
        onClick={() =>
          push({
            severity: 'success',
            title: 'Build complete',
            message: 'kubernetes plugin compiled in 2.3s',
            timeout: 5000,
          })
        }
      >
        Success Toast
      </MuiButton>
      <MuiButton
        size="small"
        variant="outlined"
        color="warning"
        onClick={() =>
          push({
            severity: 'warning',
            title: 'Deprecation warning',
            message: "The 'v1beta1' API version will be removed in a future release.",
            timeout: 8000,
          })
        }
      >
        Warning Toast
      </MuiButton>
      <MuiButton
        size="small"
        variant="outlined"
        color="error"
        onClick={() =>
          push({
            severity: 'error',
            title: 'Connection lost',
            message: 'Failed to connect to cluster "prod-east-1". Retrying in 5s...',
            timeout: 0, // no auto-dismiss
            actions: [
              { label: 'Retry Now', onClick: () => console.log('Retry clicked') },
              { label: 'Settings', onClick: () => console.log('Settings clicked') },
            ],
          })
        }
      >
        Error Toast (Persistent)
      </MuiButton>
      <MuiButton
        size="small"
        variant="text"
        color="inherit"
        onClick={dismissAll}
      >
        Dismiss All
      </MuiButton>
    </Box>
  );
}

export default function NotificationStackPage() {
  return (
    <NotificationStackProvider maxVisible={5} position="bottom-right">
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
          NotificationStack
        </Typography>

        <Section
          title="NotificationStack"
          description="VS Code-style notification toasts. Provider + hook pattern. Auto-dismissing with severity colors, action buttons, and stacking."
        >
          <ImportStatement code={`import { NotificationStackProvider, useNotificationStack } from '@omniviewdev/ui/feedback';`} />

          <Example title="Interactive: Push Notifications">
            <Typography sx={{ fontSize: 'var(--ov-text-sm)', color: 'var(--ov-fg-muted)', mb: 2 }}>
              Click buttons to trigger notifications. They appear in the bottom-right corner.
              Error toasts have no auto-dismiss and include action buttons.
            </Typography>
            <NotificationDemoButtons />
          </Example>

          <Example title="Usage Pattern">
            <Box
              component="pre"
              sx={{
                p: 2,
                borderRadius: '6px',
                bgcolor: 'var(--ov-bg-surface-inset)',
                fontSize: '0.75rem',
                fontFamily: 'var(--ov-font-mono)',
                color: 'var(--ov-fg-default)',
                overflow: 'auto',
              }}
            >
{`// Wrap your app with the provider
<NotificationStackProvider maxVisible={5} position="bottom-right">
  <App />
</NotificationStackProvider>

// In any child component:
const { push, dismiss, dismissAll } = useNotificationStack();

push({
  severity: 'success',
  title: 'Build complete',
  message: 'Compiled in 2.3s',
  timeout: 5000, // auto-dismiss after 5s (0 = persistent)
  actions: [{ label: 'View Log', onClick: () => {} }],
});`}
            </Box>
          </Example>
        </Section>
      </Box>
    </NotificationStackProvider>
  );
}
