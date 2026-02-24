import Box from "@mui/material/Box"
import { keyframes } from '@mui/material/styles'
import { Text } from '@omniviewdev/ui/typography'

const shimmer = keyframes`
  0% { transform: translateX(-100%) skewX(-15deg); }
  40% { transform: translateX(200%) skewX(-15deg); }
  100% { transform: translateX(200%) skewX(-15deg); }
`

interface PrimaryLoadingProps {
  message?: string;
}

/**
 * Primary loading page for the app
 */
const PrimaryLoading = ({ message }: PrimaryLoadingProps) => {
  return (
    <Box sx={{
      minHeight: '100vh',
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      display: 'flex',
      flexDirection: 'column',
      bgcolor: 'background.body',
      gap: 2.5,
    }}>
      <Box sx={{
        position: 'relative',
        width: 80,
        height: 80,
        borderRadius: '18px',
        overflow: 'hidden',
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          width: '50%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%)',
          animation: `${shimmer} 2.8s ease-in-out infinite`,
        },
      }}>
        <Box
          component="img"
          src="/appicon.png"
          alt=""
          sx={{ width: '100%', height: '100%', display: 'block' }}
        />
      </Box>
      {message && (
        <Text size="sm" sx={{ color: 'text.tertiary' }}>{message}</Text>
      )}
    </Box>
  )
}

export default PrimaryLoading
