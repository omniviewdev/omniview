#!/usr/bin/env bash
# The negative controls of URLs and OSC 8 hyperlinks in the terminal (#696 step 1), run whole: each plants ONE fault and must be seen by the assertion it is named for, and by no other.
#
#   ui-next/shell/probes/terminal-urls-controls.sh            from the repository root; exit 0 only when every control is seen
#
# Two kinds, one table each:
#   probe    the faults of the page in a real browser (terminal-urls.mjs URLS_CONTROLS): with the assertion it is named for it must be DETECTED, and with that assertion dropped (ASSERTION_OFF) NOT DETECTED (the proof that it
#            trips that assertion and no other). FIXTURE_DIST=<dir> reuses a build of the fixture (node ui-next/shell/probes/terminal-build.mjs <dir>), else one is made.
#   source   a fault planted in the SOURCE (a copy of the file is kept and put back, whatever happens): the named test must FAIL with it and PASS without it (the clean run comes first): a scheme let through, the host's own server
#            let through, a target left out of the tooltip, a window opened for the click, an emulator that hands over a link of any scheme.
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
probe urls-target-hidden urls.target
probe urls-window-open urls.open
probe urls-text-opened urls.open
probe urls-file-allowed urls.refuse
probe urls-script-allowed urls.refuse
probe urls-own-allowed urls.refuse
probe urls-keys-text urls.keys
probe urls-tooltip-axe axe.urls

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
control "page lets file: through (scheme)" $terminal/links/links.ts 's#/^https?:\\/\\/\[^\\s\\p{Cc}\\\\\]+\$/iu#/^(https?|file):\\/\\/[^\\s\\p{Cc}\\\\]+$/iu#;s#return new URL(uri).hostname !== .*;#return true;#' vt $terminal/links $terminal/TerminalSessions.test.ts
control "page lets the host's own server through" $terminal/links/links.ts 's/  return bare(address.hostname) === bare(own.hostname) || isLoopback(address.hostname);/  return false;/' vt $terminal/links $terminal/TerminalSessions.test.ts
control "page leaves the target out of the tooltip" $terminal/links/useTerminalLinks.tsx '/<span className={styles.target}>{target}<\/span>/d' vt $terminal/links
control "page opens a window for the click" $terminal/TerminalSessions.ts 's/          await external(uri);/          window.open(uri);\n          await external(uri);/' vt $terminal/TerminalSessions.test.ts
control "emulator hands over any scheme" $terminal/xtermEngine.ts 's/allowNonHttpProtocols: false,/allowNonHttpProtocols: true,/' vt $terminal/xtermEngine.test.ts -t "the links of a real emulator"
control "emulator lists a script in Open link" $terminal/links/scan.ts 's#/\^https?:\\/\\/\[^\\s\\p{Cc}\\\\\]+\$/iu.test(uri)#true#' vt $terminal/xtermEngine.test.ts -t "the links in view"
control "menu names a link by anything but its target" $terminal/menu/terminalMenu.ts 's/        label: target,/        label: "link",/' vt $terminal/menu

if [ $wrong -eq 0 ]; then
  echo "every control was seen"
else
  echo "$wrong control(s) NOT seen"
  exit 1
fi
