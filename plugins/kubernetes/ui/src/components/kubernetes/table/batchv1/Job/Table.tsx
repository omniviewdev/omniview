import React from 'react'
import { useParams } from 'react-router-dom'
import { Job } from 'kubernetes-types/batch/v1'
import { ColumnDef } from '@tanstack/react-table'
import { Condition, OwnerReference } from 'kubernetes-types/meta/v1'

import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell'
import ConditionsCell from '../../shared/cells/ConditionsCell'
import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, DrawerComponentActionListItem, useConfirmationModal, useLogs, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuClock, LuLogs, LuTrash } from 'react-icons/lu'
import AgeCell from '../../shared/cells/AgeCell'
import JobSidebar from './Sidebar'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'

const resourceKey = 'batch::v1::Job'

const ownerRefKeyMap: Record<string, string> = {
  "CronJob": "batch::v1::CronJob",
}

const JobTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { createLogSession } = useLogs({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<Job>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'succeeded',
          header: 'Succeeded',
          accessorFn: (row) => row.status?.succeeded ?? 0,
          size: 100,
          meta: {
            description: `The number of pods which reached phase Succeeded. The value increases monotonically for a given spec. However, it may decrease in reaction to scale down of elastic indexed jobs.`
          }
        },
        {
          id: 'terminating',
          header: 'Terminating',
          accessorFn: (row) => row.status?.terminating ?? 0,
          size: 100,
          meta: {
            description: `The number of pods which are terminating (in phase Pending or Running and have a deletionTimestamp).

This field is beta-level. The job controller populates the field when the feature gate JobPodReplacementPolicy is enabled (enabled by default).`
          }
        },
        {
          id: 'parallelism',
          header: 'Parallelism',
          accessorFn: (row) => row.spec?.parallelism ?? 1,
          size: 100,
          meta: {
            defaultHidden: true,
            description: `Specifies the maximum desired number of pods the job should run at any given time. The actual number of pods running in steady state will be less than this number when ((.spec.completions - .status.successful) < .spec.parallelism), i.e. when the work left to do is less than max parallelism. More info: https://kubernetes.io/docs/concepts/workloads/controllers/jobs-run-to-completion/`
          },
        },
        {
          id: 'backoffLimit',
          header: 'Backoff Limit',
          accessorFn: (row) => row.spec?.backoffLimit,
          size: 100,
          meta: {
            defaultHidden: true,
            description: `Specifies the number of retries before marking this job failed. Defaults to 6`
          },
        },
        {
          id: 'completionMode',
          header: 'Completion Mode',
          accessorFn: (row) => row.spec?.completionMode,
          size: 100,
          meta: {
            defaultHidden: true,
            description: `Specifies how Pod completions are tracked. It can be \`NonIndexed\` (default) or \`Indexed\`.

\`NonIndexed\` means that the Job is considered complete when there have been .spec.completions successfully completed Pods. Each Pod completion is homologous to each other.

\`Indexed\` means that the Pods of a Job get an associated completion index from 0 to (.spec.completions - 1), available in the annotation batch.kubernetes.io/job-completion-index. The Job is considered complete when there is one successfully completed Pod for each index. When value is \`Indexed\`, .spec.completions must be specified and \`.spec.parallelism\` must be less than or equal to 10^5. In addition, The Pod name takes the form \`$(job-name)-$(index)-$(random-string)\`, the Pod hostname takes the form \`$(job-name)-$(index)\`.

More completion modes can be added in the future. If the Job controller observes a mode that it doesn't recognize, which is possible during upgrades due to version skew, the controller skips updates for the Job.`
          },
        },
        {
          id: 'podReplacementPolicy',
          header: 'Pod Replacement Policy',
          accessorFn: (row) => row.spec?.podReplacementPolicy,
          size: 180,
          meta: {
            defaultHidden: true,
            description: `Specifies when to create replacement Pods. Possible values are: 

- TerminatingOrFailed means that we recreate pods
  when they are terminating (has a metadata.deletionTimestamp) or failed.
- Failed means to wait until a previously created Pod is fully terminated (has phase
  Failed or Succeeded) before creating a replacement Pod.

When using podFailurePolicy, Failed is the the only allowed value. TerminatingOrFailed and Failed are allowed values when podFailurePolicy is not in use. This is an beta field. To use this, enable the JobPodReplacementPolicy feature toggle. This is on by default.`
          },
        },
        {
          id: 'podFailurePolicy',
          header: 'Success Policy',
          accessorFn: (row) => row.spec?.podFailurePolicy,
          size: 100,
          meta: {
            defaultHidden: true,
            description: `Specifies the policy of handling failed pods. In particular, it allows to specify the set of actions and conditions which need to be satisfied to take the associated action. If empty, the default behaviour applies - the counter of failed pods, represented by the jobs's .status.failed field, is incremented and it is checked against the backoffLimit. This field cannot be used in combination with restartPolicy=OnFailure.

This field is beta-level. It can be used when the \`JobPodFailurePolicy\` feature gate is enabled (enabled by default)`
          },
        },
        {
          id: 'suspend',
          header: 'Suspend',
          accessorFn: (row) => row.spec?.suspend,
          size: 100,
          meta: {
            defaultHidden: true,
            description: `Specifies whether the Job controller should create Pods or not. If a Job is created with suspend set to true, no Pods are created by the Job controller. If a Job is suspended after creation (i.e. the flag goes from false to true), the Job controller will delete all active Pods associated with this Job. Users must design their workload to gracefully handle this. Suspending a Job will reset the StartTime field of the Job, effectively resetting the ActiveDeadlineSeconds timer too. Defaults to false.`
          },
        },
        {
          id: 'ttlSecondsAfterFinished',
          header: 'TTL',
          accessorFn: (row) => !!row.spec?.ttlSecondsAfterFinished ? `${row.spec?.ttlSecondsAfterFinished}s` : 'Never',
          size: 100,
          meta: {
            defaultHidden: true,
            description: `Limits the lifetime of a Job that has finished execution (either Complete or Failed). If this field is set, ttlSecondsAfterFinished after the Job finishes, it is eligible to be automatically deleted. When the Job is being deleted, its lifecycle guarantees (e.g. finalizers) will be honored. If this field is unset, the Job won't be automatically deleted. If this field is set to zero, the Job becomes eligible to be deleted immediately after it finishes.`
          },
        },
        {
          id: 'startTime',
          header: 'Start Time',
          accessorFn: (row) => row.status?.startTime,
          cell: ({ getValue }) => <AgeCell value={getValue() as string} />,
          size: 80,
        },
        {
          id: 'completionTime',
          header: 'Completion Time',
          accessorFn: (row) => row.status?.completionTime,
          cell: ({ getValue }) => <AgeCell value={getValue() as string} />,
          size: 80,
          meta: {
            description: `Represents time when the job was completed. It is not guaranteed to be set in happens-before order across separate operations. It is represented in RFC3339 form and is in UTC. The completion time is set when the job finishes successfully, and only then. The value cannot be updated or removed. The value indicates the same or later point in time as the startTime field.`
          }
        },
        {
          id: 'controlledBy',
          header: 'Controlled By',
          accessorKey: 'metadata.ownerReferences',
          size: 150,
          cell: ({ getValue }) => {
            const refs = getValue() as Array<OwnerReference> | undefined
            if (!refs || refs.length === 0) return <></>
            const ref = refs[0]
            return (
              <ResourceLinkCell
                connectionId={id}
                resourceId={ref.name}
                resourceKey={ownerRefKeyMap[ref.kind]}
                resourceName={ref.kind}
              />
            )
          },
          meta: {
            defaultHidden: false,
          },
        },
        {
          id: 'conditions',
          header: 'Conditions',
          accessorFn: (row) => row.status?.conditions,
          cell: ({ getValue }) => (
            <ConditionsCell
              conditions={getValue() as Condition[] | undefined}
              defaultHealthyColor="neutral"
              defaultUnhealthyColor="faded"
            />
          ),
          size: 250,
          meta: {
            defaultHidden: true,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<Job> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuClock />,
    views: createStandardViews({ SidebarComponent: JobSidebar }),
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the Job{' '}
                <code>{ctx.data?.metadata?.name}</code> from{' '}
                <strong>{ctx.data?.metadata?.namespace}</strong>?
              </span>
            ),
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            onConfirm: async () => {
              await remove({
                opts: {
                  connectionID: id,
                  resourceKey,
                  resourceID: ctx.data?.metadata?.name as string,
                  namespace: ctx.data?.metadata?.namespace as string,
                },
                input: {},
              })
              closeDrawer()
            },
          }),
      },
      {
        title: 'Logs',
        icon: <LuLogs />,
        enabled: true,
        list: (ctx) => {
          const list: Array<DrawerComponentActionListItem> = []
          const containers = ctx.data?.spec?.template?.spec?.containers ?? []
          const filterParams = { filter_labels: 'pod,container' }

          list.push({
            title: 'All Containers',
            action: () => createLogSession({
              connectionID: id,
              resourceKey,
              resourceID: ctx.data?.metadata?.name as string,
              resourceData: ctx.data as Record<string, any>,
              target: '',
              label: `Job ${ctx.data?.metadata?.name}`,
              icon: 'LuLogs',
              params: filterParams,
            }).then(() => closeDrawer())
          })

          containers.forEach((container) => {
            list.push({
              title: container.name,
              action: () => createLogSession({
                connectionID: id,
                resourceKey,
                resourceID: ctx.data?.metadata?.name as string,
                resourceData: ctx.data as Record<string, any>,
                target: container.name,
                label: `Job ${ctx.data?.metadata?.name}`,
                icon: 'LuLogs',
                params: filterParams,
              }).then(() => closeDrawer())
            })
          })

          return list
        }
      },
    ],
  }), [])

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="metadata.uid"
      memoizer="metadata.uid,metadata.resourceVersion,status.completionTime"
      drawer={drawer}
    />
  )
}

export default JobTable
