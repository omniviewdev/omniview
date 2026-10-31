import { useState } from 'react';
import { Button } from '@omniviewdev/base-ui';
import { ResourceClient } from '@omniviewdev/runtime/api';
import './probe.css';
import { ResourceBenchmark } from './ResourceBenchmark';

export function ProbePage() {
  const [clicks, setClicks] = useState(0);
  const [runtimeValue, setRuntimeValue] = useState('');
  const [connectionCount, setConnectionCount] = useState<number>();
  const [benchmark, setBenchmark] = useState(false);

  return (
    <section className="workspace-probe" aria-labelledby="workspace-probe-title">
      <h1 id="workspace-probe-title">Workspace Probe</h1>
      <p className="workspace-probe-marker">Probe UI ready</p>
      <p>This local click count resets when the page remounts. The persisted Probe counter is a separate plugin setting.</p>
      <Button
        className="workspace-probe-button"
        onClick={() => setClicks((value) => value + 1)}
      >
        Probe increment
      </Button>
      <output className="workspace-probe-clicks" aria-live="polite" aria-label="Probe local clicks">
        {clicks}
      </output>
      <Button onClick={() => {
        void ResourceClient.LoadConnections('workspace-probe')
          .then((connections) => {
            setConnectionCount(connections.length);
            setRuntimeValue('');
          })
          .catch((error: unknown) => setRuntimeValue(`Shared runtime failed: ${String(error)}`));
      }}>
        Read shared runtime
      </Button>
      <output role="status" aria-label="Probe runtime value">{runtimeValue}</output>
      <output aria-label="Probe runtime connection count">{connectionCount}</output>
      <Button onClick={() => setBenchmark((value) => !value)}>Toggle P02 benchmark</Button>
      {benchmark ? <ResourceBenchmark /> : null}
    </section>
  );
}
