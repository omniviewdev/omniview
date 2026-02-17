import { useState, useCallback } from 'react';
import { useResource } from '@omniviewdev/runtime';

type ResourceRef = {
  connectionID: string;
  resourceKey: string;
  resourceID: string;
};

/**
 * Hook that wires a form's onSave/onDelete callbacks to the runtime's
 * useResource mutation hooks. Returns `handleSave`, `handleDelete`, and
 * loading flags that can be passed directly to form components.
 *
 * @example
 * ```tsx
 * const { handleSave, handleDelete, saving, deleting } = useResourceForm({
 *   connectionID: id,
 *   resourceKey: 'ec2::v1::Instance',
 *   resourceID: instanceId,
 * });
 *
 * return <InstanceConfigForm data={data} onSave={handleSave} saving={saving} />;
 * ```
 */
export function useResourceForm({ connectionID, resourceKey, resourceID }: ResourceRef) {
  const { update, remove } = useResource({
    pluginID: 'aws',
    connectionID,
    resourceKey,
    resourceID,
  });

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = useCallback(async (values: Record<string, any>) => {
    setSaving(true);
    try {
      await update({ input: values });
    } finally {
      setSaving(false);
    }
  }, [update]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await remove({});
    } finally {
      setDeleting(false);
    }
  }, [remove]);

  return { handleSave, handleDelete, saving, deleting };
}

export default useResourceForm;
