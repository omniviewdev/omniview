import React from 'react'

import {
  Stack,
} from '@mui/joy';
import FooterLeftSide from './LeftSide';
import FooterRightSide from './RightSide';

const Footer: React.FC = () => {
  return (
    <Stack direction={'row'} alignItems={'center'} justifyContent={'space-between'} flexGrow={1}>
      <FooterLeftSide />
      <FooterRightSide />
    </Stack>
  )
}

export default Footer
