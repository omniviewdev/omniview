import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { useToast } from '@omniviewdev/ui/overlays';
import { Button } from '@omniviewdev/ui/buttons';

function ToastDemos() {
  const { toast, dismissAll } = useToast();

  return (
    <>
      <Example title="Convenience Methods">
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button emphasis="solid" color="success" size="sm" onClick={() => toast.success('Operation completed')}>
            Success
          </Button>
          <Button emphasis="solid" color="error" size="sm" onClick={() => toast.error('Something went wrong')}>
            Error
          </Button>
          <Button emphasis="solid" color="warning" size="sm" onClick={() => toast.warning('Resource is degraded')}>
            Warning
          </Button>
          <Button emphasis="solid" color="info" size="sm" onClick={() => toast.info('New version available')}>
            Info
          </Button>
        </Box>
      </Example>

      <Example title="Custom Options" description="Pass color, duration, and action.">
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            emphasis="outline"
            color="primary"
            size="sm"
            onClick={() =>
              toast({
                message: 'Custom toast with 10s duration',
                color: 'primary',
                duration: 10000,
              })
            }
          >
            Long Duration (10s)
          </Button>
          <Button
            emphasis="outline"
            color="accent"
            size="sm"
            onClick={() =>
              toast({
                message: 'Toast with action button',
                color: 'accent',
                action: (
                  <Button emphasis="ghost" color="neutral" size="xs" onClick={() => alert('Undo clicked')}>
                    Undo
                  </Button>
                ),
              })
            }
          >
            With Action
          </Button>
        </Box>
      </Example>

      <Example title="Dismiss All">
        <Button emphasis="ghost" color="neutral" size="sm" onClick={dismissAll}>
          Dismiss All Toasts
        </Button>
      </Example>
    </>
  );
}

export default function ToastPage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Toast
      </Typography>

      <Section
        title="Toast System"
        description="Toast notifications via useToast hook. Requires ToastProvider wrapping the app (already included in showcase)."
      >
        <ImportStatement code={`import { ToastProvider, useToast } from '@omniviewdev/ui/overlays';`} />

        <ToastDemos />

        <PropsTable
          props={[
            { name: 'toast(options)', type: '(options: ToastOptions) => void', description: 'Show a toast with full options' },
            { name: 'toast.success(msg)', type: '(message: string) => void', description: 'Success toast shorthand' },
            { name: 'toast.error(msg)', type: '(message: string) => void', description: 'Error toast shorthand' },
            { name: 'toast.warning(msg)', type: '(message: string) => void', description: 'Warning toast shorthand' },
            { name: 'toast.info(msg)', type: '(message: string) => void', description: 'Info toast shorthand' },
            { name: 'dismiss(id)', type: '(id: string) => void', description: 'Dismiss a specific toast' },
            { name: 'dismissAll()', type: '() => void', description: 'Dismiss all toasts' },
          ]}
        />
      </Section>
    </Box>
  );
}
