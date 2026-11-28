import { describe, expect, it } from 'vitest';
import { cellWidth, FILE_LINK_LIMITS, findFileLinks, type FileLinkLimits, type FindFileLinksOptions } from './fileLinks';

// The file-link matcher: which `file[:line[:col]]` candidates a line of terminal output holds, found by one forward scan. Every test names a fact: the formats real tools print, the caps of the issue, the lines a hostile
// program can print, and the step count that shows the scan never backtracks.

type Found = { path: string; line?: number; col?: number; lineEnd?: number; colEnd?: number; text: string };

/** What a line gives, with the text each candidate covers (the range is part of what is claimed). */
const found = (text: string, options?: FindFileLinksOptions): Found[] =>
  findFileLinks(text, options).map((c) => ({
    path: c.path,
    ...(c.line === undefined ? {} : { line: c.line }),
    ...(c.col === undefined ? {} : { col: c.col }),
    ...(c.lineEnd === undefined ? {} : { lineEnd: c.lineEnd }),
    ...(c.colEnd === undefined ? {} : { colEnd: c.colEnd }),
    text: text.slice(c.start, c.end),
  }));

const UNCAPPED: FileLinkLimits = {
  maxLineLength: Number.MAX_SAFE_INTEGER,
  maxLinks: Number.MAX_SAFE_INTEGER,
  maxPathLength: Number.MAX_SAFE_INTEGER,
  maxLinkLength: Number.MAX_SAFE_INTEGER,
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The formats of real tools: one row each, the line as the tool prints it and the candidates the matcher must give.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

type Row = readonly [label: string, line: string, expected: Found[]];

const FORMATS: readonly Row[] = [
  // Shapes named by the issue.
  ['path:line', 'src/main.go:42', [{ path: 'src/main.go', line: 42, text: 'src/main.go:42' }]],
  ['path:line:col', 'src/main.go:42:7', [{ path: 'src/main.go', line: 42, col: 7, text: 'src/main.go:42:7' }]],
  ['path(line,col)', 'src/App.cs(12,3): error CS1002', [{ path: 'src/App.cs', line: 12, col: 3, text: 'src/App.cs(12,3)' }]],
  ['"path", line N', 'in "src/app.rb", line 9', [{ path: 'src/app.rb', line: 9, text: 'src/app.rb", line 9' }]],
  ['path line N', 'at script.pl line 12.', [{ path: 'script.pl', line: 12, text: 'script.pl line 12' }]],
  ['path#Lline', 'see README.md#L10 for more', [{ path: 'README.md', line: 10, text: 'README.md#L10' }]],

  // VS Code's other suffix forms.
  ['path#Lline-Lline', 'README.md#L10-L20', [{ path: 'README.md', line: 10, lineEnd: 20, text: 'README.md#L10-L20' }]],
  ['path:line:col-colEnd', 'src/a.go:12:5-9: x', [{ path: 'src/a.go', line: 12, col: 5, colEnd: 9, text: 'src/a.go:12:5-9' }]],
  ['path:line:col-lineEnd.colEnd', 'src/a.go:12:5-20.9', [{ path: 'src/a.go', line: 12, col: 5, lineEnd: 20, colEnd: 9, text: 'src/a.go:12:5-20.9' }]],
  ['path:line.col', 'src/a.go:12.5', [{ path: 'src/a.go', line: 12, col: 5, text: 'src/a.go:12.5' }]],
  ['path line:col', 'see src/a.go 12:5 here', [{ path: 'src/a.go', line: 12, col: 5, text: 'src/a.go 12:5' }]],
  ['path#line:col', 'src/a.go#12:5', [{ path: 'src/a.go', line: 12, col: 5, text: 'src/a.go#12:5' }]],
  ['path, line', 'see src/a.go, 12 here', [{ path: 'src/a.go', line: 12, text: 'src/a.go, 12' }]],
  ['"path",line', 'in "src/a.go",12', [{ path: 'src/a.go', line: 12, text: 'src/a.go",12' }]],
  ['"path", line N, col M', 'File "a.py", line 3, col 9', [{ path: 'a.py', line: 3, col: 9, text: 'a.py", line 3, col 9' }]],
  ['"path", line N, column M', 'File "a.py", line 3, column 9', [{ path: 'a.py', line: 3, col: 9, text: 'a.py", line 3, column 9' }]],
  ['"path", line N, character M', 'File "a.py", line 3, character 9', [{ path: 'a.py', line: 3, col: 9, text: 'a.py", line 3, character 9' }]],
  ['"path", lines N-M', 'File "a.py", lines 3-5', [{ path: 'a.py', line: 3, lineEnd: 5, text: 'a.py", lines 3-5' }]],
  ['"path", lines N-M, characters A-B', 'File "a.py", lines 3-5, characters 7-9', [{ path: 'a.py', line: 3, lineEnd: 5, col: 7, colEnd: 9, text: 'a.py", lines 3-5, characters 7-9' }]],
  ['"path" on line N', 'file "a.py" on line 8', [{ path: 'a.py', line: 8, text: 'a.py" on line 8' }]],
  ['path: line N, col M', '/home/u/a.js: line 12, col 5, Error - msg', [{ path: '/home/u/a.js', line: 12, col: 5, text: '/home/u/a.js: line 12, col 5' }]],
  ['path:line N', './run.sh:line 4', [{ path: './run.sh', line: 4, text: './run.sh:line 4' }]],
  ['path (line)', 'src/a.ts (12) failed', [{ path: 'src/a.ts', line: 12, text: 'src/a.ts (12)' }]],
  ['path: (line, col)', 'src/a.ts: (12, 3) failed', [{ path: 'src/a.ts', line: 12, col: 3, text: 'src/a.ts: (12, 3)' }]],
  ['path(line:col)', 'src/a.ts(12:3)', [{ path: 'src/a.ts', line: 12, col: 3, text: 'src/a.ts(12:3)' }]],
  ['path[line,col]', 'src/a.ts[12,3]', [{ path: 'src/a.ts', line: 12, col: 3, text: 'src/a.ts[12,3]' }]],
  ['path:[line,col]', '/home/u/A.java:[12,5] error: x', [{ path: '/home/u/A.java', line: 12, col: 5, text: '/home/u/A.java:[12,5]' }]],
  ['path with a no-break space before the line', 'src/a.go\u00a012', [{ path: 'src/a.go', line: 12, text: 'src/a.go\u00a012' }]],

  // Python
  ['python traceback', '  File "/home/u/app.py", line 12, in main', [{ path: '/home/u/app.py', line: 12, text: '/home/u/app.py", line 12' }]],
  ['python traceback, a name with spaces', '  File "/home/u/my app/run it.py", line 3, in <module>', [{ path: '/home/u/my app/run it.py', line: 3, text: '/home/u/my app/run it.py", line 3' }]],
  ['python <string> has no file', '  File "<string>", line 1', []],
  ['pytest failure', 'tests/test_a.py:12: AssertionError', [{ path: 'tests/test_a.py', line: 12, text: 'tests/test_a.py:12' }]],
  ['pytest node id has the file with no line', 'tests/test_a.py::test_name FAILED', [{ path: 'tests/test_a.py', text: 'tests/test_a.py' }]],
  ['flake8', 'src/app.py:12:5: E501 line too long', [{ path: 'src/app.py', line: 12, col: 5, text: 'src/app.py:12:5' }]],

  // Rust
  ['cargo arrow', ' --> src/main.rs:4:5', [{ path: 'src/main.rs', line: 4, col: 5, text: 'src/main.rs:4:5' }]],
  ['cargo secondary span', '  ::: src/other.rs:3:1', [{ path: 'src/other.rs', line: 3, col: 1, text: 'src/other.rs:3:1' }]],
  ['rust panic with a trailing colon', "thread 'main' panicked at src/main.rs:4:5:", [{ path: 'src/main.rs', line: 4, col: 5, text: 'src/main.rs:4:5' }]],

  // Go
  ['go compiler', './main.go:12:5: undefined: x', [{ path: './main.go', line: 12, col: 5, text: './main.go:12:5' }]],
  ['go test', '    foo_test.go:20: expected 1, got 2', [{ path: 'foo_test.go', line: 20, text: 'foo_test.go:20' }]],
  ['go panic with an offset', '\t/usr/local/go/src/runtime/panic.go:770 +0x132', [{ path: '/usr/local/go/src/runtime/panic.go', line: 770, text: '/usr/local/go/src/runtime/panic.go:770' }]],
  ['go import path as a directory', 'github.com/acme/tool/pkg/a.go:12', [{ path: 'github.com/acme/tool/pkg/a.go', line: 12, text: 'github.com/acme/tool/pkg/a.go:12' }]],

  // Ruby, Elixir, Perl, PHP, shell, make
  ['ruby in', "\tfrom /app/a.rb:20:in `foo'", [{ path: '/app/a.rb', line: 20, text: '/app/a.rb:20' }]],
  ['elixir', '    lib/app.ex:12: App.run/1', [{ path: 'lib/app.ex', line: 12, text: 'lib/app.ex:12' }]],
  ['elixir with the application', '    (app 0.1.0) lib/app.ex:12: App.run/1', [{ path: 'lib/app.ex', line: 12, text: 'lib/app.ex:12' }]],
  ['php', 'PHP Fatal error:  Uncaught Error in /var/www/a.php on line 12', [{ path: '/var/www/a.php', line: 12, text: '/var/www/a.php on line 12' }]],
  ['bash', './script.sh: line 12: foo: command not found', [{ path: './script.sh', line: 12, text: './script.sh: line 12' }]],
  ['make', "Makefile:12: recipe for target 'all' failed", [{ path: 'Makefile', line: 12, text: 'Makefile:12' }]],
  ['grep with line 0', 'src/a.c:0:int main(void)', [{ path: 'src/a.c', line: 0, text: 'src/a.c:0' }]],
  ['grep -n', 'src/a.c:12:    return 0;', [{ path: 'src/a.c', line: 12, text: 'src/a.c:12' }]],

  // C, C++, C#, Java, Kotlin, Dart, Swift
  ['gcc', 'a.c:12:3: error: expected ; before }', [{ path: 'a.c', line: 12, col: 3, text: 'a.c:12:3' }]],
  ['msvc with a drive letter', "C:\\proj\\a.cpp(12): error C2065: 'x': undeclared", [{ path: 'C:\\proj\\a.cpp', line: 12, text: 'C:\\proj\\a.cpp(12)' }]],
  ['java stack trace', '\tat com.foo.Bar.main(Bar.java:12)', [{ path: 'Bar.java', line: 12, text: 'Bar.java:12' }]],
  ['maven', '[ERROR] /home/u/A.java:[12,5] cannot find symbol', [{ path: '/home/u/A.java', line: 12, col: 5, text: '/home/u/A.java:[12,5]' }]],
  ['kotlin with a file url', 'e: file:///home/u/A.kt:12:5 Unresolved reference: x', [{ path: '/home/u/A.kt', line: 12, col: 5, text: '/home/u/A.kt:12:5' }]],
  ['dart package', 'package:foo/bar.dart:12:3', [{ path: 'package:foo/bar.dart', line: 12, col: 3, text: 'package:foo/bar.dart:12:3' }]],

  // JavaScript and TypeScript
  ['node stack trace', '    at Object.<anonymous> (/home/u/app.js:10:15)', [{ path: '/home/u/app.js', line: 10, col: 15, text: '/home/u/app.js:10:15' }]],
  ['node stack trace without parentheses', '    at /home/u/app.js:10:15', [{ path: '/home/u/app.js', line: 10, col: 15, text: '/home/u/app.js:10:15' }]],
  ['node esm file url', '    at file:///home/u/app.mjs:3:9', [{ path: '/home/u/app.mjs', line: 3, col: 9, text: '/home/u/app.mjs:3:9' }]],
  ['typescript', "src/a.ts(12,3): error TS2322: Type 'x' is not assignable", [{ path: 'src/a.ts', line: 12, col: 3, text: 'src/a.ts(12,3)' }]],
  ['typescript pretty', 'src/a.ts:12:3 - error TS2322: x', [{ path: 'src/a.ts', line: 12, col: 3, text: 'src/a.ts:12:3' }]],
  ['eslint stylish: the file name line', '/home/u/proj/src/a.js', [{ path: '/home/u/proj/src/a.js', text: '/home/u/proj/src/a.js' }]],
  ['eslint stylish: the problem line is no link', '  12:5  error  Unexpected console statement  no-console', []],
  ['eslint compact', '/home/u/a.js: line 12, col 5, Error - msg (no-console)', [{ path: '/home/u/a.js', line: 12, col: 5, text: '/home/u/a.js: line 12, col 5' }]],
  ['jest', '      at Object.<anonymous> (src/a.test.ts:12:5)', [{ path: 'src/a.test.ts', line: 12, col: 5, text: 'src/a.test.ts:12:5' }]],

  // Layout around the path
  ['box-drawing prefix', ' │ ├── src/main.rs:4:5', [{ path: 'src/main.rs', line: 4, col: 5, text: 'src/main.rs:4:5' }]],
  ['box-drawing glued to the path', '│src/a.go:7', [{ path: 'src/a.go', line: 7, text: 'src/a.go:7' }]],
  ['tree listing', '├── src/lib/util.ts', [{ path: 'src/lib/util.ts', text: 'src/lib/util.ts' }]],
  ['quoted name with spaces', 'error in "my dir/my file.txt", line 3', [{ path: 'my dir/my file.txt', line: 3, text: 'my dir/my file.txt", line 3' }]],
  ['single-quoted name with spaces and a colon suffix', "see 'my file.txt':12 now", [{ path: 'my file.txt', line: 12, text: "my file.txt':12" }]],
  ['a trailing period after the line', 'see src/a.go:12.', [{ path: 'src/a.go', line: 12, text: 'src/a.go:12' }]],
  ['a trailing period after a bare path', 'open ./notes/todo.txt.', [{ path: './notes/todo.txt', text: './notes/todo.txt' }]],
  ['a trailing comma after a bare path', 'see ./a/b.txt, then', [{ path: './a/b.txt', text: './a/b.txt' }]],
  ['a path in brackets', '[src/a.go:12]', [{ path: 'src/a.go', line: 12, text: 'src/a.go:12' }]],
  ['a path in parentheses', '(src/a.go:12:3)', [{ path: 'src/a.go', line: 12, col: 3, text: 'src/a.go:12:3' }]],
  ['a path with brackets in it', 'app/[id]/page.tsx:3', [{ path: 'app/[id]/page.tsx', line: 3, text: 'app/[id]/page.tsx:3' }]],
  ['a path with parentheses in it', 'app/(group)/page.tsx:3', [{ path: 'app/(group)/page.tsx', line: 3, text: 'app/(group)/page.tsx:3' }]],
  ['home and parent directories', 'in ~/x.jl:12 and ../lib/y.rs:3:1', [
    { path: '~/x.jl', line: 12, text: '~/x.jl:12' },
    { path: '../lib/y.rs', line: 3, col: 1, text: '../lib/y.rs:3:1' },
  ]],
  ['two links on a line', 'a.go:1: see b.go:2', [
    { path: 'a.go', line: 1, text: 'a.go:1' },
    { path: 'b.go', line: 2, text: 'b.go:2' },
  ]],
  ['a unix path with no line', 'cannot open /etc/hosts: permission denied', [{ path: '/etc/hosts', text: '/etc/hosts' }]],

  // Text that is not a file
  ['a clock time', '12:30:45 started', []],
  ['an address with a port', 'listening on 127.0.0.1:8080', []],
  ['a fraction', 'done 1/2:3', []],
  ['a comment marker', '// TODO fix', []],
  ['plain prose', 'the quick brown fox 12 jumps', []],
  ['a word and a number', 'version 12', []],
  ['a url with a line-looking tail', 'see https://example.com/a.go:12 now', []],
];

describe('the formats of real tools', () => {
  it('has at least twenty distinct rows', () => {
    expect(new Set(FORMATS.map(([label]) => label)).size).toBeGreaterThanOrEqual(20);
    expect(FORMATS.filter(([, , expected]) => expected.length > 0).length).toBeGreaterThanOrEqual(20);
  });

  it.each(FORMATS)('%s', (_label, line, expected) => {
    expect(found(line)).toEqual(expected);
  });
});

describe('git diff prefixes', () => {
  it('strips a/ and b/ from the file lines of a diff and says what it stripped', () => {
    const minus = '--- a/src/a.go';
    const plus = '+++ b/src/a.go';
    expect(findFileLinks(minus).map((c) => [c.path, c.diffPrefix, minus.slice(c.start, c.end)])).toEqual([['src/a.go', 'a/', 'src/a.go']]);
    expect(findFileLinks(plus).map((c) => [c.path, c.diffPrefix, plus.slice(c.start, c.end)])).toEqual([['src/a.go', 'b/', 'src/a.go']]);
  });

  it('strips both names of a diff --git line', () => {
    const line = 'diff --git a/src/a.go b/src/a.go';
    expect(findFileLinks(line).map((c) => [c.path, c.diffPrefix])).toEqual([
      ['src/a.go', 'a/'],
      ['src/a.go', 'b/'],
    ]);
  });

  it('keeps a/ and b/ anywhere else: a directory named a is a directory', () => {
    expect(found('see a/x.go:3')).toEqual([{ path: 'a/x.go', line: 3, text: 'a/x.go:3' }]);
    expect(found('--- a/src/a.go')[0]?.path).toBe('src/a.go');
    expect(findFileLinks('see b/src/a.go')[0]?.diffPrefix).toBeUndefined();
  });

  it('does not strip a prefix that the line has no diff header for', () => {
    expect(found('cat b/src/a.go')).toEqual([{ path: 'b/src/a.go', text: 'b/src/a.go' }]);
  });
});

describe('urls', () => {
  it.each([
    'https://example.com/a/b.go:12',
    'see http://example.com/a.go:12:5 now',
    'x=http://a/b.go:3',
    'HTTPS://EXAMPLE.COM/A.GO:12',
    '(https://example.com/a.go:12)',
    '"https://example.com/a.go", line 12',
    'ssh://git@host/repo/a.go:12',
    'ftp://host/dir/a.go',
    'git+https://example.com/x/a.go:3',
    'http://localhost:3000/path/a.go',
  ])('never takes a candidate inside a url: %s', (line) => {
    expect(found(line)).toEqual([]);
  });

  it('takes a path that only looks like a host, a directory named like a domain', () => {
    expect(found('example.com/pkg/a.go:12')).toEqual([{ path: 'example.com/pkg/a.go', line: 12, text: 'example.com/pkg/a.go:12' }]);
  });

  it('takes a directory named like a scheme when it has no double slash', () => {
    expect(found('./https:/dir/a.go:3')).toEqual([{ path: './https:/dir/a.go', line: 3, text: './https:/dir/a.go:3' }]);
  });

  it('takes a link that comes before a url on the same line, and none after it', () => {
    expect(found('a.go:3 https://example.com/b.go:4')).toEqual([{ path: 'a.go', line: 3, text: 'a.go:3' }]);
  });

  it('refuses a file url with a host: it names no local path', () => {
    expect(found('file://host/etc/a.go:3')).toEqual([]);
  });
});

describe('the caps of the issue', () => {
  it('gives no file link on a line over 2,000 characters, and gives links at exactly 2,000', () => {
    const link = 'src/a.go:1';
    const at2000 = `${link}${' '.repeat(2000 - link.length)}`;
    const at2001 = `${at2000} `;
    expect(at2000).toHaveLength(2000);
    expect(found(at2000)).toHaveLength(1);
    expect(found(at2001)).toEqual([]);
  });

  it('gives at most 10 links on a line, the first 10', () => {
    const line = Array.from({ length: 15 }, (_, i) => `f${i}.go:${i + 1}`).join(' ');
    const got = found(line);
    expect(got).toHaveLength(10);
    expect(got.map((l) => l.path)).toEqual(Array.from({ length: 10 }, (_, i) => `f${i}.go`));
  });

  it('gives at most 10 links when the links are bare paths too', () => {
    const line = Array.from({ length: 15 }, (_, i) => `d${i}/f.go`).join(' ');
    expect(found(line)).toHaveLength(10);
  });

  it('gives at most 10 links when they are quoted names with spaces', () => {
    const line = Array.from({ length: 15 }, (_, i) => `"my f${i}.txt", line 3`).join(' ');
    expect(found(line)).toHaveLength(10);
  });

  it('ignores a link over 500 characters and takes one of 500', () => {
    const body = (n: number) => `${'d/'.repeat((n - ':1'.length) / 2)}`;
    const at500 = `${body(500)}:1`;
    const at502 = `${body(502)}:1`;
    expect(at500).toHaveLength(500);
    expect(found(at500)).toHaveLength(1);
    expect(found(at502)).toEqual([]);
  });

  it('never gives a path over 1,024 characters, even when the link cap is lifted', () => {
    const limits = { maxLinkLength: 100_000 };
    const path = (n: number) => `${'d/'.repeat(n / 2)}`;
    expect(found(`${path(1024)}:1`, { limits })).toHaveLength(1);
    expect(found(`${path(1026)}:1`, { limits })).toEqual([]);
  });

  it('keeps the caps in one table that the matcher reads', () => {
    expect(FILE_LINK_LIMITS).toEqual({ maxLineLength: 2000, maxLinks: 10, maxPathLength: 1024, maxLinkLength: 500 });
  });

  it('lets a caller lower a cap', () => {
    expect(found('a.go:1 b.go:2 c.go:3', { limits: { maxLinks: 2 } })).toHaveLength(2);
  });
});

describe('lines a hostile program can print', () => {
  it('never puts an ESC in a path, and starts the next path after it', () => {
    const line = 'x\u001b/etc/passwd:1';
    const got = findFileLinks(line);
    expect(got.map((c) => c.path)).toEqual(['/etc/passwd']);
    expect(got[0]?.start).toBe(2);
  });

  it('never joins the two halves of a path that a newline cut', () => {
    const got = findFileLinks('src/a\n.go:12').map((c) => c.path);
    expect(got.some((p) => p.includes('\n'))).toBe(false);
    expect(got).not.toContain('src/a.go');
    expect(got).not.toContain('src/a\n.go');
  });

  it.each(['\u0000', '\u0007', '\u001b', '\n', '\r', '\t', '\u007f', '\u0085', '\u009b', '\u2028', '\u202e', '\u200b', '\ufeff'])('never has the control or format character U+%s in a path', (ch) => {
    const line = `a${ch}b/c.go:1 d/e${ch}f.go:2 ${ch}g/h.go:3${ch}`;
    for (const c of findFileLinks(line)) {
      expect(c.path).not.toContain(ch);
      expect(line.slice(c.start, c.end)).not.toContain(ch);
    }
  });

  it('gives nothing for a 100 KB path: the line cap, and with it lifted the path and link caps', () => {
    const path = `${'a/'.repeat(50_000)}:1`;
    expect(path.length).toBeGreaterThan(100_000);
    expect(found(path)).toEqual([]);
    expect(found(path, { limits: { maxLineLength: Number.MAX_SAFE_INTEGER } })).toEqual([]);
    expect(found(path, { limits: { maxLineLength: Number.MAX_SAFE_INTEGER, maxLinkLength: Number.MAX_SAFE_INTEGER } })).toEqual([]);
  });

  it('gives nothing for a quoted name of 100 KB with spaces', () => {
    const line = `"${'a b/'.repeat(25_000)}", line 1`;
    expect(found(line, { limits: { maxLineLength: Number.MAX_SAFE_INTEGER } })).toEqual([]);
  });

  it('gives no path with a number too long to be a line', () => {
    expect(found('a.go:12345678901234567890')).toEqual([]);
  });

  it('keeps unicode as it is: no normalisation of the path', () => {
    const nfd = 'e\u0301/a.go:1';
    const nfc = '\u00e9/a.go:1';
    expect(found(nfd)[0]?.path).toBe('e\u0301/a.go');
    expect(found(nfc)[0]?.path).toBe('\u00e9/a.go');
  });

  it('takes paths with non-latin letters', () => {
    expect(found('日本語/ファイル.go:12:3')).toEqual([{ path: '日本語/ファイル.go', line: 12, col: 3, text: '日本語/ファイル.go:12:3' }]);
    expect(found('ünï/çödé.py:7')).toEqual([{ path: 'ünï/çödé.py', line: 7, text: 'ünï/çödé.py:7' }]);
  });

  it('never takes a path that a bidirectional override reorders', () => {
    const line = 'src/\u202egpj.exe:1';
    for (const c of findFileLinks(line)) {
      expect(c.path).not.toContain('\u202e');
    }
  });

  it('gives candidates in order of position, with no overlap', () => {
    const line = 'a.go:1 "x y.txt", line 2 ./b/c.go (4) d/e.go:5:6 and f.go line 7';
    const got = findFileLinks(line);
    expect(got.length).toBeGreaterThan(3);
    for (let i = 1; i < got.length; i += 1) {
      expect(got[i].start).toBeGreaterThanOrEqual(got[i - 1].end);
    }
  });

  it('survives an empty line, spaces and lone suffix characters', () => {
    for (const line of ['', ' ', ':', '::', ':1', '#', '#L1', '(1)', '[1,2]', ', 1', '"', '""', "''", '"",1', ' line 1', 'a:', 'a#', 'a(', 'a(1', 'a(1,', 'a[1,2', '/', '//', '.']) {
      expect(() => findFileLinks(line)).not.toThrow();
    }
    expect(found('')).toEqual([]);
    expect(found(':1')).toEqual([]);
    expect(found('(1)')).toEqual([]);
  });
});

describe('the range of a candidate, in the emulator\'s cells', () => {
  it('is a range of UTF-16 offsets into the text and, beside it, of cells counted from 0 with the end excluded', () => {
    const line = 'see src/a.go:12:3 now';
    const [c] = findFileLinks(line);
    expect([c?.start, c?.end, c?.startCell, c?.endCell]).toEqual([4, 17, 4, 17]);
  });

  it('counts a wide character as two cells', () => {
    const line = '名前: 日本語/a.go:1';
    const [c] = findFileLinks(line);
    expect(line.slice(c?.start, c?.end)).toBe('日本語/a.go:1');
    expect(c?.start).toBe(4);
    expect(c?.startCell).toBe(6);
    expect(c?.endCell).toBe(6 + 6 + '/a.go:1'.length);
  });

  it('counts a character of two UTF-16 units as two cells when it is wide, and one unit per cell otherwise', () => {
    const line = '🎉 a.go:1';
    const [c] = findFileLinks(line);
    expect([c?.start, c?.startCell]).toEqual([3, 3]);
    expect(c?.endCell).toBe(3 + 'a.go:1'.length);
    const narrow = '𝒜 a.go:1';
    const [n] = findFileLinks(narrow);
    expect([n?.start, n?.startCell]).toEqual([3, 2]);
  });

  it('counts a combining mark as no cell', () => {
    const line = 'e\u0301.go:1';
    const [c] = findFileLinks(line);
    expect([c?.start, c?.end, c?.startCell, c?.endCell]).toEqual([0, 7, 0, 6]);
  });

  it('counts the cells of a later link after wide text before it', () => {
    const line = '日 日 a.go:1';
    const [c] = findFileLinks(line);
    expect(c?.startCell).toBe(2 + 1 + 2 + 1);
  });

  it('takes the width of a character from the caller when it gives one', () => {
    const line = 'ab c.go:1';
    const [c] = findFileLinks(line, { cellWidth: () => 2 });
    expect([c?.start, c?.startCell, c?.endCell]).toEqual([3, 6, 6 + 'c.go:1'.length * 2]);
  });

  it('has widths that agree with the terminal on the common cases', () => {
    expect([cellWidth(0x61), cellWidth(0x65e5), cellWidth(0x3042), cellWidth(0xac00), cellWidth(0x1f389), cellWidth(0x301), cellWidth(0x200b), cellWidth(0xff21), cellWidth(0x1d49c)]).toEqual([1, 2, 2, 2, 2, 0, 0, 2, 1]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// No backtracking: a count of steps, not milliseconds. The matcher calls `onStep` once for every character it looks at; the callback here throws when the count passes a budget, so a quadratic scan ends at the budget and
// does not wait for the machine.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Steps allowed for each character of the line. The matcher takes about 4 to 8 (`status/T7-matcher.md` has the measured figures); the bound leaves room and still fails a scan that grows with the square. */
const STEPS_PER_CHAR = 24;

function counter(budget: number) {
  let steps = 0;
  return {
    onStep: () => {
      steps += 1;
      if (steps > budget) {
        throw new Error(`the matcher passed its budget of ${budget} steps`);
      }
    },
    steps: () => steps,
  };
}

/** A deterministic generator (mulberry32), so a failure names its seed. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function text(seed: number, alphabet: readonly string[], length: number): string {
  const next = random(seed);
  let out = '';
  while (out.length < length) {
    out += alphabet[Math.floor(next() * alphabet.length)];
  }
  return out.slice(0, length);
}

describe('no backtracking: steps in proportion to the length', () => {
  it('takes no steps on a 1 MB line of dots and colons under the default cap, and gives nothing', () => {
    const line = '.:'.repeat(500_000);
    const c = counter(10);
    expect(findFileLinks(line, { onStep: c.onStep })).toEqual([]);
    expect(c.steps()).toBeLessThanOrEqual(10);
  });

  it('takes steps in proportion to the length on a 1 MB line of dots and colons with every cap lifted', () => {
    const line = '.:'.repeat(500_000);
    expect(line.length).toBe(1_000_000);
    const c = counter(STEPS_PER_CHAR * line.length);
    expect(findFileLinks(line, { limits: UNCAPPED, onStep: c.onStep })).toEqual([]);
    expect(c.steps()).toBeGreaterThan(line.length / 2);
  });

  it('takes the same steps for each character at 100 KB and at 1 MB: ten times the text, no more than eleven times the steps', () => {
    const small = '.:'.repeat(50_000);
    const large = '.:'.repeat(500_000);
    const a = counter(STEPS_PER_CHAR * small.length);
    const b = counter(STEPS_PER_CHAR * large.length);
    findFileLinks(small, { limits: UNCAPPED, onStep: a.onStep });
    findFileLinks(large, { limits: UNCAPPED, onStep: b.onStep });
    expect(a.steps()).toBeGreaterThan(0);
    expect(b.steps()).toBeLessThanOrEqual(11 * a.steps());
  });

  it.each([
    ['1 MB of dots', '.'.repeat(1_000_000)],
    ['1 MB of colons', ':'.repeat(1_000_000)],
    ['1 MB of slashes and colons', '/:'.repeat(500_000)],
    ['1 MB of a-colon-one with no cap on the links', 'a:1'.repeat(333_333)],
    ['1 MB of a-colon-one-space with no cap on the links', 'a:1 '.repeat(250_000)],
    ['1 MB of open brackets', '('.repeat(1_000_000)],
    ['1 MB of a word and an open bracket', 'ab('.repeat(333_333)],
    ['1 MB of quotes', '"'.repeat(1_000_000)],
    ['1 MB of alternating quotes', '"\''.repeat(500_000)],
    ['1 MB of a quote, a word and a space', '"a '.repeat(333_333)],
    ['1 MB of a word and a number with a space', 'a.b 1 '.repeat(166_666)],
    ['1 MB of line words', 'a.b line 1 '.repeat(90_909)],
    ['1 MB of digits', '1'.repeat(1_000_000)],
    ['1 MB of a colon and a long number', 'a:1111111111'.repeat(83_333)],
    ['1 MB of hashes', '#L1'.repeat(333_333)],
    ['1 MB of a URL scheme', 'ab://'.repeat(200_000)],
    ['1 MB of file schemes', 'file:///'.repeat(125_000)],
    ['1 MB of quoted spaces', '"a b", line 1 '.repeat(71_428)],
  ])('takes steps in proportion to the length on %s', (_label, line) => {
    const c = counter(STEPS_PER_CHAR * line.length);
    expect(() => findFileLinks(line, { limits: UNCAPPED, onStep: c.onStep })).not.toThrow();
    expect(c.steps(), 'a stub that looks at nothing cannot pass').toBeGreaterThanOrEqual(line.length / 2);
  });

  it.each([
    ['dots, colons, slashes, spaces and digits', ['.', ':', '/', ' ', '1', '2', 'a']],
    ['brackets, quotes and commas', ['(', ')', '[', ']', '"', "'", ',', ' ', 'a', '1', ':']],
    ['suffix words', ['line ', 'col ', ' on ', ' line ', 'column ', 'characters ', 'lines ', '1', '-', '#L', ':']],
    ['schemes and paths', ['file://', 'http://', '://', 'a/', 'b.c', ':', ' ', '"', '1']],
    ['controls and widths', ['\u001b', '\n', '\t', '\u00a0', '日', '🎉', '\u0301', 'a', '.', ':', '1', '/']],
    ['every special character', ['.', ':', ';', '/', '\\', ' ', '"', "'", '`', '(', ')', '[', ']', '{', '}', '<', '>', '|', ',', '#', '-', '=', '?', '!', '&', '*', '0', 'a', 'L']],
  ])('takes steps in proportion to the length on random text of %s', (_label, alphabet) => {
    for (const seed of [1, 2, 3]) {
      const line = text(seed, alphabet, 300_000);
      const c = counter(STEPS_PER_CHAR * line.length);
      expect(() => findFileLinks(line, { limits: UNCAPPED, onStep: c.onStep }), `seed ${seed}`).not.toThrow();
      expect(c.steps(), `seed ${seed}: a stub that looks at nothing cannot pass`).toBeGreaterThanOrEqual(line.length / 2);
    }
  });

  it('takes steps in proportion to the length on a line of the cap, for lines of every alphabet', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const line = text(seed, ['.', ':', '/', ' ', '1', 'a', '(', ')', '"', 'line ', '#L', '['], 2000);
      const c = counter(STEPS_PER_CHAR * line.length);
      expect(() => findFileLinks(line, { onStep: c.onStep }), `seed ${seed}`).not.toThrow();
      expect(c.steps(), `seed ${seed}: a stub that looks at nothing cannot pass`).toBeGreaterThanOrEqual(line.length / 2);
    }
  });
});
