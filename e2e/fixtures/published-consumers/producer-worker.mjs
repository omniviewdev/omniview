import { publishedRuntime, publishedStyles } from './producer.ts';

// Every Vite/esbuild service (including tsx's transform service) belongs to this
// detached process group, never the long-lived Playwright worker. The controller
// waits for the complete group to disappear before retiring its private HOME.
const send = message => process.send?.(message);
const exitWith = (message, code) => {
  if (process.connected) process.send(message, () => process.exit(code));
  else process.exit(code);
};

try {
  const fixture = process.argv[2] === 'runtime'
    ? await publishedRuntime()
    : await publishedStyles(process.argv[2]);
  let operations = Promise.resolve();
  process.on('message', message => {
    // Teardown must not queue behind a stalled publication/readiness await.
    if (message.action === 'close') {
      void fixture.close().then(
        () => exitWith({ id: message.id, ok: true }, 0),
        error => exitWith({ id: message.id, error: error.stack || String(error) }, 1),
      );
      return;
    }
    operations = operations.then(async () => {
      try {
        if (message.action === 'export') {
          await fixture.a.publishNewExport();
          send({ id: message.id, ok: true });
        } else if (message.action === 'css') {
          await fixture.a.publishCSS(message.color);
          send({ id: message.id, ok: true });
        } else {
          throw new Error('Unknown published-consumer action');
        }
      } catch (error) {
        const response = { id: message.id, error: error.stack || String(error) };
        send(response);
      }
    });
  });
  process.on('disconnect', () => process.exit(1));
  send({ type: 'ready', a: fixture.a.url, b: fixture.b.url, ports: fixture.ports });
} catch (error) {
  exitWith({ type: 'failed', error: error.stack || String(error) }, 1);
}
