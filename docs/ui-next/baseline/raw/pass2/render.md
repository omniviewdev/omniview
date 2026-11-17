### Render benchmarks

V2 Pod benchmarks measure the native page (currently capped at 256 records) from the named corpus. Scroll takes up to 30 viewport steps within that page, then resets; it stops at the real scroll boundary. Older full-list baselines are not comparable.

| Scenario | Bench | mean ms | median ms | p75 ms | p99 ms | ±% | n |
|---|---|--:|--:|--:|--:|--:|--:|
| app shell | mount App until welcome page | 2.8 | 2.6 | 2.8 | 5.2 | 2.4 | 536 |
| bottom drawer | mount drawer + open logs tab (1k lines) | 33.4 | 33.3 | 34.1 | 35.3 | 0.9 | 45 |
| bottom drawer | drag-resize with logs open (41 frames) | 683 | 683 | 684 | 686 | 0.2 | 10 |
| k8s pod table, native page from 1000-pod corpus | mount until first row | 72.9 | 71.6 | 74.6 | 85.1 | 3.1 | 21 |
| k8s pod table, native page from 1000-pod corpus | scroll up to 30 viewport steps within native page | 386 | 383 | 404 | 469 | 14.1 | 6 |
| k8s pod table, native page from 1000-pod corpus | sort by name (click header) | 15.7 | 15.3 | 16.7 | 20.1 | 3.2 | 96 |
| k8s pod table, native page from 5000-pod corpus | mount until first row | 133 | 133 | 134 | 144 | 2.3 | 12 |
| k8s pod table, native page from 5000-pod corpus | scroll up to 30 viewport steps within native page | 350 | 334 | 342 | 434 | 13.3 | 6 |
| k8s pod table, native page from 5000-pod corpus | sort by name (click header) | 21.8 | 22.3 | 24.3 | 46.6 | 8.9 | 69 |
| log viewer | mount empty viewer | 2.4 | 2.2 | 2.4 | 4.2 | 2.4 | 636 |
| log viewer | mount + stream 10k lines | 44.7 | 43.7 | 44.7 | 53.4 | 2.3 | 34 |
| log viewer | scroll 100k-line buffer, 30 pages | 26.7 | 26.2 | 27.0 | 35.3 | 2.4 | 57 |
