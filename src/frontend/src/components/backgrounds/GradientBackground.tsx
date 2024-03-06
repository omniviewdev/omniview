import Box from '@mui/joy/Box';
import { useTheme } from '@mui/joy';
import { keyframes } from '@emotion/react';
import { styled } from '@mui/joy';
import React from 'react';

// Define the gradient animation using keyframes from Emotion
const gradientAnimation = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;

// Use the styled function to create a styled component with dynamic styles
const AnimatedBox = styled(Box)(({ theme }) => ({
  width: '100%',
  height: '100%',
  color: '#fff',
  background: `linear-gradient(-45deg, ${theme.palette.primary[900]}, ${theme.palette.neutral[900]}, ${theme.palette.neutral[900]}, ${theme.palette.primary[900]})`,
  backgroundSize: '400% 400%',
  animation: `${gradientAnimation} 15s ease infinite`,
}));

type Props = {
  children?: React.ReactNode;
};

const GradientBackground: React.FC<Props> = ({ children }) => {
  const theme = useTheme();

  return (
    <AnimatedBox theme={theme}>
      {children}
    </AnimatedBox>
  );
};

export default GradientBackground;
