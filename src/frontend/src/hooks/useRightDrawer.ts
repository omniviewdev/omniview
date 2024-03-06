import { useContext } from 'react';
import RightDrawerContext from '@/contexts/RightDrawerContext';

const useRightDrawer = () => {
  const context = useContext(RightDrawerContext);

  if (context === undefined) {
    throw new Error('useRightDrawer must be used within a RightDrawerProvider');
  }

  return context;
};

export default useRightDrawer;
