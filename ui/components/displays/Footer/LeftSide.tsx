import React from 'react'

import {
  Stack,
  Chip,
} from '@mui/joy';

/**
 * Display on the bottom left side of the footer
 */
const FooterLeftSide: React.FC = () => {
  return (
    <Stack direction={'row'} alignItems={'center'} justifyContent={'flex-start'}>
      {import.meta.env.DEV && (
        <Chip
          color='warning'
          size="sm"
          variant="soft"
          sx={{
            maxHeight: "13px",
            "--Chip-radius": "2px",
            "--Chip-minHeight": "13px",
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          DEVELOPMENT MODE
        </Chip>
      )}
    </Stack>
  )
}

export default FooterLeftSide
