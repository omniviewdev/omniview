import { initializeFaro, type Faro } from '@grafana/faro-web-sdk';
import { WailsTransport } from './transport';

let faro: Faro | null = null;

export function initFaro(ingestFn: (payload: string) => Promise<void>, appVersion: string): Faro {
  if (faro) return faro;
  faro = initializeFaro({
    app: { name: 'omniview', version: appVersion },
    transports: [new WailsTransport(ingestFn)],
    instrumentations: [],
  });
  return faro;
}

export function getFaro(): Faro | null { return faro; }
