import { bench, describe } from 'vitest';
import { parseAnsi } from './parseAnsi';

// ---------------------------------------------------------------------------
// Test data — representative of real Kubernetes / application log lines
// ---------------------------------------------------------------------------

const PLAIN_SHORT = '2024-01-15T10:30:00Z INFO server started on :8080';
const PLAIN_LONG = `2024-01-15T10:30:00.123456Z INFO  [request_id=abc-123-def-456] GET /api/v1/namespaces/kube-system/pods?labelSelector=app%3Dcoredns&limit=500 responded 200 in 12.34ms (bytes_in=0, bytes_out=48291, user_agent="kubectl/v1.28.0")`;

// Typical Go structured logger (zap/zerolog) — 4 SGR pairs
const COLORED_TYPICAL = '\x1b[90m2024-01-15T10:30:00Z\x1b[0m \x1b[1;31mERROR\x1b[0m \x1b[36mmain.go:42\x1b[0m Failed to connect to \x1b[33mdatabase\x1b[0m service';

// Heavy — 24-bit color, 256-color, multiple attributes
const COLORED_HEAVY = '\x1b[1m\x1b[38;2;255;128;0m2024-01-15\x1b[0m \x1b[48;5;196m\x1b[38;5;231mERROR\x1b[0m \x1b[3m\x1b[4m\x1b[38;2;100;200;50mcontroller.go:127\x1b[0m \x1b[2mFailed to reconcile \x1b[1;33mDeployment\x1b[0m/\x1b[36mnginx-ingress\x1b[0m in namespace \x1b[35mkube-system\x1b[0m: \x1b[91mconnection refused\x1b[0m';

// Python traceback — multi-line, many color changes
const PYTHON_TRACEBACK = [
  '\x1b[1;31mTraceback (most recent call last):\x1b[0m',
  '  File \x1b[36m"/app/main.py"\x1b[0m, line \x1b[33m42\x1b[0m, in \x1b[32mhandle_request\x1b[0m',
  '    result = \x1b[35mprocess\x1b[0m(\x1b[33mdata\x1b[0m)',
  '  File \x1b[36m"/app/processor.py"\x1b[0m, line \x1b[33m108\x1b[0m, in \x1b[32mprocess\x1b[0m',
  '    raise \x1b[1;31mValueError\x1b[0m(\x1b[33m"invalid input"\x1b[0m)',
  '\x1b[1;31mValueError\x1b[0m: \x1b[33minvalid input\x1b[0m',
].join('\n');

// Pathological — 50 rapid color changes in a single line
let PATHOLOGICAL = '';
for (let i = 0; i < 50; i++) {
  PATHOLOGICAL += `\x1b[${30 + (i % 8)};${i % 2 ? 1 : 2}mword${i} `;
}
PATHOLOGICAL += '\x1b[0m';

// OSC hyperlink sequences (some terminal loggers emit these)
const OSC_LINKS = '\x1b]8;;https://github.com/org/repo/blob/main/pkg/ctrl/ctrl.go#L42\x1b\\ctrl.go:42\x1b]8;;\x1b\\ \x1b[31mERROR\x1b[0m connection timeout';

// Batches — simulate real ingest patterns
const BATCH_MIXED_100 = Array.from({ length: 100 }, (_, i) => {
  switch (i % 5) {
    case 0: return COLORED_TYPICAL;
    case 1: return PLAIN_LONG;
    case 2: return COLORED_HEAVY;
    case 3: return PLAIN_SHORT;
    default: return PYTHON_TRACEBACK;
  }
});

const BATCH_PLAIN_100 = Array.from({ length: 100 }, () => PLAIN_LONG);
const BATCH_COLORED_100 = Array.from({ length: 100 }, (_, i) =>
  i % 2 === 0 ? COLORED_TYPICAL : COLORED_HEAVY
);

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('parseAnsi', () => {
  describe('single line', () => {
    bench('plain short (fast path — indexOf bail)', () => {
      parseAnsi(PLAIN_SHORT);
    });

    bench('plain long (fast path)', () => {
      parseAnsi(PLAIN_LONG);
    });

    bench('colored typical (4 SGR pairs, Go logger)', () => {
      parseAnsi(COLORED_TYPICAL);
    });

    bench('colored heavy (256-color, RGB, attrs)', () => {
      parseAnsi(COLORED_HEAVY);
    });

    bench('python traceback (multi-line, many SGR)', () => {
      parseAnsi(PYTHON_TRACEBACK);
    });

    bench('pathological (50 rapid color changes)', () => {
      parseAnsi(PATHOLOGICAL);
    });

    bench('OSC hyperlinks + SGR', () => {
      parseAnsi(OSC_LINKS);
    });
  });

  describe('batch ingest (100 lines)', () => {
    bench('100 mixed lines (plain + colored)', () => {
      for (let i = 0; i < BATCH_MIXED_100.length; i++) {
        parseAnsi(BATCH_MIXED_100[i]);
      }
    });

    bench('100 plain lines (all fast path)', () => {
      for (let i = 0; i < BATCH_PLAIN_100.length; i++) {
        parseAnsi(BATCH_PLAIN_100[i]);
      }
    });

    bench('100 colored lines (worst case)', () => {
      for (let i = 0; i < BATCH_COLORED_100.length; i++) {
        parseAnsi(BATCH_COLORED_100[i]);
      }
    });
  });

  describe('buffer fill (100k lines — full log buffer)', () => {
    // This simulates filling the entire 100k circular buffer.
    // Target: under 500ms for the full buffer on modern hardware.
    bench('100k plain lines', () => {
      for (let i = 0; i < 1000; i++) {
        // Inner loop of 100 to reach 100k total
        for (let j = 0; j < BATCH_PLAIN_100.length; j++) {
          parseAnsi(BATCH_PLAIN_100[j]);
        }
      }
    }, { iterations: 3, warmupIterations: 1 });

    bench('100k mixed lines', () => {
      for (let i = 0; i < 1000; i++) {
        for (let j = 0; j < BATCH_MIXED_100.length; j++) {
          parseAnsi(BATCH_MIXED_100[j]);
        }
      }
    }, { iterations: 3, warmupIterations: 1 });
  });
});
