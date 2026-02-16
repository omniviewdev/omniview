import * as React from 'react';
import { Typography, Sheet, Stack } from '@mui/joy';

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
    <Sheet sx={{ padding: 0.5 }}>
      <Stack direction={'row'} gap={1}>
        <Sheet
          variant='outlined'
          sx={{
            alignItems: 'center',
            justifyContent: 'center',
            px: 3,
            display: 'flex',
            gap: 2,
          }}
        >
          <Stack direction={'column'} flex={1}>
            <Typography color='primary' level="body-xs" sx={{ fontWeight: 'lg' }}>
              Score
            </Typography>
            <Typography level='h4' sx={{ fontWeight: 'lg' }}>{score}</Typography>
          </Stack>
        </Sheet>
        <Sheet
          sx={{
            bgcolor: 'background.level1',
            borderRadius: 'sm',
            p: 1,
            display: 'flex',
            flex: 1,
            gap: 2,
          }}
        >
          <Stack direction={'column'} flex={1}>
            <Typography color='success' level="body-xs" sx={{ fontWeight: 'lg' }}>
              Passing
            </Typography>
            <Typography sx={{ fontWeight: 'lg' }}>{passing}</Typography>
          </Stack>
          <Stack direction={'column'} flex={1}>
            <Typography color='warning' level="body-xs" sx={{ fontWeight: 'lg' }}>
              Warning
            </Typography>
            <Typography sx={{ fontWeight: 'lg' }}>{warning}</Typography>
          </Stack>
          <Stack direction={'column'} flex={1}>
            <Typography color='danger' level="body-xs" sx={{ fontWeight: 'lg' }}>
              Failing
            </Typography>
            <Typography sx={{ fontWeight: 'lg' }}>{failing}</Typography>
          </Stack>
        </Sheet>
      </Stack>
    </Sheet>
  )
}

export default ClusterOverviewCard
