import * as React from 'react';

// Material-ui
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Card, Chip } from '@omniviewdev/ui';

// Icons
import InfoOutlined from '@mui/icons-material/InfoOutlined';

type Props = {
  version: string;
  releaseDate: string;
  changelog: string;
};

const PluginChangelogCard: React.FC<Props> = ({ version, releaseDate, changelog }) => (
  <Card
    sx={{ width: '100%', border: '1px solid', borderColor: 'divider' }}
  >
    <Stack direction='row' spacing={2} justifyContent='space-between'>
      <Stack direction='row' spacing={1} alignItems='center'>
        <InfoOutlined />
        <Text weight='semibold' size='lg'>
          {version}
        </Text>
      </Stack>
      {releaseDate && <Chip size='md' color='default' label={releaseDate} />}
    </Stack>
    {changelog && (
      <Text size='sm' sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
        {changelog}
      </Text>
    )}
  </Card>
);

export default PluginChangelogCard;
