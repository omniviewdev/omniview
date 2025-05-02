import { useContext } from "react";
import { RightDrawerContext, RightDrawerContextType } from "../../context/drawer/RightDrawerContext";

/**
 * Display a component within the right-side application drawer
 */
export const useRightDrawer = (): RightDrawerContextType => {
  const context = useContext(RightDrawerContext);
  if (!context) throw new Error('useRightDrawer must be used within a RightDrawerProvider');
  return context;
};
