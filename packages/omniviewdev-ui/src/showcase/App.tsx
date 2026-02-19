import { RouterProvider } from '@tanstack/react-router';
import AppTheme from '../theme/AppTheme';
import { router } from './router';
import ToastProvider from '../overlays/ToastProvider';

export default function App() {
  return (
    <AppTheme defaultMode="dark">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AppTheme>
  );
}
