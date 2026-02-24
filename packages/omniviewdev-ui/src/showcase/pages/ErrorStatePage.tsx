import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { ErrorState } from '../../feedback';

export default function ErrorStatePage() {
  const [retryCount, setRetryCount] = useState(0);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        ErrorState
      </Typography>

      <ImportStatement code="import { ErrorState } from '@omniviewdev/ui/feedback';" />

      <PropsTable
        props={[
          { name: 'message', type: 'string', default: '—', description: 'Error description shown to the user' },
          { name: 'errorId', type: 'string', default: '—', description: 'Optional error ID shown in a copyable badge' },
          { name: 'onRetry', type: '() => void', default: '—', description: 'Callback for the retry button. Button hidden if omitted.' },
          { name: 'variant', type: "'page' | 'panel' | 'inline'", default: "'panel'", description: 'Size/layout variant' },
        ]}
      />

      {/* ---- Page variant ---- */}
      <Section
        title="Page variant"
        description="Full-page error state with large icon, centered layout, and min-height for route-level errors."
      >
        <Example title="Page — with retry and error ID">
          <Box sx={{ border: '1px dashed var(--ov-border-default)', borderRadius: '8px', overflow: 'hidden' }}>
            <ErrorState
              variant="page"
              message="The kubernetes plugin failed to load from the dev server. Ensure the plugin process is running."
              errorId="ERR-PLG-K8S-001"
              onRetry={() => setRetryCount(c => c + 1)}
            />
          </Box>
        </Example>

        <Example title="Page — no retry">
          <Box sx={{ border: '1px dashed var(--ov-border-default)', borderRadius: '8px', overflow: 'hidden' }}>
            <ErrorState
              variant="page"
              message="Unable to connect to the cluster API server."
            />
          </Box>
        </Example>
      </Section>

      {/* ---- Panel variant ---- */}
      <Section
        title="Panel variant (default)"
        description="Medium-sized error for sidebars, cards, and panels."
      >
        <Example title="Panel — with retry">
          <Box sx={{ maxWidth: 400, border: '1px dashed var(--ov-border-default)', borderRadius: '8px', overflow: 'hidden' }}>
            <ErrorState
              message="Failed to fetch resource list."
              onRetry={() => setRetryCount(c => c + 1)}
            />
          </Box>
        </Example>

        <Example title="Panel — with error ID">
          <Box sx={{ maxWidth: 400, border: '1px dashed var(--ov-border-default)', borderRadius: '8px', overflow: 'hidden' }}>
            <ErrorState
              message="gRPC connection timed out after 30s."
              errorId="ERR-GRPC-TIMEOUT"
            />
          </Box>
        </Example>
      </Section>

      {/* ---- Inline variant ---- */}
      <Section
        title="Inline variant"
        description="Compact inline error for table cells, form fields, or tight spaces."
      >
        <Example title="Inline — with retry">
          <ErrorState
            variant="inline"
            message="Port forward failed"
            onRetry={() => setRetryCount(c => c + 1)}
          />
        </Example>

        <Example title="Inline — no retry">
          <ErrorState variant="inline" message="Connection refused" />
        </Example>
      </Section>

      {retryCount > 0 && (
        <Typography variant="caption" sx={{ color: 'var(--ov-fg-faint)', mt: 2, display: 'block' }}>
          Retry clicked {retryCount} time{retryCount !== 1 ? 's' : ''} (demo only)
        </Typography>
      )}
    </Box>
  );
}
