import * as React from 'react';

// Material-ui
import Divider from '@mui/material/Divider';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Card, Chip } from '@omniviewdev/ui';

// Icons
import InfoOutlined from '@mui/icons-material/InfoOutlined';

// Types
import { type Changelog } from './PluginChangelog';
import { LuBug, LuRocket, LuShieldQuestion } from 'react-icons/lu';

const PluginChangelogCard: React.FC<Changelog> = ({ version, releaseDate, changes }) => (
  <Card
    sx={{ width: '100%', border: '1px solid', borderColor: 'divider' }}
  >
    <Stack direction='row' spacing={2} justifyContent={'space-between'}>
      <Stack direction='row' spacing={1} alignItems='center'>
        <InfoOutlined />
        <Text weight='semibold' size='lg'>
          {version}
        </Text>
      </Stack>
      <Chip size='md' color='default' label={releaseDate} />
    </Stack>
    <Stack
      direction='column'
      gap={1}
    >
      {changes.feature.length > 0 && (
        <Stack direction='column' spacing={1}>
          <Stack direction='row' spacing={1} alignItems='center'>
            <LuRocket />
            <Text weight='semibold'>
                Features
            </Text>
          </Stack>
          <Divider />
          {changes.feature.map((feature, i) => (
            <Text key={i} size='xs'>
              {feature}
            </Text>
          ))}
        </Stack>
      )}
      {changes.bugfix.length > 0 && (
        <Stack direction='column' spacing={1}>
          <Stack direction='row' spacing={1} alignItems='center'>
            <LuBug />
            <Text weight='semibold'>
                Bug Fixes
            </Text>
          </Stack>
          <Divider />
          {changes.feature.map((feature, i) => (
            <Text key={i} size='xs'>
              {feature}
            </Text>
          ))}
        </Stack>
      )}
      {changes.security.length > 0 && (
        <Stack direction='column' spacing={1}>
          <Stack direction='row' spacing={1} alignItems='center'>
            <LuShieldQuestion />
            <Text weight='semibold'>
                Security
            </Text>
          </Stack>
          <Divider />
          {changes.feature.map((feature, i) => (
            <Text key={i} size='xs'>
              {feature}
            </Text>
          ))}
        </Stack>
      )}

    </Stack>
  </Card>
);

export default PluginChangelogCard;
