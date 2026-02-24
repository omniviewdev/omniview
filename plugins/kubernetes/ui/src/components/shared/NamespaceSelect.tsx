import { useMemo } from 'react';
import { Autocomplete } from '@omniviewdev/ui/inputs';
import type { AutocompleteOption } from '@omniviewdev/ui/inputs';
import type { ComponentSize } from '@omniviewdev/ui/types';
import { useConnectionNamespaces } from '@omniviewdev/runtime';

interface NamespaceSelectProps {
  value: string;
  onChange: (namespace: string) => void;
  connectionID: string;
  size?: ComponentSize;
  placeholder?: string;
  error?: string;
}

/**
 * Kubernetes-specific namespace selector with creatable support.
 * Fetches namespaces from the connected cluster and allows entering
 * a new namespace name (Helm's --create-namespace handles creation).
 */
export default function NamespaceSelect({
  value,
  onChange,
  connectionID,
  size = 'sm',
  placeholder = 'Select or create namespace',
  error,
}: NamespaceSelectProps) {
  const { namespaces } = useConnectionNamespaces({
    pluginID: 'kubernetes',
    connectionID,
  });

  const options = useMemo<AutocompleteOption[]>(
    () => (namespaces.data ?? []).map((ns: string) => ({ value: ns, label: ns })),
    [namespaces.data],
  );

  const selected = useMemo<AutocompleteOption | null>(
    () => (value ? { value, label: value } : null),
    [value],
  );

  return (
    <Autocomplete
      options={options}
      value={selected}
      onChange={(newVal) => {
        if (!newVal) {
          onChange('');
          return;
        }
        if (typeof newVal === 'string') {
          onChange(newVal);
          return;
        }
        if (Array.isArray(newVal)) return;
        onChange(newVal.value || newVal.label);
      }}
      creatable
      loading={namespaces.isLoading}
      size={size}
      placeholder={placeholder}
      error={error ? error : undefined}
      fullWidth
    />
  );
}

NamespaceSelect.displayName = 'NamespaceSelect';
