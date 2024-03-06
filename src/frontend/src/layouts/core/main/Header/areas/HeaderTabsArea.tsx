import React from 'react'

// material-ui
import Box from '@mui/joy/Box'

// icons
import TabBarProvider from '@/providers/header/TabBarProvider'

/**
 * The tabs area in the header
 */
const HeaderTabsArea: React.FC = () => {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        gap: 1,
        width: 'calc(100% - var(--CoreLayoutHeader-inset))',
        height: '100%',
        justifyContent: 'flex-start',
        alignItems: 'center',
        px: 0.5,
        'WebkitUserSelect': 'none',
      }}
    >
      <TabBarProvider />
    </Box>
  )
}

export default HeaderTabsArea
