#!/usr/bin/env bash
# The negative controls of the terminal settings (#697 step 1), run whole: each plants ONE fault and must be seen by the assertion it is named for, and by no other.
#
#   ui-next/shell/probes/terminal-settings-controls.sh            from the repository root; exit 0 only when every control is seen
#
# Three kinds, one table each:
#   probe    the five faults of the page in a real browser (terminal-settings.mjs SETTINGS_CONTROLS): with the assertion it is named for it must be DETECTED, and with that assertion dropped (ASSERTION_OFF) NOT DETECTED (the
#            proof that it trips that assertion and no other). FIXTURE_DIST=<dir> reuses a build of the fixture (node ui-next/shell/probes/terminal-build.mjs <dir>), else one is made.
#   source   a fault planted in the SOURCE (a copy of the file is kept and put back, whatever happens): the named test must FAIL with it and the same test must PASS without it (the clean run is the first line of the table).
#   go       the same for the host's Go (a bound not enforced, a font family that takes a semicolon) and for the drift between the declaration and the UI's copy of it.
# A line says `ok` when the control was seen and `WRONG` when it was not.
set -u
cd "$(dirname "$0")/../../.."
export PATH="$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.4.linux-amd64/bin:$PATH" GOWORK=off GOTOOLCHAIN=local
wrong=0
backups=()

restore() {
  for pair in "${backups[@]:-}"; do
    [ -n "$pair" ] || continue
    cp "${pair#*=}" "${pair%%=*}"
  done
}
trap restore EXIT

say() { printf '%-34s %s\n' "$1" "$2"; }

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
probe settings-not-live settings.live
probe settings-recreate settings.live
probe settings-scrollback-lost settings.live
probe settings-font-unloaded-open settings.font-open
probe settings-font-unloaded-live settings.font-live

# ------------------------------------------------------------------------------------------------ source and go
# plant FILE SED-EXPRESSION: puts the fault in, and fails the control when the expression changed nothing.
plant() {
  local file="$1" expression="$2" copy
  copy="$(mktemp)"
  cp "$file" "$copy"
  backups+=("$file=$copy")
  sed -i "$expression" "$file"
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
  if ! plant "$file" "$expression"; then
    say "$name" "WRONG: the fault did not change $file (the expression matches nothing)"
    wrong=$((wrong + 1))
    unplant
    return
  fi
  if "$@" >/dev/null 2>&1; then
    say "$name" "WRONG: not detected"
    wrong=$((wrong + 1))
  else
    say "$name" "ok: clean passes, planted fails"
  fi
  unplant
}

vt() { npx vitest run "$@"; }
terminal=ui-next/shell/panel/terminal
control "page font not awaited" $terminal/screen.ts 's/if (wanted.fontFamily !== appliedFamily) {/if (false \&\& wanted.fontFamily !== appliedFamily) {/' vt $terminal/screen.test.ts -t "the person's settings"
control "page hidden change lost" $terminal/screen.ts 's/    if (lookWaits) {/    if (false \&\& lookWaits) {/' vt $terminal/screen.test.ts -t "the person's settings"
control "page applies what it was not told" $terminal/screen.ts 's/    if (now === appliedLook) {/    if (false) {/' vt $terminal/screen.test.ts -t "the person's settings"
control "page cursor not applied" $terminal/xtermEngine.ts '/terminal.options.cursorStyle = next.cursorStyle;/d' vt $terminal/xtermEngine.test.ts -t "the person's settings"
control "page reads the legacy blink" $terminal/preferences.ts "s/read('cursorBlinkNext')/read('cursorBlink')/" vt $terminal/preferences.test.ts
control "page bound not held" $terminal/preferences.ts 's/fontSize: { min: 6, max: 72 }/fontSize: { min: 6, max: 7200 }/' vt $terminal/preferences.test.ts
control "page font names not cleaned" $terminal/preferences.ts 's/ || !\/.*\.test(bare)//' vt $terminal/preferences.test.ts
control "go bound not enforced" internal/settings/terminal.go 's/number > float64(maximum)/false/' go test ./internal/settings/ -run TestTheTerminal
control "go font family takes a semicolon" internal/settings/terminal.go "s/r != '_' {/r != '_' \&\& r != ';' {/" go test ./internal/settings/ -run TestTheTerminal
control "go setting missing from the UI copy" ui-next/shell/settings/model/testing.ts "/setting('scrollback'/d" go test ./internal/settings/ -run TestTheUIsCopy

if [ $wrong -eq 0 ]; then
  echo "every control was seen"
else
  echo "$wrong control(s) NOT seen"
  exit 1
fi
