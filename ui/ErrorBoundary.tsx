import React from 'react';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';
import { useRouteError } from 'react-router-dom';

function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}

export default function ErrorB({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      {children}
    </ErrorBoundary>
  );
}

export function RouterErrorBoundary() {
  const error = useRouteError()
  console.error(error);
  // Uncaught ReferenceError: path is not defined
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback} />
    // <div role='alert' 
    //   style={{ 
    //     display: 'flex', 
    //     flexDirection: 'column', 
    //     justifyContent: 'center',
    //     alignItems: 'center',
    //     height: '100%', 
    //     width: '100%',
    //     minHeight: '90vh',
    //   }}
    // >
    //   <p>Something went wrong: {error?.message}</p>
    //   <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignItems: 'flex-start' }}>
    //     <span style={{ color: 'red' }}>{error?.message}</span>
    //     <pre style={{ fontSize: 12 }}>{error?.stack}</pre>
    //   </div>
    // </div>
  );
}
