import { useState } from 'react';

// Material-ui
import Divider from '@mui/joy/Divider';
import Grid from '@mui/joy/Grid';
import Sheet from '@mui/joy/Sheet';
import List from '@mui/joy/List';
import Typography from '@mui/joy/Typography';

// Icons
import KubernetesLogo from '@/assets/logos/kubernetes/KubernetesColorWhiteBG';
// Import ClusterListItem from './ClusterListItem';

export default function Clusters() {
  const [_clusters, _setClusters] = useState({});

  return (
    <Grid container p={4} overflow={'auto'}>
      <Grid xs={12} alignItems={'center'}>
        <Sheet sx={{ p: 1, backgroundColor: 'transparent', borderRadius: 8 }} variant='outlined'>
          <KubernetesLogo width={220} />
        </Sheet>
      </Grid>
      <Grid
        xs={12}
        sm={6}
        sx={{
          py: 2,
          pr: { xs: 0, sm: 2 },
        }}
      >
        <Sheet sx={{ backgroundColor: 'transparent', borderRadius: 8 }} variant='outlined'>
          <Sheet sx={{
            px: 2, py: 1.5, backgroundColor: 'background.surface', borderRadius: 8,
          }} variant='plain'>
            <Typography fontSize={20} fontWeight={600}>Clusters</Typography>
          </Sheet>
          <Divider />
          <List
            variant='plain'
            component='nav'
            size='lg'
            sx={{
              p: 0,
              width: '100%',
              borderRadius: 'sm',
            }}
          >
            {/* {Object.values(clusters).map((cluster, idx) => ( */}
            {/*   <> */}
            {/*     <ClusterListItem {...cluster} /> */}
            {/*     {idx < Object.values(clusters).length - 1 && <Divider />} */}
            {/*   </> */}
            {/* ))} */}

          </List>
        </Sheet>
      </Grid>
    </Grid>
  );
}
