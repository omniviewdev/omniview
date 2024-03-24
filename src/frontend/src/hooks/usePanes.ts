import { useContext } from 'react';
import PaneProviderContext, { PaneContext } from '@/contexts/PaneContext';

const usePanes = () => {
  const context = useContext(PaneProviderContext);

  if (context === undefined) {
    throw new Error('usePanes must be used within a PaneContext');
  }

  return context;
};

export const usePane = () => {
  const context = useContext(PaneContext);

  if (context === undefined) {
    throw new Error('usePane must be used within a PaneContext');
  }

  return context;
};

export default usePanes;
