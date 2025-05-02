import Grid from '@mui/joy/Grid';
import { Stack, Divider, LinearProgress, Typography, Box } from '@mui/joy';
import React from 'react';
// import { Scan } from '@api/trivy/Manager';
// import { trivy } from '@omniviewdev/runtime/models';

import TrivyVulnerabilitiesReport from '../vulnerabilities/VulnerabilityReport';
// import TrivyScanHeader from './TrivyScanHeader';

// Underlying client
// import { Get, Update, Delete } from '@api/trivy/Manager';

const TrivyDashboard = () => {
  // const cards = [
  //   { scanner: 'vulnerability', title: 'Vulnerability', description: 'View the vulnerabilities in your project', icon: 'LuShieldCheck' },
  //   { scanner: 'misconfiguration', title: 'Misconfiguration', description: 'View the misconfigurations in your project', icon: 'LuSettings' },
  //   { scanner: 'license', title: 'License', description: 'View the licenses in your project', icon: 'LuScale' },
  //   { scanner: 'sbom', title: 'SBOM', description: 'View the SBOM in your project', icon: 'LuPackageSearch' },
  // ];

  const [output, _] = React.useState<Record<string, unknown> | null>(null);
  const [loading, __] = React.useState(false);

  // const scanImage = (target: trivy.Command, value: string, scanners: trivy.Scanner[]) => {
  //   setLoading(true);
  //
  //   Scan(target, value, trivy.ScanOptions.createFrom({
  //     scanners: scanners,
  //   }))
  //     .then((output) => {
  //       setOutput(output.result);
  //     })
  //     .catch((err) => {
  //       console.error('Error scanning image:', err);
  //     }).finally(() => {
  //       setLoading(false);
  //     });
  // };

  return (
    <Grid container>
      <Grid xs={12}>
        {/* <TrivyScanHeader scan={scanImage} isScanning={loading} /> */}
      </Grid>
      <Grid xs={12}>
        <Divider />
      </Grid>
      <Grid xs={12}>
        {loading && (
          <Stack
            direction='column'
            alignItems='center'
            justifyContent='center'
            gap={4}
            p={1}
            sx={{
              minHeight: 'calc(100vh - 400px)',
            }}
          >

            <Typography
              level='h4'
            >
              Scanning...
            </Typography>
            <Box
              sx={{
                width: '600px',
              }}>
              <LinearProgress sx={{ minWidth: 500 }} />
            </Box>
          </Stack>
        )}
        {!loading && output && (
          <TrivyVulnerabilitiesReport json={output} />
        )}
      </Grid>
      {/* {cards.map((card, index) => ( */}
      {/*   <Grid key={index} xs={12} sm={6} md={4} lg={3}> */}
      {/*     <TrivyReportCard {...card} /> */}
      {/*   </Grid> */}
      {/* ))} */}
    </Grid>
  );
};

export default TrivyDashboard;
