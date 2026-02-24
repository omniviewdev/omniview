import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import React from 'React'
import ClusterOverviewCard from './components/ClusterOverviewCard'

type Props = {
  connectionID: string
  connectionAvatar?: string
  data: object
}

const BenchmarkDashboard: React.FC<Props> = ({ data, connectionID, connectionAvatar }) => {
  return (
    <Box>
      <Grid container>
        <Grid size={12}>
          <ClusterOverviewCard
            cluster={connectionID}
            icon={connectionAvatar || 'SiKubernetes'}
            passing={4}
            warning={5}
            failing={6}
            score={87.9}
          />
        </Grid>
        <Grid size={12}>
          <div>
            <pre>
              {JSON.stringify(data, null, '\t')}
            </pre>
          </div>
        </Grid>
      </Grid>
    </Box>
  )
}

export default BenchmarkDashboard
