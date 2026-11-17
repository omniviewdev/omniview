### Render benchmarks

V2 Pod benchmarks measure the native page (currently capped at 256 records) from the named corpus. Scroll takes up to 30 viewport steps within that page, then resets; it stops at the real scroll boundary. Older full-list baselines are not comparable.

| Scenario | Bench | mean ms | median ms | p75 ms | p99 ms | ±% | n |
|---|---|--:|--:|--:|--:|--:|--:|
| app shell | mount App until welcome page | 2.9 | 2.7 | 3.0 | 5.4 | 2.5 | 513 |
| bottom drawer | mount drawer + open logs tab (1k lines) | 33.3 | 33.6 | 34.4 | 35.4 | 1.3 | 46 |
| bottom drawer | drag-resize with logs open (41 frames) | 683 | 683 | 684 | 684 | 0.0 | 10 |
| k8s pod table, native page from 1000-pod corpus | mount until first row | 80.1 | 79.5 | 81.6 | 93.0 | 2.7 | 19 |
| k8s pod table, native page from 1000-pod corpus | scroll up to 30 viewport steps within native page | 394 | 385 | 431 | 459 | 13.2 | 6 |
| k8s pod table, native page from 1000-pod corpus | sort by name (click header) | 17.9 | 17.0 | 17.9 | 31.8 | 6.6 | 84 |
| k8s pod table, native page from 5000-pod corpus | mount until first row | 140 | 140 | 141 | 162 | 4.2 | 11 |
| k8s pod table, native page from 5000-pod corpus | scroll up to 30 viewport steps within native page | 399 | 392 | 447 | 479 | 16.8 | 6 |
| k8s pod table, native page from 5000-pod corpus | sort by name (click header) | 22.8 | 24.4 | 26.6 | 28.2 | 4.8 | 66 |
| log viewer | mount empty viewer | 2.7 | 2.5 | 2.8 | 4.9 | 2.1 | 563 |
| log viewer | mount + stream 10k lines | 47.9 | 47.2 | 48.6 | 56.5 | 2.0 | 32 |
| log viewer | scroll 100k-line buffer, 30 pages | 28.6 | 27.8 | 28.8 | 44.0 | 3.5 | 53 |
