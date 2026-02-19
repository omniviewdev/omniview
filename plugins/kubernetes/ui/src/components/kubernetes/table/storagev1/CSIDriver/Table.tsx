import React from 'react'
import { useParams } from 'react-router-dom'
import { CSIDriver } from 'kubernetes-types/storage/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withClusterResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuHardDriveDownload, LuCode, LuSquareChartGantt, LuTrash, LuCircleCheck } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import { ChipListCell } from '../../shared/cells/ChipList'
import CSIDriverSidebar from './Sidebar'

const resourceKey = 'storage::v1::CSIDriver'

const CSIDriverTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<CSIDriver>>>(
    () =>
      withClusterResourceColumns([
        {
          id: 'attachRequired',
          header: 'Attach Required',
          accessorFn: (row) => !!row.spec?.attachRequired,
          cell: ({ getValue }) => (getValue() as boolean) && <LuCircleCheck />,
          size: 140,
          meta: {
            description: `Indicates this CSI volume driver requires an attach operation (because it implements the CSI ControllerPublishVolume() method), and that the Kubernetes attach detach controller should call the attach volume interface which checks the volumeattachment status and waits until the volume is attached before proceeding to mounting. The CSI external-attacher coordinates with CSI volume driver and updates the volumeattachment status when the attach operation is complete. If the CSIDriverRegistry feature gate is enabled and the value is specified to false, the attach operation will be skipped. Otherwise the attach operation will be called.

This field is immutable.`
          }
        },
        {
          id: 'podInfoOnMount',
          header: 'Pod Info on Mount',
          accessorFn: (row) => !!row.spec?.podInfoOnMount,
          cell: ({ getValue }) => (getValue() as boolean) && <LuCircleCheck />,
          size: 160,
          meta: {
            description: `Indicates this CSI volume driver requires additional pod information (like podName, podUID, etc.) during mount operations, if set to true. If set to false, pod information will not be passed on mount. Default is false.

The CSI driver specifies podInfoOnMount as part of driver deployment. If true, Kubelet will pass pod information as VolumeContext in the CSI NodePublishVolume() calls. The CSI driver is responsible for parsing and validating the information passed in as VolumeContext.

The following VolumeContext will be passed if podInfoOnMount is set to true. This list might grow, but the prefix will be used. "csi.storage.k8s.io/pod.name": pod.Name "csi.storage.k8s.io/pod.namespace": pod.Namespace "csi.storage.k8s.io/pod.uid": string(pod.UID) "csi.storage.k8s.io/ephemeral": "true" if the volume is an ephemeral inline volume
                                defined by a CSIVolumeSource, otherwise "false"

"csi.storage.k8s.io/ephemeral" is a new feature in Kubernetes 1.16. It is only required for drivers which support both the "Persistent" and "Ephemeral" VolumeLifecycleMode. Other drivers can leave pod info disabled and/or ignore this field. As Kubernetes 1.15 doesn't support this field, drivers can only support one mode when deployed on such a cluster and the deployment determines which mode that is, for example via a command line parameter of the driver.

This field was immutable in Kubernetes < 1.29 and now is mutable.`
          }
        },
        {
          id: 'fsGroupPolicy',
          header: 'FSGroup Policy',
          accessorFn: (row) => row.spec?.fsGroupPolicy,
          size: 160,
          meta: {
            description: `Defines if the underlying volume supports changing ownership and permission of the volume before being mounted. Refer to the specific FSGroupPolicy values for additional details.

This field was immutable in Kubernetes < 1.29 and now is mutable.

Defaults to ReadWriteOnceWithFSType, which will examine each volume to determine if Kubernetes should modify ownership and permissions of the volume. With the default policy the defined fsGroup will only be applied if a fstype is defined and the volume's access mode contains ReadWriteOnce.`
          }
        },
        {
          id: 'volumeLifecycleModes',
          header: 'Volume Lifecycle',
          accessorFn: (row) => row.spec?.volumeLifecycleModes || [],
          cell: ChipListCell,
          size: 180,
          meta: {
            description: `Defines what kind of volumes this CSI volume driver supports. The default if the list is empty is "Persistent", which is the usage defined by the CSI specification and implemented in Kubernetes via the usual PV/PVC mechanism.

The other mode is "Ephemeral". In this mode, volumes are defined inline inside the pod spec with CSIVolumeSource and their lifecycle is tied to the lifecycle of that pod. A driver has to be aware of this because it is only going to get a NodePublishVolume call for such a volume.

For more information about implementing this mode, see https://kubernetes-csi.github.io/docs/ephemeral-local-volumes.html A driver can support one or more of these modes and more modes may be added in the future.

This field is beta. This field is immutable.`
          }
        },
        {
          id: 'tokenRequests',
          header: 'Token Requests',
          accessorFn: (row) =>
            row.spec?.tokenRequests?.length ? `${row.spec.tokenRequests.length} token(s)` : '—',
          size: 120,
          meta: {
            defaultHidden: true,
            description: `Indicates the CSI driver needs pods' service account tokens it is mounting volume for to do necessary authentication. Kubelet will pass the tokens in VolumeContext in the CSI NodePublishVolume calls. The CSI driver should parse and validate the following VolumeContext: "csi.storage.k8s.io/serviceAccount.tokens": {
  "<audience>": {
    "token": <token>,
    "expirationTimestamp": <expiration timestamp in RFC3339>,
  },
  ...
}

Note: Audience in each TokenRequest should be different and at most one token is empty string. To receive a new token after expiry, RequiresRepublish can be used to trigger NodePublishVolume periodically.`
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<CSIDriver> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuHardDriveDownload />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <CSIDriverSidebar ctx={ctx} />,
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data} />,
      },
    ],
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the CSIDriver{' '}
                <code>{ctx.data?.metadata?.name}</code>?
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
                },
                input: {},
              })
              closeDrawer()
            },
          }),
      },
    ],
  }), [])

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="metadata.name"
      memoizer="metadata.name,metadata.resourceVersion,spec.attachRequired"
      drawer={drawer}
    />
  )
}

export default CSIDriverTable
