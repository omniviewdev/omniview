import { ClipboardText } from '@omniviewdev/ui';

export const CopyableCell = ({ getValue }: { getValue: () => unknown }) => {
  const val = getValue();
  if (val == null || val === '' || val === '—') return <>{val ?? ''}</>;
  return <ClipboardText value={String(val)} variant="inherit" />;
};

export default CopyableCell;
