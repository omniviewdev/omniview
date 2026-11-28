#!/usr/bin/env bash
# The negative controls of FILE LINKS in the terminal (#696 step 4), run whole: each plants ONE fault and must be seen by the assertion it is named for, and by no other.
#
#   ui-next/shell/probes/terminal-filelinks-controls.sh            from the repository root; exit 0 only when every control is seen
#
# Two kinds, one table each:
#   probe    the faults of the page in a real browser (terminal-filelinks.mjs FILELINKS_CONTROLS): with the assertion it is named for it must be DETECTED, and with that assertion dropped (ASSERTION_OFF) NOT DETECTED (the proof that it
#            trips that assertion and no other). FIXTURE_DIST=<dir> reuses a build of the fixture (node ui-next/shell/probes/terminal-build.mjs <dir>), else one is made.
#   source   a fault planted in the SOURCE (a copy of the file is kept and put back, whatever happens): the named test must FAIL with it and PASS without it (the clean run comes first): a link for a missing file, the wrong directory, no cap on
#            the candidates asked, a question for every line, no modifier, a link while a program holds the foreground.
# A line says `ok` when the control was seen and `WRONG` when it was not.
set -u
cd "$(dirname "$0")/../../.."
wrong=0
backups=()

restore() {
  for pair in "${backups[@]:-}"; do
    [ -n "$pair" ] || continue
    cp "${pair#*=}" "${pair%%=*}"
  done
}
trap restore EXIT

say() { printf '%-44s %s\n' "$1" "$2"; }

# ------------------------------------------------------------------------------------------------ probe
dist="${FIXTURE_DIST:-}"
if [ -z "$dist" ]; then
  dist="$(mktemp -d)"
  rmdir "$dist"
  OMNIVIEW_UI=next node ui-next/shell/probes/terminal-build.mjs "$dist" >/dev/null 2>&1 || { echo "the fixture did not build"; exit 1; }
fi
probe_env=(env -i PATH="$PATH" HOME="$HOME" LD_LIBRARY_PATH=/tmp/c-libs/ex/usr/lib/x86_64-linux-gnu OMNIVIEW_UI=next FONT_DELAY_MS=40 FIXTURE_DIST="$dist")
probe() { # name assertion
  local name="$1" assertion="$2" with without
  with="$("${probe_env[@]}" NEGATIVE_CONTROL="$name" node ui-next/shell/probes/terminal-probe.mjs 2>&1)"; local with_status=$?
  without="$("${probe_env[@]}" NEGATIVE_CONTROL="$name" ASSERTION_OFF="^${assertion//./\\.}$" node ui-next/shell/probes/terminal-probe.mjs 2>&1)"; local without_status=$?
  if [ $with_status -eq 0 ] && grep -q "detected by $assertion" <<<"$with" && [ $without_status -eq 1 ] && grep -q "NOT DETECTED" <<<"$without"; then
    say "probe $name" "ok: detected by $assertion; with it dropped, not detected"
  else
    say "probe $name" "WRONG: with=$with_status without=$without_status: $(grep -E 'NEGATIVE' <<<"$with$without" | head -2 | cut -c1-200 | tr '\n' ' ')"
    wrong=$((wrong + 1))
  fi
}
probe files-missing-link files.link
probe files-all-lines files.counts
probe files-no-cap files.counts
probe files-foreign-link files.foreign
probe files-wrong-directory files.directory
probe files-no-modifier files.modifier
probe files-clipboard-dropped files.click
probe files-tooltip-position-lost files.link
probe files-tooltip-axe axe.files

# ------------------------------------------------------------------------------------------------ source
# plant FILE SED-EXPRESSION...: puts the fault in, and fails the control when the expression changed nothing.
plant() {
  local file="$1" copy
  shift
  copy="$(mktemp)"
  cp "$file" "$copy"
  backups+=("$file=$copy")
  sed -i "$@" "$file"
  if cmp -s "$file" "$copy"; then
    return 1
  fi
}
unplant() { restore; backups=(); }

# control NAME FILE SED-EXPRESSION COMMAND...: clean must pass, planted must fail.
control() {
  local name="$1" file="$2" expression="$3"; shift 3
  if ! "$@" >/dev/null 2>&1; then
    say "$name" "WRONG: the clean run already fails, so the control proves nothing"
    wrong=$((wrong + 1))
    return
  fi
  if ! plant "$file" -e "$expression"; then
    say "$name" "WRONG: the fault did not change $file (the expression matches nothing)"
    wrong=$((wrong + 1))
    unplant
    return
  fi
  local out
  if out="$("$@" 2>&1)"; then
    say "$name" "ok?? not detected"
    wrong=$((wrong + 1))
  elif grep -qE '\[build failed\]|\[setup failed\]|Transform failed|Failed to parse|^SyntaxError|Unexpected token|declared and not used|imported and not used' <<<"$out"; then
    say "$name" "WRONG: the planted fault does not compile, so no test ran against it"
    wrong=$((wrong + 1))
  else
    say "$name" "ok: clean passes, planted fails"
  fi
  unplant
}

vt() { npx vitest run "$@"; }
terminal=ui-next/shell/panel/terminal
links=$terminal/links
control "page makes a link for a file that is not there" $links/useTerminalLinks.tsx "s/(answer.kind === 'file' || answer.kind === 'dir') \&\& answer.path !== undefined \&\& answer.path !== ''/true/" vt $links/useTerminalLinks.test.tsx
control "page names a directory of its own" $links/useTerminalLinks.tsx "s/where?.directoryAt?.(row) ?? ''/'\/guess'/" vt $links/useTerminalLinks.test.tsx
control "page asks while a program holds the foreground" $links/useTerminalLinks.tsx "s/(await feed.busy()).state !== 'idle'/false/" vt $links/useTerminalLinks.test.tsx
control "page has no cap on the candidates it asks about" $links/useTerminalLinks.tsx "s/texts.slice(0, MAX_ASKED)/texts/" vt $links/useTerminalLinks.test.tsx
control "page follows without the modifier" $links/useTerminalLinks.tsx "s/held: (event) => followsWith(event, latest.current.platform),/held: () => true,/" vt $links/useTerminalLinks.test.tsx
control "provider asks without the modifier" $links/fileProvider.ts "s/if (!held || current === undefined || waiting?.row === current) {/if (current === undefined || waiting?.row === current) {/;s/if (waiting === one \&\& held \&\& live) {/if (waiting === one \&\& live) {/" vt $terminal/xtermEngine.test.ts -t "file links of a real"
control "provider asks for every line in view" $links/fileProvider.ts "/    const one: Waiting = { row: current, timer: undefined };/a\\    for (let other = 0; other < terminal.rows; other += 1) void handler.resolve(other, ['x.go:1']);" vt $terminal/xtermEngine.test.ts -t "file links of a real"
control "provider holds back the web links" $links/fileProvider.ts '/^      callback(undefined);$/{N;s/callback(undefined);\n      schedule();/schedule();/}' vt $terminal/xtermEngine.test.ts -t "file links of a real"
control "provider does not settle" $links/fileProvider.ts "s/}, FILE_LINK_SETTLE_MS);/}, 0);/" vt $terminal/xtermEngine.test.ts -t "file links of a real"
control "provider reads a line without a bound" $links/cells.ts "s/if (up >= reach) {/if (false) {/" vt $terminal/xtermEngine.test.ts -t "file links of a real"
control "provider maps offsets as columns" $links/fileProvider.ts "s/return { start: { x: first.x + 1, y: first.row + 1 }/return { start: { x: candidate.start + 1, y: first.row + 1 }/" vt $terminal/xtermEngine.test.ts -t "file links of a real"
control "gutter names the shell's directory for every row" $terminal/gutter/commandGutter.ts "s/      return owner?.cwd;/      return entries.at(-1)?.cwd;/" vt $terminal/gutter/commandGutter.test.ts
control "feed accepts a file with no path" $terminal/execFeed.ts "s/(kind === 'file' || kind === 'dir') \&\& typeof path === 'string' \&\& path !== ''/kind === 'file'/" vt $terminal/execFeed.test.ts -t "what a candidate link names"

if [ $wrong -eq 0 ]; then
  echo "every control was seen"
else
  echo "$wrong control(s) NOT seen"
  exit 1
fi
