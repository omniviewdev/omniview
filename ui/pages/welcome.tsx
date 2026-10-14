import React from 'react';

import GradientBackground from '@/components/backgrounds/GradientBackground';

import { motion } from 'framer-motion';

import styles from './welcome.module.css';

// Logos
import Terraform from '@/assets/logos/terraform/horizontal/TerraformHorizontalColorWhite';
import Kubernetes from '@/assets/logos/kubernetes/horizontal/KubernetesHorizontalColorWhite';
import AWS from '@/assets/logos/aws/horizontal/AWSHorizontalColorWhite';
import GCP from '@/assets/logos/gcp/horizontal/GCPHorizontal';
import Docker from '@/assets/logos/docker/horizontal/DockerHorizontal';

const logos = [
  <Kubernetes height={50} />,
  <AWS height={50} />,
  <Docker height={40} color={true} />,
  <Terraform height={60} />,
  <GCP height={40} color={true} />,
];

// const images = [
//   '/public/images/app_preview.png',
//   '/public/images/app_preview_2.png',
// ];

// const MotionBox = motion(Box);

/**
 * The main welcome landing page for the application.
 */
const Welcome = () => {
  const [toolIndex, _setToolIndex] = React.useState(0);
  // const [imageIndex, _setImageIndex] = React.useState(0);

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
      <div className={styles.Root}>
        <div className={styles.Hero}>
          <div className={styles.Title}>
            Omniview
          </div>
          <div className={styles.Tagline}>
            <span className={styles.TaglineText}>
              The IDE for
            </span>
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
          </div>

          {/* <AnimatePresence mode='wait'> */}
          {/*   <MotionBox */}
          {/*     key={imageIndex} */}
          {/*     initial={{ opacity: 0, y: 0 }} */}
          {/*     animate={{ opacity: 1, y: 0 }} */}
          {/*     exit={{ opacity: 0, y: 0 }} */}
          {/*     transition={{ type: 'spring', duration: 1.5, delay: 0.5 }} */}
          {/*     sx={{ */}
          {/*       width: '50%', */}
          {/*       maxWidth: 900, */}
          {/*       borderRadius: 9, */}
          {/*       overflow: 'hidden', */}
          {/*       position: 'relative', */}
          {/*       '&::before': { */}
          {/*         content: '""', */}
          {/*         position: 'absolute', */}
          {/*         top: 0, */}
          {/*         left: 0, */}
          {/*         right: 0, */}
          {/*         bottom: 0, */}
          {/*         zIndex: 1, */}
          {/*         boxShadow: 'rgba(100, 100, 111, 0.2) 0px 7px 29px 0px;', */}
          {/*         borderRadius: 'inherit', */}
          {/*       }, */}
          {/*     }} */}
          {/*   > */}
          {/*     <Box */}
          {/*       component='img' */}
          {/*       src={images[imageIndex]} */}
          {/*       alt='App Preview' */}
          {/*       sx={{ */}
          {/*         width: '100%', */}
          {/*         height: 'auto', */}
          {/*         display: 'block', */}
          {/*       }} */}
          {/*     /> */}
          {/*   </MotionBox> */}
          {/* </AnimatePresence> */}
        </div>
      </div>
    </GradientBackground >
  );
};

Welcome.displayName = 'Welcome';
Welcome.whyDidYouRender = true;

export default Welcome;
