import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Dialog } from '../../overlays';
import { Button } from '../../buttons';

export default function DialogPage() {
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Dialog
      </Typography>

      <Section
        title="Dialog"
        description="Modal dialog with title, content, and action buttons. Supports confirm and danger variants."
      >
        <ImportStatement code="import { Dialog } from '@omniviewdev/ui/overlays';" />

        <Example title="Default Dialog">
          <Button emphasis="outline" color="primary" onClick={() => setDefaultOpen(true)}>
            Open Dialog
          </Button>
          <Dialog
            open={defaultOpen}
            onClose={() => setDefaultOpen(false)}
            title="Default Dialog"
            actions={
              <>
                <Button emphasis="ghost" color="neutral" onClick={() => setDefaultOpen(false)}>
                  Cancel
                </Button>
                <Button emphasis="solid" color="primary" onClick={() => setDefaultOpen(false)}>
                  Save
                </Button>
              </>
            }
          >
            <Typography sx={{ color: 'var(--ov-fg-default)' }}>
              This is a standard dialog with title, content, and action buttons.
            </Typography>
          </Dialog>
        </Example>

        <Example title="Confirm Variant">
          <Button emphasis="outline" color="warning" onClick={() => setConfirmOpen(true)}>
            Open Confirm Dialog
          </Button>
          <Dialog
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            title="Confirm Action"
            variant="confirm"
            actions={
              <>
                <Button emphasis="ghost" color="neutral" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button emphasis="solid" color="primary" onClick={() => setConfirmOpen(false)}>
                  Confirm
                </Button>
              </>
            }
          >
            <Typography sx={{ color: 'var(--ov-fg-default)' }}>
              Are you sure you want to proceed with this action?
            </Typography>
          </Dialog>
        </Example>

        <Example title="Danger Variant">
          <Button emphasis="outline" color="error" onClick={() => setDangerOpen(true)}>
            Open Danger Dialog
          </Button>
          <Dialog
            open={dangerOpen}
            onClose={() => setDangerOpen(false)}
            title="Delete Resource"
            variant="danger"
            actions={
              <>
                <Button emphasis="ghost" color="neutral" onClick={() => setDangerOpen(false)}>
                  Cancel
                </Button>
                <Button emphasis="solid" color="error" onClick={() => setDangerOpen(false)}>
                  Delete
                </Button>
              </>
            }
          >
            <Typography sx={{ color: 'var(--ov-fg-default)' }}>
              This will permanently delete the resource. This action cannot be undone.
            </Typography>
          </Dialog>
        </Example>

        <Example title="Fullscreen">
          <Button emphasis="outline" color="neutral" onClick={() => setFullscreenOpen(true)}>
            Open Fullscreen
          </Button>
          <Dialog
            open={fullscreenOpen}
            onClose={() => setFullscreenOpen(false)}
            title="Fullscreen Dialog"
            size="fullscreen"
            actions={
              <Button emphasis="solid" color="primary" onClick={() => setFullscreenOpen(false)}>
                Close
              </Button>
            }
          >
            <Typography sx={{ color: 'var(--ov-fg-default)' }}>
              This dialog takes up the entire viewport.
            </Typography>
          </Dialog>
        </Example>

        <PropsTable
          props={[
            { name: 'open', type: 'boolean', description: 'Whether the dialog is visible' },
            { name: 'onClose', type: '() => void', description: 'Close handler' },
            { name: 'title', type: 'string', description: 'Dialog title in the header' },
            { name: 'icon', type: 'ReactNode', description: 'Icon next to the title' },
            { name: 'size', type: "'sm' | 'md' | 'lg' | 'xl' | 'fullscreen'", default: "'md'", description: 'Dialog width preset' },
            { name: 'variant', type: "'default' | 'confirm' | 'danger'", default: "'default'", description: 'Visual style preset' },
            { name: 'actions', type: 'ReactNode', description: 'Footer action buttons' },
            { name: 'disableBackdropClose', type: 'boolean', default: 'false', description: 'Prevent closing on backdrop click' },
            { name: 'children', type: 'ReactNode', description: 'Dialog body content' },
          ]}
        />
      </Section>
    </Box>
  );
}
