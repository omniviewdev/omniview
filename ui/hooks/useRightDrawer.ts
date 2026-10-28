import { useContext } from 'react';
import { RightDrawerContext } from '@omniviewdev/runtime';

const useRightDrawer = () => {
  const context = useContext(RightDrawerContext);

  if (context === undefined) {
    throw new Error('useRightDrawer must be used within a RightDrawerProvider');
  }

  return context;
};

export default useRightDrawer;
