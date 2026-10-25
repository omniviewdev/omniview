import { useState } from 'react';
import { Button } from '@omniviewdev/base-ui';
import { formatGroup } from '@omniviewdev/runtime';
import './probe.css';
import { ResourceBenchmark } from './ResourceBenchmark';

export function ProbePage() {
  const [clicks, setClicks] = useState(0);
  const [runtimeValue, setRuntimeValue] = useState('');
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
      <Button onClick={() => setRuntimeValue(formatGroup('shared runtime ready'))}>
        Read shared runtime
      </Button>
      <output role="status" aria-label="Probe runtime value">{runtimeValue}</output>
      <Button onClick={() => setBenchmark((value) => !value)}>Toggle P02 benchmark</Button>
      {benchmark ? <ResourceBenchmark /> : null}
    </section>
  );
}
