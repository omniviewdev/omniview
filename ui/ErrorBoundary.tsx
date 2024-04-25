import React from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useRouteError } from 'react-router-dom';

function fallbackRender({ error }: { error: Error }) {
  console.log(error);

  return (
    <div role='alert'>
      <p>Something went wrong:</p>
      <pre style={{ color: 'red' }}>{error.message}</pre>
    </div>
  );
}

export default function ErrorB({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary FallbackComponent={fallbackRender}>
      {children}
    </ErrorBoundary>
  );
}

export function RouterErrorBoundary() {
  const error = useRouteError() as Error | undefined;
  console.error(error);
  // Uncaught ReferenceError: path is not defined
  return (
    <div role='alert' 
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%', 
        width: '100%',
        minHeight: '90vh',
      }}
    >
      <p>Something went wrong: {error?.message}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignItems: 'flex-start' }}>
        <span style={{ color: 'red' }}>{error?.message}</span>
        <pre style={{ fontSize: 12 }}>{error?.stack}</pre>
      </div>
    </div>
  );
}
