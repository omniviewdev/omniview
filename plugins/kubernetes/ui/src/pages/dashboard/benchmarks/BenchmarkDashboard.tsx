import { Grid, Sheet } from '@mui/joy'
import React from 'React'
import ClusterOverviewCard from './components/ClusterOverviewCard'

type Props = {
  connectionID: string
  connectionAvatar?: string
  data: object
}

const BenchmarkDashboard: React.FC<Props> = ({ data, connectionID, connectionAvatar }) => {
  return (
    <Sheet>
      <Grid container>
        <Grid xs={12}>
          <ClusterOverviewCard
            cluster={connectionID}
            icon={connectionAvatar || 'SiKubernetes'}
            passing={4}
            warning={5}
            failing={6}
            score={87.9}
          />
        </Grid>
        <Grid xs={12}>
          <div>
            <pre>
              {JSON.stringify(data, null, '\t')}
            </pre>
          </div>
        </Grid>
      </Grid>
    </Sheet>
  )
}

export default BenchmarkDashboard
