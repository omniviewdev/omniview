import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';
import { keyframes } from '@emotion/react';
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
  background: `linear-gradient(-45deg, ${theme.palette.primary.dark}, ${theme.palette.grey[900]}, ${theme.palette.grey[900]}, ${theme.palette.primary.dark})`,
  backgroundSize: '400% 400%',
  animation: `${gradientAnimation} 15s ease infinite`,
}));

type Props = {
  children?: React.ReactNode;
};

const GradientBackground: React.FC<Props> = ({ children }) => {
  return (
    <AnimatedBox>
      {children}
    </AnimatedBox>
  );
};

export default GradientBackground;
