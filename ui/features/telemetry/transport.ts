import { BaseTransport } from '@grafana/faro-core';
import type { TransportItem } from '@grafana/faro-core';

type IngestFn = (payload: string) => Promise<void>;

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
        console.error('[WailsTransport] JSON.stringify failed:', err);
      }
      return;
    }
    this.ingest(data).catch((err) => {
      if (import.meta.env?.DEV) {
        console.error('[WailsTransport] ingest failed:', err);
      }
    });
  }
}
