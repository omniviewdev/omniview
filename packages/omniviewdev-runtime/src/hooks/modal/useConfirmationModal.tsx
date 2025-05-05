import React from 'react';
import { ConfirmationModalContext } from '../../context/modal/ConfirmationModalContext';

/**
 * Display a modal to confirm an action from the user before running the callback
 * function.
 */
export const useConfirmationModal = () => {
  const context = React.useContext(ConfirmationModalContext);
  if (!context) throw new Error('useConfirmationModal must be used within a ConfirmationModalProvider');
  return context;
};
