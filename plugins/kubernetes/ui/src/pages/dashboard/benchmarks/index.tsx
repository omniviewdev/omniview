import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import { CircularProgress } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { useResources } from '@omniviewdev/runtime'
import React from 'react'
import { useParams } from 'react-router-dom';
import CodeEditor from '../../../components/shared/editor/Editor';
import ClusterOverviewCard from './components/ClusterOverviewCard';
import ScorecardChart from './components/ScorecardChart';

const ClusterDashboardBenchmarksPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const { resources } = useResources({ pluginID: 'kubernetes', connectionID: id, resourceKey: 'extras::v1::ClusterBenchmark' })

  if (resources.isLoading) {
    return (
      <Box display='flex' height='100%' width='100%' alignItems='center' justifyContent='center' flex={1}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Grid container>
      <Grid size={12}>
        <ClusterOverviewCard
          cluster={id}
          icon={'SiKubernetes'}
          passing={resources.data?.result[0].summary?.success}
          warning={resources.data?.result[0].summary?.warning}
          failing={resources.data?.result[0].summary?.danger}
          score={resources.data?.result[0].score}
        />

      </Grid>
      {/** A bit ugly and space innefficient, clean up later */}
      <Grid size={12}>
        <Stack direction='row' gap={1}>
          {Object.entries(resources.data?.result[0].summary_by_category || {}).map(([category, summary]: [string, any]) => (
            <ScorecardChart
              label={category}
              success={summary.success as number}
              warning={summary.warning as number}
              failure={summary.danger as number}
            />
          ))}
        </Stack>
      </Grid>
      <Grid size={12}>
        <CodeEditor
          original={JSON.stringify(resources?.data?.result[0] || {}, null, '\t')}
          value={JSON.stringify(resources?.data?.result[0] || {}, null, '\t')}
          language="yaml"
          filename={'report.json'}
          height={'100%'}
        />
      </Grid>
    </Grid>
  )
}

export default ClusterDashboardBenchmarksPage
