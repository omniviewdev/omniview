import { ColumnDef } from '@tanstack/react-table'

/**
 * Name column for AWS resources. Tries multiple common name fields.
 */
export const nameColumn = <T,>(): ColumnDef<T> => ({
  id: 'name',
  header: 'Name',
  accessorFn: (row: any) => {
    return row._Name || row.Name || row.FunctionName || row.DBInstanceIdentifier
      || row.BucketName || row.RoleName || row.UserName || row.TableName
      || row.AlarmName || row.ClusterName || row.LoadBalancerName
      || row.TopicArn?.split(':').pop() || row.QueueUrl?.split('/').pop()
      || row.InstanceId || row.VpcId || row.SubnetId || row.GroupId
      || row.VolumeId || row.SnapshotId || row.ImageId
      || '';
  },
  enableSorting: true,
  enableHiding: false,
  size: 300,
  meta: {
    flex: 1
  }
})

export default nameColumn
