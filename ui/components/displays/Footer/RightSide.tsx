import React from 'react'

import {
  Stack,
  IconButton,
} from '@mui/joy';
import LoadingIndicator from './LoadingIndicator';
import { LuBell } from 'react-icons/lu';

const FooterRightSide: React.FC = () => {
  return (
    <Stack direction={'row'} alignItems={'center'} justifyContent={'flex-end'} spacing={1}>
      <LoadingIndicator />

      <IconButton
        size="sm"
        variant="plain"
        color="neutral"
        sx={{
          '--IconButton-size': '18px'
        }}
      >
        <LuBell />
      </IconButton>
    </Stack>
  )
}

export default FooterRightSide
