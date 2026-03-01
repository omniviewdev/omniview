import { bench, describe } from 'vitest';
import {
  compileSearchPattern,
  execSafeSearch,
  execSafeSearchRange,
} from './regexSafety';

// ---------------------------------------------------------------------------
// Test data — representative of real Kubernetes / application log lines
// ---------------------------------------------------------------------------

const PLAIN_LOG = '2024-01-15T10:30:00.123Z INFO  [request_id=abc-123] GET /api/v1/namespaces/kube-system/pods responded 200 in 12.34ms';
const ERROR_LOG = '2024-01-15T10:30:00.456Z ERROR [controller/deployment] failed to reconcile deployment/nginx-ingress in namespace kube-system: connection refused (retries=3)';
const JSON_LOG = '{"timestamp":"2024-01-15T10:30:00Z","level":"warn","msg":"pod evicted","namespace":"default","pod":"worker-7f8b9c","reason":"NodeNotReady","node":"ip-10-0-1-42"}';

// Build line arrays of various sizes
function buildLines(count: number): string[] {
  const templates = [PLAIN_LOG, ERROR_LOG, JSON_LOG];
  return Array.from({ length: count }, (_, i) => templates[i % templates.length]);
}

const LINES_100 = buildLines(100);
const LINES_1K = buildLines(1_000);
const LINES_10K = buildLines(10_000);
const LINES_100K = buildLines(100_000);

// Precompiled patterns
const LITERAL_PATTERN = compileSearchPattern('error', { isRegex: false, caseSensitive: false })!;
const LITERAL_CASE_PATTERN = compileSearchPattern('ERROR', { isRegex: false, caseSensitive: true })!;
const REGEX_PATTERN = compileSearchPattern('pod[s]?', { isRegex: true, caseSensitive: false })!;
const COMPLEX_REGEX = compileSearchPattern('\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b', { isRegex: true, caseSensitive: false })!;
const RARE_PATTERN = compileSearchPattern('NodeNotReady', { isRegex: false, caseSensitive: true })!;

function buildMatch(lineIndex: number, start: number, end: number) {
  return { lineIndex, start, end };
}

// ---------------------------------------------------------------------------
// Pattern compilation
// ---------------------------------------------------------------------------

describe('compileSearchPattern', () => {
  bench('literal string', () => {
    compileSearchPattern('error', { isRegex: false, caseSensitive: false });
  });

  bench('literal string (case sensitive)', () => {
    compileSearchPattern('ERROR', { isRegex: false, caseSensitive: true });
  });

  bench('regex pattern', () => {
    compileSearchPattern('pod[s]?', { isRegex: true, caseSensitive: false });
  });

  bench('complex regex (IP address)', () => {
    compileSearchPattern('\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b', { isRegex: true, caseSensitive: false });
  });

  bench('invalid regex (returns null)', () => {
    compileSearchPattern('[unclosed', { isRegex: true, caseSensitive: false });
  });
});

// ---------------------------------------------------------------------------
// execSafeSearch — full buffer scans
// ---------------------------------------------------------------------------

describe('execSafeSearch — full scan', () => {
  describe('100 lines', () => {
    bench('literal (case insensitive)', () => {
      execSafeSearch(LITERAL_PATTERN, LINES_100.length, (i) => LINES_100[i], buildMatch);
    });

    bench('literal (case sensitive)', () => {
      execSafeSearch(LITERAL_CASE_PATTERN, LINES_100.length, (i) => LINES_100[i], buildMatch);
    });

    bench('regex (pod[s]?)', () => {
      execSafeSearch(REGEX_PATTERN, LINES_100.length, (i) => LINES_100[i], buildMatch);
    });
  });

  describe('1k lines', () => {
    bench('literal (case insensitive)', () => {
      execSafeSearch(LITERAL_PATTERN, LINES_1K.length, (i) => LINES_1K[i], buildMatch);
    });

    bench('regex (pod[s]?)', () => {
      execSafeSearch(REGEX_PATTERN, LINES_1K.length, (i) => LINES_1K[i], buildMatch);
    });

    bench('complex regex (IP address)', () => {
      execSafeSearch(COMPLEX_REGEX, LINES_1K.length, (i) => LINES_1K[i], buildMatch);
    });
  });

  describe('10k lines', () => {
    bench('literal (case insensitive)', () => {
      execSafeSearch(LITERAL_PATTERN, LINES_10K.length, (i) => LINES_10K[i], buildMatch);
    });

    bench('regex (pod[s]?)', () => {
      execSafeSearch(REGEX_PATTERN, LINES_10K.length, (i) => LINES_10K[i], buildMatch);
    });

    bench('rare term (1 in 3 lines)', () => {
      execSafeSearch(RARE_PATTERN, LINES_10K.length, (i) => LINES_10K[i], buildMatch);
    });
  });

  describe('100k lines — full log buffer', () => {
    bench('literal (case insensitive)', () => {
      execSafeSearch(LITERAL_PATTERN, LINES_100K.length, (i) => LINES_100K[i], buildMatch);
    }, { iterations: 3, warmupIterations: 1 });

    bench('rare term', () => {
      execSafeSearch(RARE_PATTERN, LINES_100K.length, (i) => LINES_100K[i], buildMatch);
    }, { iterations: 3, warmupIterations: 1 });

    bench('complex regex (IP address)', () => {
      execSafeSearch(COMPLEX_REGEX, LINES_100K.length, (i) => LINES_100K[i], buildMatch);
    }, { iterations: 3, warmupIterations: 1 });
  });
});

// ---------------------------------------------------------------------------
// execSafeSearchRange — incremental search (the hot path for live logs)
// ---------------------------------------------------------------------------

describe('execSafeSearchRange — incremental append', () => {
  // Simulates the incremental search scenario: buffer already has N lines,
  // search only the newly appended tail.

  describe('append 10 lines to 10k buffer', () => {
    bench('literal', () => {
      execSafeSearchRange(LITERAL_PATTERN, 10_000 - 10, 10_000, (i) => LINES_10K[i], buildMatch);
    });

    bench('regex (pod[s]?)', () => {
      execSafeSearchRange(REGEX_PATTERN, 10_000 - 10, 10_000, (i) => LINES_10K[i], buildMatch);
    });
  });

  describe('append 100 lines to 100k buffer', () => {
    bench('literal', () => {
      execSafeSearchRange(LITERAL_PATTERN, 100_000 - 100, 100_000, (i) => LINES_100K[i], buildMatch);
    });

    bench('regex (pod[s]?)', () => {
      execSafeSearchRange(REGEX_PATTERN, 100_000 - 100, 100_000, (i) => LINES_100K[i], buildMatch);
    });

    bench('complex regex (IP address)', () => {
      execSafeSearchRange(COMPLEX_REGEX, 100_000 - 100, 100_000, (i) => LINES_100K[i], buildMatch);
    });
  });

  describe('append 1k lines to 100k buffer', () => {
    bench('literal', () => {
      execSafeSearchRange(LITERAL_PATTERN, 100_000 - 1_000, 100_000, (i) => LINES_100K[i], buildMatch);
    });

    bench('complex regex (IP address)', () => {
      execSafeSearchRange(COMPLEX_REGEX, 100_000 - 1_000, 100_000, (i) => LINES_100K[i], buildMatch);
    });
  });

  describe('incremental with custom matchBudget', () => {
    bench('budget=100 on 1k lines', () => {
      execSafeSearchRange(LITERAL_PATTERN, 0, 1_000, (i) => LINES_1K[i], buildMatch, 100);
    });

    bench('budget=10 on 1k lines (early bail)', () => {
      execSafeSearchRange(LITERAL_PATTERN, 0, 1_000, (i) => LINES_1K[i], buildMatch, 10);
    });
  });
});

// ---------------------------------------------------------------------------
// Full vs incremental comparison
// ---------------------------------------------------------------------------

describe('full scan vs incremental — 100k buffer, 100 new lines', () => {
  bench('FULL: re-scan all 100k lines', () => {
    execSafeSearch(LITERAL_PATTERN, LINES_100K.length, (i) => LINES_100K[i], buildMatch);
  }, { iterations: 3, warmupIterations: 1 });

  bench('INCREMENTAL: scan only last 100 lines', () => {
    execSafeSearchRange(LITERAL_PATTERN, 100_000 - 100, 100_000, (i) => LINES_100K[i], buildMatch);
  }, { iterations: 3, warmupIterations: 1 });
});
