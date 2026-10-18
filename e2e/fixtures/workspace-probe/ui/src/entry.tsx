import { useState } from 'react';
import { Button } from '@omniviewdev/base-ui';
import { PluginWindow } from '@omniviewdev/runtime';
import './probe.css';

function ProbePage() {
  const [clicks, setClicks] = useState(0);

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
    </section>
  );
}

export const plugin = new PluginWindow()
  .setRootPage(ProbePage)
  .withRoutes([{ path: '/', Component: ProbePage }]);
