import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default class TimingReporter {
  cases = [];
  onTestEnd(test, result) {
    const setupMs = result.steps.filter(step => step.category === 'hook' && step.title === 'Before Hooks').reduce((sum, step) => sum + step.duration, 0);
    const teardownMs = result.steps.filter(step => step.category === 'hook' && step.title === 'After Hooks').reduce((sum, step) => sum + step.duration, 0);
    this.cases.push({ title: test.titlePath().join(' › '), status: result.status, totalMs: result.duration, setupMs, assertionsMs: Math.max(0, result.duration - setupMs - teardownMs), teardownMs });
  }
  onEnd() {
    const directory = join(process.cwd(), 'playwright-report');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'case-timings.json'), `${JSON.stringify({ schemaVersion: 1, cases: this.cases }, null, 2)}\n`);
  }
}
