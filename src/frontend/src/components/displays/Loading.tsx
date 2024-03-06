import Box from '@mui/joy/Box'
import CircularProgress from '@mui/joy/CircularProgress'

const Loading = () => {
  return (
    // return full screen with centered loading spinner
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%' }}>
      <CircularProgress />
    </Box>
  )
}

export default Loading
