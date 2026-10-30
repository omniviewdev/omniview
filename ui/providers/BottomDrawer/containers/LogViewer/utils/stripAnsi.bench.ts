import { test, describe } from 'vitest';
import * as ansiStripper from './stripAnsi';

// Capture exports outside timed work to exclude module-runner getter overhead.
const { stripAnsi } = ansiStripper;

// ---------------------------------------------------------------------------
// Test data — representative of real Kubernetes pod log lines
// ---------------------------------------------------------------------------

const PLAIN_SHORT = '2024-01-15T10:30:00Z INFO server started on :8080';
const PLAIN_LONG = '2024-01-15T10:30:00.123456Z INFO  [request_id=abc-123-def-456] GET /api/v1/namespaces/kube-system/pods?labelSelector=app%3Dcoredns&limit=500 responded 200 in 12.34ms (bytes_in=0, bytes_out=48291, user_agent="kubectl/v1.28.0")';

const COLORED_SIMPLE = '\x1b[31mERROR\x1b[0m something broke';
const COLORED_TYPICAL = '\x1b[90m2024-01-15T10:30:00Z\x1b[0m \x1b[1;31mERROR\x1b[0m \x1b[36mmain.go:42\x1b[0m Failed to connect to \x1b[33mdatabase\x1b[0m service';
const COLORED_HEAVY = '\x1b[1m\x1b[38;2;255;128;0m2024-01-15\x1b[0m \x1b[48;5;196m\x1b[38;5;231mERROR\x1b[0m \x1b[3m\x1b[4m\x1b[38;2;100;200;50mcontroller.go:127\x1b[0m \x1b[2mFailed to reconcile \x1b[1;33mDeployment\x1b[0m/\x1b[36mnginx-ingress\x1b[0m in namespace \x1b[35mkube-system\x1b[0m: \x1b[91mconnection refused\x1b[0m';

// Pre-build a batch to simulate ingesting a chunk of log lines at once.
const BATCH_MIXED_100 = Array.from({ length: 100 }, (_, i) => {
  if (i % 3 === 0) {
    return COLORED_TYPICAL;
  }

  if (i % 3 === 1) {
    return PLAIN_LONG;
  }

  return COLORED_HEAVY;
});

const BATCH_PLAIN_100 = Array.from({ length: 100 }, () => PLAIN_LONG);

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('stripAnsi', () => {
  describe('single line', () => {
    test('plain short (fast path)', async ({ bench }) => {
      await bench('plain short (fast path)', () => {
        stripAnsi(PLAIN_SHORT);
      }).run(); 
    });

    test('plain long (fast path)', async ({ bench }) => {
      await bench('plain long (fast path)', () => {
        stripAnsi(PLAIN_LONG);
      }).run(); 
    });

    test('colored simple (1 SGR pair)', async ({ bench }) => {
      await bench('colored simple (1 SGR pair)', () => {
        stripAnsi(COLORED_SIMPLE);
      }).run(); 
    });

    test('colored typical (4 SGR pairs)', async ({ bench }) => {
      await bench('colored typical (4 SGR pairs)', () => {
        stripAnsi(COLORED_TYPICAL);
      }).run(); 
    });

    test('colored heavy (256-color, RGB, attributes)', async ({ bench }) => {
      await bench('colored heavy (256-color, RGB, attributes)', () => {
        stripAnsi(COLORED_HEAVY);
      }).run(); 
    });
  });

  describe('batch (simulates ingest chunk)', () => {
    test('100 mixed lines', async ({ bench }) => {
      await bench('100 mixed lines', () => {
        for (const line of BATCH_MIXED_100) {
          stripAnsi(line);
        }
      }).run(); 
    });

    test('100 plain lines (fast path)', async ({ bench }) => {
      await bench('100 plain lines (fast path)', () => {
        for (const line of BATCH_PLAIN_100) {
          stripAnsi(line);
        }
      }).run(); 
    });
  });
});
