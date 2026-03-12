import { BaseTransport } from '@grafana/faro-core';
import type { TransportItem } from '@grafana/faro-core';

type IngestFn = (payload: string) => Promise<void>;

// Capture unpatched console.error at module load to avoid re-entering the
// patched console (which writes to the sink → calls transport → recursion).
const _originalConsoleError = console.error.bind(console);

export class WailsTransport extends BaseTransport {
  readonly name = 'wails';
  readonly version = '1.0.0';
  private ingest: IngestFn;

  constructor(ingestFn: IngestFn) {
    super();
    this.ingest = ingestFn;
  }

  send(items: TransportItem | TransportItem[]): void {
    let data: string;
    try {
      data = JSON.stringify(items);
    } catch (err) {
      if (import.meta.env?.DEV) {
        _originalConsoleError('[WailsTransport] JSON.stringify failed:', err);
      }
      return;
    }
    this.ingest(data).catch((err) => {
      if (import.meta.env?.DEV) {
        _originalConsoleError('[WailsTransport] ingest failed:', err);
      }
    });
  }
}
