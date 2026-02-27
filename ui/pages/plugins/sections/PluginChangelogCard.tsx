import * as React from 'react';

// Material-ui
import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Chip } from '@omniviewdev/ui';

// Third party
import MarkdownPreview from '@uiw/react-markdown-preview';

type Props = {
  version: string;
  releaseDate: string;
  changelog: string;
};

const PluginChangelogCard: React.FC<Props> = ({ version, releaseDate, changelog }) => (
  <Box sx={{ pb: 2 }}>
    <Stack direction='row' spacing={1.5} alignItems='center' sx={{ mb: 1 }}>
      <Chip
        size='sm'
        color='primary'
        emphasis='soft'
        label={version}
        sx={{ fontFamily: 'monospace', fontWeight: 600 }}
      />
      {releaseDate && (
        <Text size='xs' sx={{ color: 'text.secondary' }}>{releaseDate}</Text>
      )}
    </Stack>
    {changelog ? (
      <Box
        data-color-mode='dark'
        sx={{
          '& .wmde-markdown': {
            backgroundColor: 'transparent !important',
            fontSize: '0.8125rem',
            lineHeight: 1.65,
          },
          '& .wmde-markdown h1': { fontSize: '1.35rem', mt: 2, mb: 1 },
          '& .wmde-markdown h2': { fontSize: '1.1rem', mt: 2, mb: 0.75 },
          '& .wmde-markdown h3': { fontSize: '0.95rem', mt: 1.5, mb: 0.5 },
          '& .wmde-markdown h4': { fontSize: '0.875rem', mt: 1.5, mb: 0.5 },
          '& .wmde-markdown p': { fontSize: '0.8125rem', my: 0.75 },
          '& .wmde-markdown li': { fontSize: '0.8125rem' },
          '& .wmde-markdown code': { fontSize: '0.75rem' },
          '& .wmde-markdown table': { fontSize: '0.8125rem' },
        }}
      >
        <MarkdownPreview
          source={changelog}
          style={{ backgroundColor: 'transparent' }}
        />
      </Box>
    ) : (
      <Text size='sm' sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
        No changelog provided
      </Text>
    )}
  </Box>
);

export default PluginChangelogCard;
