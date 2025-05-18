import { Box, CircularProgress } from "@mui/joy"

/**
 * Primary loading page for the app
 */
const PrimaryLoading = () => {
  return (
    <Box sx={{ height: '100%', width: '100%', alignItems: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column' }}>
      <CircularProgress />
    </Box>
  )
}

export default PrimaryLoading

