import React from 'react'

import { Chip } from '@mui/joy';
import { useResources } from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { KubernetesResourceObject } from '../../../types/resource';
import { LuTag, LuStickyNote } from 'react-icons/lu';
import { useStoredState } from '../../shared/hooks/useStoredState';

type Args = {
  connectionID: string
  resourceKey: string
}

/**
 * Tracks and generates resource label columns based on the incoming data
 * TODO: Could see this getting very innefficient, need to test. We should make indexed/calculated values
 * available in the SDK.
 */
export const useDynamicResourceColumns = <T extends KubernetesResourceObject>({
  connectionID,
  resourceKey,
}: Args) => {
  const [labels, setLabels] = useStoredState<Record<string, boolean>>(`kubernetes-${resourceKey}-label-cols`, {})
  const [annotations, setAnnotations] = useStoredState<Record<string, boolean>>(`kubernetes-${resourceKey}-annotation-cols`, {})

  const { resources } = useResources({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey,
    idAccessor: 'metadata.uid',
  });

  /**
   * When the resources change, calculate the dynamic resource columns that we
   * can have.
   *
   * TODO: come back and do a perf analysis on this. Might slow things down by quite a bit
   */
  React.useEffect(() => {
    if (!resources.data?.result.length) {
      // nothing to calculate
      return
    }

    const discoveredLabels: Record<string, boolean> = {}
    const discoveredAnnotations: Record<string, boolean> = {}

    /** 
     * Doing this all inline for performance reasons to prevent large object copying
     */
    for (let i = 0; i < resources.data?.result.length; i++) {
      const labels = Object.keys((resources.data.result[i] as T).metadata?.labels || {})
      const annotations = Object.keys((resources.data.result[i] as T).metadata?.annotations || {})

      for (let l = 0; l < labels.length; l++) {
        if (!Object.hasOwn(discoveredLabels, labels[l])) {
          discoveredLabels[labels[l]] = false
        }
      }
      for (let a = 0; a < annotations.length; a++) {
        if (!Object.hasOwn(discoveredAnnotations, annotations[a])) {
          discoveredAnnotations[annotations[a]] = false
        }
      }
    }

    /** 
     * Set labels and annotations that have not been defined, with priority going to
     * already existing ones.
     */
    setLabels((prev) => ({
      ...discoveredLabels,
      ...prev,
    }))

    setAnnotations((prev) => ({
      ...discoveredAnnotations,
      ...prev,
    }))
  }, [resources.data?.result])

  // Extract only the enabled keys
  const selectedLabelKeys = React.useMemo(
    () => Object.entries(labels).filter(([_, v]) => v).map(([k]) => k).sort(),
    [labels]
  )

  const selectedAnnotationKeys = React.useMemo(
    () => Object.entries(annotations).filter(([_, v]) => v).map(([k]) => k).sort(),
    [annotations]
  )

  /**
   * When we have label selections that change, we want to calculate column defs, but memoize it so that
   * we keep a stable reference if the actual TRUE selections do not change. Don't want to keep rerendering
   * column definitions if they end up being the same.
   */
  const columnDefs = React.useMemo<Array<ColumnDef<any>>>(() => {
    const labelCols: Array<ColumnDef<any>> = selectedLabelKeys.map((key) => ({
      id: `label-${key}`,
      header: () => <Chip
        size='sm'
        color={'neutral'}
        variant='soft'
        sx={{ borderRadius: 'sm' }}
        startDecorator={<LuTag />}
      >{key}</Chip>,
      accessorFn: (row) => row.metadata?.labels?.[key] ?? '',
      size: Math.max(100, (key.length * 7) + 50),
      enableHiding: false,
      meta: {
        flex: 1
      }
    }))

    const annotationCols: Array<ColumnDef<any>> = selectedAnnotationKeys.map((key) => ({
      id: `annotation-${key}`,
      header: () => <Chip
        size='sm'
        color={'neutral'}
        variant='soft'
        sx={{ borderRadius: 'sm' }}
        startDecorator={<LuStickyNote />}
      >{key}</Chip>,
      accessorFn: (row) => row.metadata?.annotations?.[key] ?? '',
      size: Math.max(100, (key.length * 7) + 50),
      enableHiding: false,
      meta: {
        flex: 1
      }
    }))

    return [...labelCols, ...annotationCols]
  }, [selectedLabelKeys.join(','), selectedAnnotationKeys.join(',')])

  return {
    columnDefs,
    labels,
    setLabels,
    annotations,
    setAnnotations,
  }
}
