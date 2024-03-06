import React from 'react'

// material-ui
import Input from '@mui/joy/Input'
import IconButton from '@mui/joy/IconButton'
import Typography from '@mui/joy/Typography'

// icons
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'

/**
 * The search area in the header.
 */
const HeaderSearchArea: React.FC = () => {
  return (
    <Input
      size="sm"
      variant="outlined"
      placeholder="Search anything…"
      startDecorator={<SearchRoundedIcon color="primary" />}
      endDecorator={
        <IconButton variant="outlined" color="neutral">
          <Typography fontWeight="lg" fontSize="sm" textColor="text.icon">
            ⌘ + k
          </Typography>
        </IconButton>
      }
      sx={{
        flexBasis: '500px',
        display: 'flex',
        boxShadow: 'sm',
        minWidth: {
          md: 400,
          lg: 400,
          xl: 500,
        },
        '--wails-draggable': 'no-drag',
      }}
    />

  )
}

export default HeaderSearchArea
