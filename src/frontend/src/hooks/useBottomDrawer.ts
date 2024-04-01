import { useContext } from 'react';
import BottomDrawerContext from '@/contexts/BottomDrawerContext';

const useBottomDrawer = () => {
  const context = useContext(BottomDrawerContext);

  if (context === undefined) {
    throw new Error('useBottomDrawer must be used within a BottomDrawerProvider');
  }

  return context;
};

export default useBottomDrawer;
