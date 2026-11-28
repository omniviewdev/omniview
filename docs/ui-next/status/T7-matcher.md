# Status: T7-matcher (the file-link matcher, issue #696 step 2)

- Agent: LinkMatcher. Goal: `file[:line[:col]]` candidates in a line of terminal text, as a pure TypeScript module: no emulator, no I/O, linear time, with the caps of the issue. No page wiring, no Go (steps 3 and 4 use it).
- Worktree: `~/omniview/wt/t696-matcher`. Branch: `feat/terminal-link-matcher` on `origin/main` `11b8d3758`. Epic #692.
- Owned: `ui-next/shell/panel/terminal/links/fileLinks.ts`, `fileLinks.test.ts`, `docs/ui-next/status/T7-matcher.md`, `docs/ui-next/status/T7-matcher/mutations.sh.txt`. `links.ts` and the hook (step 1) are untouched.

## API

```ts
findFileLinks(text: string, options?: { limits?: Partial<FileLinkLimits>; onStep?: () => void }): FileLinkCandidate[]
FILE_LINK_LIMITS = { maxLineLength: 2000, maxLinks: 10, maxPathLength: 1024, maxLinkLength: 500 }
FileLinkCandidate = { start, end, path, line?, col?, lineEnd?, colEnd?, diffPrefix? }   // start/end: UTF-16 offsets into the text, end excluded
```

Candidates come in order of position and never overlap. `limits` and `onStep` are for tests; the page passes neither.

## Decisions

- **Offsets only, no cells (review fix).** The first version kept a width table and gave `startCell`/`endCell`; the review found it disagrees with xterm's Unicode 11 widths on 10,049 code points (`✅` is 2 in xterm, 1 in the table; Arabic and Thai marks are 0), so `✅ src/a.test.ts:12:3` started at cell 2 where the real cell is 3. The table, `cellWidth` and both fields are deleted. The matcher returns UTF-16 offsets into the text it was given. The provider (step 4) gives it the logical line (wrapped rows joined, from the first row of the chain, cut at 2,000 characters) and maps an offset to a buffer cell through the buffer's own cells, one table entry for each UTF-16 offset; xterm's link range is 1-based and inclusive, so the page adds 1 to the cell of `start` and takes the cell of `end - 1`.
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

## Offsets against a real xterm (Main's request, then the review's fix)

`fileLinksXterm.test.ts`, 22 tests. **Emulator: real `@xterm/xterm` 6.0.0 with `@xterm/addon-unicode11`, activeVersion 11 (as `xtermEngine.ts` loads it), no fake.** Lines with CJK, fullwidth, emoji (wide BMP emoji `✅❌✨⚡⭐⌛`, `U+1F004`, a ZWJ pair, a flag), presentation selectors, combining marks (Latin, Arabic, Thai), NFD jamo, a kana voiced mark and a tab are written into a 60-column terminal. The test helper `logicalLine` is the mapping the provider will make: it walks UP to the first row of the wrapped chain and DOWN to the last, drops the second half of a wide character and the padding cell at a row end, and maps every UTF-16 offset to its cell. For every candidate the cell of `start` and the cell of `end - 1` hold the first and the last character of the path, and `translateToString` from the first cell starts with it. The helper lives in the test until step 4 writes the provider (stated, not shipped here). These tests were green on the first run: they were not seen red (the width table they would have caught is deleted).
- **Found, by the first version of the wrap test (red: `expected '日本/x.go' to be 'abcdefghi日本/x.go'`):** when a wide character does not fit at the end of a row, xterm moves it to the next row and leaves a blank padding cell (empty chars, width 1) that reads as a space and splits the path. The matcher cannot know about it.
- **Wrapped lines, decided:** the provider (step 4) reads the whole chain of `isWrapped` rows as one string (VS Code does the same), from the FIRST row of the chain whichever row `provideLinks(y)` is asked for, cut at `maxLineLength` (2,000), leaves the padding cell out of the text, and maps offsets to cells with the table. A row read alone does not give a path that wraps (tested). Not in this module.

## Review fixes (ReviewMatcher, FIX FIRST)

- **A quote inside a word** now ends the path before it and starts the next (`{"ts":"2026-11-28T12:30:45Z","caller":"app/main.go:42"}` gives `app/main.go`; `time="2026-…"` gives nothing). Red rows for both.
- **Exclusions, each with a row:** a version (`v1.2.3:4`, `go1.22.1:5`), an ISO time stamp (`2026-11-28T12:30:45`), an IPv6 address (`fe80::1`, `[::1]:8080`), an image tag (a `:N.M` suffix on a last name that has no dot: `nginx:1.25`, `ghcr.io/org/app:1.2`; `src/a.go:12.5` stays a link), a rate (`9.00it/s`, `5MB/s`). A path must also hold a letter, an underscore or a non-ASCII character, so `]:8080` is no link. A suffix at the end of a word that gives no candidate is no longer consumed (`at 2026-11-28T12:30:45Z` had lost its `2026` to the ` 2026` that `at` rejected).
- **Decided, kept as printed:** `node:internal/modules/cjs/loader:1256:14` is a candidate with that path and `java.base/java.lang.Thread.run(Thread.java:833)` gives the class name as a bare path and `Thread.java:833` as a link. Neither is a file on disk; `ResolveLink` answers `unknown` and no link is drawn. Stripping `node:` here would make the resolver look for `internal/modules/...`, a wrong same-named file.
- **`file:///` paths are percent-decoded** (`%20` is a space); a decoded control, bidirectional or zero-width character drops the candidate (`%0A`, `%1b`, `%E2%80%AE`); an escape that does not decode is left as printed. **Curly quotes** `“` and `”` pair as a quote.
- **Mutants of the review that survived, each now has a test and a control:** NBSP as a space (a quoted name with an NBSP; `src/a.ts:\u00a0(12)`), the `://` guard in `spacedName`, the strip of a leading `[` or `{` (`[src/lib/a.go]`, `{./a/b.txt}`). The fourth, the reset of an open quote at a break in the quote pairing, is **equivalent**: 200,000 random lines over ten fragments (quotes, ESC, newline, spaces, suffix words) gave the same candidates with and without it, because `spacedName` already refuses a name that holds a break and a failed pair re-opens at the second quote. The reset is deleted instead of tested.
- Red: the new rows (21 of them) fail against the matcher of `b560d37c7` (`vitest` on a scratch copy of the old module and the new test). The xterm test was green on its first run.

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

`docs/ui-next/status/T7-matcher/mutations.sh.txt`, run from the worktree: `bash docs/ui-next/status/T7-matcher/mutations.sh.txt [name]`. Each fault is applied (perl) to a scratch copy of `fileLinks.ts`, beside a copy of the test, in a directory the script removes; the worktree's files are never edited. Half 1: the tests that go red are exactly the ones named (regular expressions on the full name; a suite that fails to load is reported as such, not as a detection). Half 2: with the named tests skipped (`-t` with a negative lookahead), the same fault passes. The first run found two faults in the script itself (a fault that was a syntax error and read as "undetected"; a name list that matched on a prefix vitest does not use), fixed before this run. 28 controls after the review fix (the cell control is gone, 12 are new: quote-inside-a-word, version, iso-time, ipv6, image-tag, rate, file-url-not-decoded, file-url-control-kept, curly-quotes, nbsp, quoted-name-url-guard, leading-bracket). The whole script ran once on the fixed code: 24 held and 4 had lists of named tests that the new exclusions had changed (the control's own fault, fixed in the script); those 4 were then re-run alone and hold, both halves. The table below is the first 17; the 12 new ones are named above and in the script:

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
| numbers-only-path-taken | clock time, port, fraction, eslint problem line | pass |
| weak-suffix-needs-no-dot-or-slash | 9 | pass |
| long-number-is-a-line | 20-digit number | pass |
| no-arity-check-on-a-bare-path | the two Elixir rows | pass |

## Commands

From the worktree, after `pnpm install --frozen-lockfile` and `task packages` (the shim and `dist/.gitkeep` restored with `git checkout --`, not committed):

- `pnpm exec vitest run ui-next/shell/panel/terminal/links`: 4 files, 217 tests passed (this file 195, the xterm file 22).
- `pnpm exec tsc -p tsconfig.app.json --noEmit`: exit 0. `pnpm exec tsc -p tsconfig.test.json --noEmit`: exit 0.
- `pnpm exec eslint ui-next/shell/panel/terminal/links --report-unused-disable-directives`: exit 0 (after `--fix` on the two new files for the repository's blank-line rule).
- `bash docs/ui-next/status/T7-matcher/mutations.sh.txt`: exit 0, 17 controls, both halves.

## Not verified

- No page: the matcher is not wired to a link provider, no seam, no WebKit or Chromium, no Windows or macOS run. The provider's join and mapping exist only as the test helper `logicalLine` (step 4's job).
- Recall against a real corpus of tool output beyond the 86 rows (no sample from a machine's history was scanned); precision is bounded by the resolver (Go `stat`, step 3): the matcher gives candidates, `ResolveLink` says which are files. Known noise: `and/or`, `km/h`, `localhost:3000` are candidates.
- Not matched: unquoted spaces in a path, `key=/path` (the key is taken into the path: `--out=/tmp/a.txt:3` gives `--out=/tmp/a.txt`), a query string (`a.tsx?t=1:12`), bare words with no slash (`main.go` alone), a Windows path with backslashes and no suffix.

## Dev tools

- `docs/ui-next/status/T7-matcher/mutations.sh.txt`: the controls runner (above).
- A scratch measuring test (an `onStep` counter over 13 shapes, deleted after use): its numbers are in "Tests".

## Backend catalog

None.
