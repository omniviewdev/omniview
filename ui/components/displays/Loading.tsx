import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

const Loading = () => (
  // Return full screen with centered loading spinner
  <Box sx={{
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%',
  }}>
    <CircularProgress />
  </Box>
);

export default Loading;
