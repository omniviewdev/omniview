import React from 'react';

// Material-ui
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';
import GradientBackground from '@/components/backgrounds/GradientBackground';

import { motion, AnimatePresence } from 'framer-motion';

// Logos
import Terraform from '@/assets/logos/terraform/horizontal/TerraformHorizontalColorWhite';
import Kubernetes from '@/assets/logos/kubernetes/horizontal/KubernetesHorizontalColorWhite';
import AWS from '@/assets/logos/aws/horizontal/AWSHorizontalColorWhite';
import GCP from '@/assets/logos/gcp/horizontal/GCPHorizontal';
import Docker from '@/assets/logos/docker/horizontal/DockerHorizontal';
import { Box } from '@mui/joy';

const logos = [
  <Kubernetes height={50} />,
  <AWS height={50} />,
  <Docker height={40} color={true} />,
  <Terraform height={60} />,
  <GCP height={40} color={true} />,
];

const images = [
  '/src/assets/images/app_preview.png',
  '/src/assets/images/app_preview_2.png',
];

const MotionBox = motion(Box);

/**
 * The main welcome landing page for the application.
 */
const Welcome = () => {
  const [toolIndex, _setToolIndex] = React.useState(0);
  const [imageIndex, _setImageIndex] = React.useState(0);

  // // run a rotation of tools every 3 seconds
  // React.useEffect(() => {
  //   const interval = setInterval(() => {
  //     setToolIndex((prevIndex) => (prevIndex + 1) % logos.length);
  //   }, 3000);
  //
  //
  //   return () => {
  //     clearInterval(interval); 
  //   };
  // }, []);
  //
  // // run a rotation of images every 5 seconds
  // React.useEffect(() => {
  //   const interval = setInterval(() => {
  //     setImageIndex((prevIndex) => (prevIndex + 1) % images.length);
  //   }, 9000);
  //   return () => {
  //     clearInterval(interval); 
  //   };
  // }, []);

  // Define the animation variants
  const variants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 },
    exit: { y: -20, opacity: 0 },
  };

  return (
    <GradientBackground>
      <Stack direction='column' gap={8} alignItems='center' justifyContent={'center'} height={'100%'}>
        <Stack direction='column' spacing={6} alignItems='center' width={'100%'}>
          <motion.div
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1 }}
            whileHover={{ scale: 1.01 }}
          >
            <Typography
              fontSize={72}
              fontWeight={800}
              sx={{
                textShadow: theme => `10px 10px 25px ${theme.palette.neutral[900]}, -10px 10px 25px ${theme.palette.neutral[900]}, -10px -10px 25px ${theme.palette.neutral[900]}, 10px -10px 25px ${theme.palette.neutral[900]};`,
              }}
            >
              Welcome to Omniview
            </Typography>
            <Stack direction='row' spacing={2} minHeight={70} alignItems='center' pl={20}>
              <Typography fontSize={30} fontWeight={700} color='neutral' sx={{ letterSpacing: '0.05rem' }}>
                The IDE for
              </Typography>
              <AnimatePresence mode='wait'>
                <motion.span
                  key={toolIndex}
                  variants={variants}
                  initial='hidden'
                  animate='visible'
                  exit='exit'
                  transition={{ duration: 0.5 }}
                >
                  {logos[toolIndex]}
                </motion.span>
              </AnimatePresence>
            </Stack>
          </motion.div>

          <AnimatePresence mode='wait'>
            <MotionBox
              key={imageIndex}
              initial={{ opacity: 0, y: 0 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 0 }}
              transition={{ type: 'spring', duration: 1.5, delay: 0.5 }}
              sx={{
                width: '50%',
                maxWidth: 900,
                borderRadius: 9,
                overflow: 'hidden',
                position: 'relative',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 1,
                  boxShadow: 'rgba(100, 100, 111, 0.2) 0px 7px 29px 0px;',
                  borderRadius: 'inherit',
                },
              }}
            >
              <Box
                component='img'
                src={images[imageIndex]}
                alt='App Preview'
                sx={{
                  width: '100%',
                  height: 'auto',
                  display: 'block',
                }}
              />
            </MotionBox>
          </AnimatePresence>
        </Stack>
      </Stack>
    </GradientBackground >
  );
};

export default Welcome;
