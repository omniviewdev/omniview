# Status: T7-matcher (the file-link matcher, issue #696 step 2)

- Agent: LinkMatcher. Goal: `file[:line[:col]]` candidates in a line of terminal text, as a pure TypeScript module: no emulator, no I/O, linear time, with the caps of the issue. No page wiring, no Go (steps 3 and 4 use it).
- Worktree: `~/omniview/wt/t696-matcher`. Branch: `feat/terminal-link-matcher` on `origin/main` `11b8d3758`. Epic #692.
- Owned: `ui-next/shell/panel/terminal/links/fileLinks.ts`, `fileLinks.test.ts`, `docs/ui-next/status/T7-matcher.md`, `docs/ui-next/status/T7-matcher/mutations.sh.txt`. `links.ts` and the hook (step 1) are untouched.

## API

```ts
findFileLinks(text: string, options?: { limits?: Partial<FileLinkLimits>; onStep?: () => void; cellWidth?: (codePoint: number) => number }): FileLinkCandidate[]
FILE_LINK_LIMITS = { maxLineLength: 2000, maxLinks: 10, maxPathLength: 1024, maxLinkLength: 500 }
cellWidth(codePoint): 0 | 1 | 2
FileLinkCandidate = { start, end, startCell, endCell, path, line?, col?, lineEnd?, colEnd?, diffPrefix? }
```

Candidates come in order of position and never overlap. `limits` and `onStep` are for tests; the page passes neither.

## Decisions

- **Range in cells.** `start`/`end` are UTF-16 offsets into the row text (end excluded). `startCell`/`endCell` are 0-based cell columns, end excluded: a wide character is 2 cells, a combining mark or zero-width character 0, the rest 1 (`cellWidth`, East Asian wide and full-width ranges and the emoji blocks). The emulator's `translateToString` skips the second cell of a wide character, so an offset into that string maps to cells by this rule. xterm's link range is 1-based and inclusive: the page adds 1 to `startCell` and uses `endCell` as it is. A caller whose emulator disagrees on a character (xterm's Unicode 11 addon vs. ours) passes its own `cellWidth`. Computed in one forward pass over the candidates, counted in the same steps. Not checked against a real xterm buffer (step 4).
- **Linear by construction, not by a regex.** One forward scan over words. A suffix is read by a hand-written reader that looks at most a few dozen characters ahead (digits are capped at 9, so a 10-digit number is not a line). A suffix that is read is consumed whether or not it gives a candidate, so no text is validated twice. Quote pairs are found in one pass (a closing quote that no suffix follows opens the next pair, so prose apostrophes pair with nothing). `onStep` is called once per character looked at: measured 2.0 to 4.75 steps per character on the shapes below, the tests allow 24.
- **Suffix forms** (VS Code's list read from `terminalLinkParsing.ts`, MIT; own code): `:12`, `:12:3`, `:12:3-9`, `:12:3-14.9`, `:12.3`, ` 12`, ` 12:3`, `#12`, `#12:3`, `, 12`, `",12`, `", line 12`, `", line 12, col 3` (also `column`, `character`, `characters`), `" on line 12`, `", lines 12-14, characters 3-9`, `:line 12`, `(12)`, `(12,3)`, `(12, 3)`, `(12:3)`, `[12,3]`, `: (12, 3)`, `:[12,5]`; and `#L12`, `#L12-L14`, `#L12C3` (forge anchors, not in VS Code). A no-break space counts as a space.
- **A strong suffix and a weak one.** A colon and a number (`Makefile:12`, `a.c:12:3`) or a quote that closed a path take any word. Every other form (`version 12`, `fn(1,2)`, `foo, 3`) needs a path with a dot or a slash, or prose and calls become links and eat the cap of 10.
- **Bare paths** (no suffix) need a slash (`./a/b.txt`, `/etc/hosts`, `src/lib/x.ts`), as VS Code's. Cut: trailing `.` and `,`; a leading `[`/`{`. Not a link: `name/arity` (`App.run/1`, Elixir), a path of only digits, dots, dashes and slashes (`1/2`, `//`), a path that VS Code's excluded characters (`( ) ' " : ; ? ! & * \` and backtick) cut short (the piece before the character is the candidate).
- **Text that is not a file**: a path of only digits, dots, dashes, slashes and colons is no candidate (`12:30:45`, `127.0.0.1:8080`, `1/2:3`).
- **URLs.** A word with `scheme://` is skipped from the scheme on: no candidate is taken inside it or after it in that word (`https://x/a.go:12`, `x=http://a/b.go:3`, `git+https://...`, `ssh://...`). `./https:/dir/a.go:3` (no double slash) and `example.com/pkg/a.go:12` (a domain-like directory, Go import paths) are candidates. `./http://a.go` is ambiguous and is taken as a URL (the safe side). **`file:///abs/path` is a path** (the scheme is cut: `path` is `/abs/path`, as Node, Kotlin and Rust print it); `file://host/x` is refused (it names no local path).
- **Quoted names with spaces** (`"my dir/my file.txt", line 3`, `'a b.txt':12`): the name is taken only with a suffix. A quoted name without spaces goes the word way.
- **Git diff prefixes.** `a/ b/ c/ i/ o/ w/ 1/ 2/` (git's own mnemonic set, VS Code's list) are cut only on a diff header: `--- x`, `+++ x` (the name at offset 4) and `diff --git`. The issue says "strip `a/` and `b/`"; stripping everywhere would name `b/src/a.go` (a real directory) wrongly, so it is the header only, as VS Code does. `diffPrefix` says what was cut so the resolver can try the path with it.
- **Hostile characters.** White space, every C0 control (ESC, newline, NUL, tab), DEL, the C1 controls, NBSP, `< > |`, zero-width and bidirectional format characters (U+200B to U+200F, U+2028 to U+202F, U+2060 to U+206F, U+FEFF), and the box-drawing and block characters (U+2500 to U+259F) end a word. A path never holds one. The candidate after an ESC starts after it.
- **Caps** (one table, `FILE_LINK_LIMITS`): a line over 2,000 characters gives nothing (the check is the first thing, so a 1 MB line costs no step); at most 10 candidates; a path over 1,024 characters is never a candidate; a link (path start to suffix end, no opening quote) over 500 characters is ignored. The 500 cap makes the 1,024 cap unreachable with the default table; both are kept and tested apart (the link cap lifted for the path test).
- **Paths as printed.** No normalisation (NFC and NFD stay as they are), no `~` expansion, no resolution against a directory. Unquoted spaces (`/Users/me/My Project/a.c:12:3`, MSVC and Clang) are not matched: the candidates are `/Users/me/My` (no line) and `Project/a.c` (line 12). Not handled here; step 3 could try wider starts. Windows: `C:\x\a.cpp(12)` and `C:\x\a.cpp:12` are candidates; a bare backslash path with no suffix is not.

## Log

- 2026-11-28 `db18d787eac0b44b302519ec5a27c9d3473b6db3` (red): the tests against a stub of the final API that returns nothing. 129 of 171 fail by their own assertions (for example `expected [] to deeply equal [ { path: 'src/main.go', line: 42, ... } ]` and `expected 0 to be greater than 500000`); the 42 that pass on a stub are tests that expect no link (a clock time, a URL) and the step-budget tests, which carry a check that a stub that looks at nothing cannot satisfy (`steps >= length / 2`, seen failing).
- 2026-11-28 `0fb48ea5e2dc6917a87fa3d32cf7cb7599b1ce2c` (green): the matcher. 171 of 171.
- 2026-11-28 `e387e11fadaf90ca8c8fbbef79e0045b4c3ed808`: the controls script.

## Tests

`ui-next/shell/panel/terminal/links/fileLinks.test.ts`, 171 tests. **Emulator: none.** The module takes a string; no page test, no xterm (real or fake) is involved, and the cell mapping is tested against `cellWidth` only (not against a real xterm buffer).

- **86 rows of real output formats** (at least 20 asked): Python tracebacks (quoted names with spaces too, `<string>`, pytest node ids, flake8), cargo (arrow, secondary span, panic with a trailing colon), Go (compiler, test, panic with `+0x132`, import paths), Ruby `a.rb:20:in`, Elixir (with `name/arity`), PHP `on line`, Perl `line`, bash `: line 12:`, make, grep `0:` and `-n`, gcc and clang, MSVC with a drive letter, Java and Maven, Kotlin and Node with `file:///`, Dart `package:`, TypeScript `(12,3)` and pretty, eslint (stylish: the file line is a link and `12:5  error` is not; compact), jest, box-drawing prefixes (`├──`, `│`), a trailing period, brackets and parentheses around and inside a path, `~`, `..`, two links on a line; and every suffix form listed above.
- Git diff prefixes (4), URLs (10 + 4), caps (9: 2,000 and 2,001; 10; a 500-link and a 502-link; a 1,024 path and a 1,026 path with the link cap lifted), hostile lines (13 control and format characters, ESC, newline, a 100 KB path under three cap settings, a 100 KB quoted name, a 20-digit number, NFC and NFD, non-Latin letters, a bidirectional override, empty and partial suffix inputs, ordering and no overlap), cells (7).
- **Steps, not milliseconds.** `onStep` is called per character looked at; the test's callback throws when the count passes `24 * length`, so a quadratic scan ends at the budget. 1 MB of dots and colons: 0 steps under the default cap, about 4 steps per character with every cap lifted; the 100 KB and 1 MB runs differ by at most 11 times; 18 shapes of 1 MB (dots, colons, `/:`, `a:1` repeated with no cap on links, open brackets, quotes, `file:///`, `ab://`, quoted names with spaces, long numbers, `#L1`); 6 random alphabets x 3 seeds x 300,000 characters; 200 random lines of the cap.

Measured steps per character (`onStep` count / length, every cap lifted): dots and colons 4.00, `a:1` 4.33, `a:1 ` 4.25, `(` 3.00, `ab(` 3.67, `"` 3.00, `"a ` 3.33, `a.b 1 ` 4.00, `a.b line 1 ` 3.09, quoted names 2.07, `file:///` 3.25, `ab://` 2.00, `a/b:` 4.75. Load average 7.8 (`uptime`, 04:12): counts do not depend on it.

## Negative controls (AGENTS 28)

`docs/ui-next/status/T7-matcher/mutations.sh.txt`, run from the worktree: `bash docs/ui-next/status/T7-matcher/mutations.sh.txt [name]`. Each fault is applied (perl) to a scratch copy of `fileLinks.ts`, beside a copy of the test, in a directory the script removes; the worktree's files are never edited. Half 1: the tests that go red are exactly the ones named (regular expressions on the full name; a suite that fails to load is reported as such, not as a detection). Half 2: with the named tests skipped (`-t` with a negative lookahead), the same fault passes. The first run found two faults in the script itself (a fault that was a syntax error and read as "undetected"; a name list that matched on a prefix vitest does not use), fixed before this run. All 17, both halves, on `e387e11f`, exit code 0 (`ALL CONTROLS HOLD in both halves`):

| Control (the fault) | Tests that go red | Without them |
|---|---|---|
| backtracking-rescan-from-the-word-start (each `:` re-reads the word from its start: the step count of a backtracking matcher) | the 6 step-count tests | pass |
| line-cap-removed | 2,000 and 2,001; 1 MB under the default cap | pass |
| link-count-cap-removed | 10 per line (4 tests) | pass |
| path-cap-removed | 1,024 path; 100 KB path | pass |
| link-length-cap-removed | 500 characters | pass |
| url-path-taken (a URL is scanned as a path) | 13 (10 URL lines, before-a-URL, file with a host, the row) | pass |
| file-url-treated-as-a-url | Kotlin and Node `file:///` | pass |
| esc-and-newline-allowed-in-a-path | ESC, newline, control characters | pass |
| format-and-bidi-characters-allowed-in-a-path | format characters, bidirectional override | pass |
| diff-prefix-kept | 3 diff tests | pass |
| diff-prefix-stripped-on-every-line | 2 | pass |
| trailing-period-and-comma-kept-on-a-bare-path | 2 | pass |
| wide-characters-one-cell | 5 cell tests | pass |
| numbers-only-path-taken | clock time, port, fraction, eslint problem line | pass |
| weak-suffix-needs-no-dot-or-slash | 9 | pass |
| long-number-is-a-line | 20-digit number | pass |
| no-arity-check-on-a-bare-path | the two Elixir rows | pass |

## Commands

From the worktree, after `pnpm install --frozen-lockfile` and `task packages` (the shim and `dist/.gitkeep` restored with `git checkout --`, not committed):

- `pnpm exec vitest run ui-next/shell/panel/terminal/links`: 3 files, 250 tests passed (this file 171).
- `pnpm exec tsc -p tsconfig.app.json --noEmit`: exit 0. `pnpm exec tsc -p tsconfig.test.json --noEmit`: exit 0.
- `pnpm exec eslint ui-next/shell/panel/terminal/links --report-unused-disable-directives`: exit 0 (after `--fix` on the two new files for the repository's blank-line rule).
- `bash docs/ui-next/status/T7-matcher/mutations.sh.txt`: exit 0, 17 controls, both halves.

## Not verified

- No page: the matcher is not wired to a link provider, no real xterm buffer, no wrapped rows (the provider joins them and caps the join; the matcher takes one string), no seam, no WebKit or Chromium, no Windows or macOS run (the module has no platform code).
- Cells against xterm's own widths (Unicode 11 addon) for rare characters.
- Recall against a real corpus of tool output beyond the 86 rows (no sample from a machine's history was scanned); precision is bounded by the resolver (Go `stat`, step 3): the matcher gives candidates, `ResolveLink` says which are files. Known noise: `and/or`, `km/h`, `localhost:3000` are candidates.
- Not matched: unquoted spaces in a path, `key=/path` (the key is taken into the path: `--out=/tmp/a.txt:3` gives `--out=/tmp/a.txt`), a query string (`a.tsx?t=1:12`), bare words with no slash (`main.go` alone), a Windows path with backslashes and no suffix.

## Dev tools

- `docs/ui-next/status/T7-matcher/mutations.sh.txt`: the controls runner (above).
- A scratch measuring test (an `onStep` counter over 13 shapes, deleted after use): its numbers are in "Tests".

## Backend catalog

None.
