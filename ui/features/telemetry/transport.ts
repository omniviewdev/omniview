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
    const data = JSON.stringify(items);
    this.ingest(data).catch(() => {});
  }
}
