import { bench, describe } from 'vitest';
import { stripAnsi } from './stripAnsi';

// ---------------------------------------------------------------------------
// Test data — representative of real Kubernetes pod log lines
// ---------------------------------------------------------------------------

const PLAIN_SHORT = '2024-01-15T10:30:00Z INFO server started on :8080';
const PLAIN_LONG = `2024-01-15T10:30:00.123456Z INFO  [request_id=abc-123-def-456] GET /api/v1/namespaces/kube-system/pods?labelSelector=app%3Dcoredns&limit=500 responded 200 in 12.34ms (bytes_in=0, bytes_out=48291, user_agent="kubectl/v1.28.0")`;

const COLORED_SIMPLE = '\x1b[31mERROR\x1b[0m something broke';
const COLORED_TYPICAL = '\x1b[90m2024-01-15T10:30:00Z\x1b[0m \x1b[1;31mERROR\x1b[0m \x1b[36mmain.go:42\x1b[0m Failed to connect to \x1b[33mdatabase\x1b[0m service';
const COLORED_HEAVY = '\x1b[1m\x1b[38;2;255;128;0m2024-01-15\x1b[0m \x1b[48;5;196m\x1b[38;5;231mERROR\x1b[0m \x1b[3m\x1b[4m\x1b[38;2;100;200;50mcontroller.go:127\x1b[0m \x1b[2mFailed to reconcile \x1b[1;33mDeployment\x1b[0m/\x1b[36mnginx-ingress\x1b[0m in namespace \x1b[35mkube-system\x1b[0m: \x1b[91mconnection refused\x1b[0m';

// Pre-build a batch to simulate ingesting a chunk of log lines at once.
const BATCH_MIXED_100 = Array.from({ length: 100 }, (_, i) => {
  if (i % 3 === 0) return COLORED_TYPICAL;
  if (i % 3 === 1) return PLAIN_LONG;
  return COLORED_HEAVY;
});

const BATCH_PLAIN_100 = Array.from({ length: 100 }, () => PLAIN_LONG);

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('stripAnsi', () => {
  describe('single line', () => {
    bench('plain short (fast path)', () => {
      stripAnsi(PLAIN_SHORT);
    });

    bench('plain long (fast path)', () => {
      stripAnsi(PLAIN_LONG);
    });

    bench('colored simple (1 SGR pair)', () => {
      stripAnsi(COLORED_SIMPLE);
    });

    bench('colored typical (4 SGR pairs)', () => {
      stripAnsi(COLORED_TYPICAL);
    });

    bench('colored heavy (256-color, RGB, attributes)', () => {
      stripAnsi(COLORED_HEAVY);
    });
  });

  describe('batch (simulates ingest chunk)', () => {
    bench('100 mixed lines', () => {
      for (let i = 0; i < BATCH_MIXED_100.length; i++) {
        stripAnsi(BATCH_MIXED_100[i]);
      }
    });

    bench('100 plain lines (fast path)', () => {
      for (let i = 0; i < BATCH_PLAIN_100.length; i++) {
        stripAnsi(BATCH_PLAIN_100[i]);
      }
    });
  });
});
