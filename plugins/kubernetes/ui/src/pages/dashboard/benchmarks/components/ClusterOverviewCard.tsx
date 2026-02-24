import * as React from 'react';
import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text, Heading } from '@omniviewdev/ui/typography';

type Props = {
  cluster: string
  icon: string
  passing: number
  warning: number
  failing: number
  score: number
}

export const ClusterOverviewCard: React.FC<Props> = ({ passing, warning, failing, score }) => {
  return (
    <Box sx={{ p: 0.5 }}>
      <Stack direction='row' gap={1}>
        <Box
          sx={{
            alignItems: 'center',
            justifyContent: 'center',
            px: 3,
            display: 'flex',
            gap: 2,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          <Stack direction='column' sx={{ flex: 1 }}>
            <Text size='xs' sx={{ fontWeight: 'bold', color: 'primary.main' }}>
              Score
            </Text>
            <Heading level={4} sx={{ fontWeight: 'bold' }}>{score}</Heading>
          </Stack>
        </Box>
        <Box
          sx={{
            bgcolor: 'background.level1',
            borderRadius: 1,
            p: 1,
            display: 'flex',
            flex: 1,
            gap: 2,
          }}
        >
          <Stack direction='column' sx={{ flex: 1 }}>
            <Text size='xs' sx={{ fontWeight: 'bold', color: 'success.main' }}>
              Passing
            </Text>
            <Text sx={{ fontWeight: 'bold' }}>{passing}</Text>
          </Stack>
          <Stack direction='column' sx={{ flex: 1 }}>
            <Text size='xs' sx={{ fontWeight: 'bold', color: 'warning.main' }}>
              Warning
            </Text>
            <Text sx={{ fontWeight: 'bold' }}>{warning}</Text>
          </Stack>
          <Stack direction='column' sx={{ flex: 1 }}>
            <Text size='xs' sx={{ fontWeight: 'bold', color: 'error.main' }}>
              Failing
            </Text>
            <Text sx={{ fontWeight: 'bold' }}>{failing}</Text>
          </Stack>
        </Box>
      </Stack>
    </Box>
  )
}

export default ClusterOverviewCard
