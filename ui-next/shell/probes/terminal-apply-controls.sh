#!/usr/bin/env bash
# The negative controls of what the terminal settings do to a terminal that is open (#697 steps 2 and 3: the blink, the scrollback, Option as Meta, the bell), run whole: each plants ONE fault and must be seen by the assertion it is named for, and by no other.
#
#   ui-next/shell/probes/terminal-apply-controls.sh            from the repository root; exit 0 only when every control is seen
#
# Three kinds, one table each:
#   probe    the faults of the page in a real browser, both engines (terminal-apply.mjs APPLY_CONTROLS): with the assertion it is named for it must be DETECTED, and with that assertion dropped (ASSERTION_OFF) NOT DETECTED (the
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
probe apply-blink-unfocused apply.blink
probe apply-blink-off apply.blink
probe apply-scrollback-not-live apply.scrollback
probe apply-meta-not-live apply.meta-live
probe apply-meta-layout-wrong apply.meta-auto
probe apply-bell-mark-lost apply.bell-mark
probe apply-bell-mark-stuck apply.bell-mark
probe apply-bell-off-fades apply.bell-off
probe apply-bell-beeps apply.bell-silent

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
  local out
  if out="$("$@" 2>&1)"; then
    say "$name" "WRONG: not detected"
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
control "page blink ignores the focus" $terminal/xtermEngine.ts 's/const blink = wantsBlink \&\& hasFocus;/const blink = wantsBlink;/' vt $terminal/xtermEngine.test.ts -t "the behaviour of a real emulator"
control "page scrollback not applied" $terminal/xtermEngine.ts '/terminal.options.scrollback = behaviour.scrollback;/d' vt $terminal/xtermEngine.test.ts -t "the behaviour of a real emulator"
control "page Option not applied" $terminal/xtermEngine.ts '/terminal.options.macOptionIsMeta = behaviour.optionIsMeta;/d' vt $terminal/xtermEngine.test.ts -t "the behaviour of a real emulator"
control "page behaviour not told" $terminal/screen.ts 's/    if (behaviour !== appliedBehaviour) {/    if (false) {/' vt $terminal/screen.test.ts -t "the behaviour the person"
control "page layout asked for on and off" $terminal/screen.ts "s/if (setting !== 'auto' || deps.layout === undefined) {/if (deps.layout === undefined) {/" vt $terminal/screen.test.ts -t "the behaviour the person"
control "page unknown layout is Meta" $terminal/layout.ts "s/usLayout === true/usLayout !== false/" vt $terminal/layout.test.ts
control "page one US key is a US layout" $terminal/layout.ts "s/Object.entries(US_KEYS).every(/Object.entries(US_KEYS).some(/" vt $terminal/layout.test.ts
control "page layout refusal uncaught" $terminal/layout.ts 's/^  } catch {$/  } catch (error) {\n    throw error;/' vt $terminal/layout.test.ts
control "page bell off ignored" $terminal/screen.ts "s/if (preferences.getSnapshot().bell === 'off') {/if (false) {/" vt $terminal/screen.test.ts -t "the bell"
control "page bell fades a hidden screen" $terminal/screen.ts "s/        if (!visible) {\$/        if (false) {/" vt $terminal/screen.test.ts -t "the bell"
control "page bell mark told twice" $terminal/bells.ts "s/if (!marked.has(session)) {/if (true) {/" vt $terminal/bells.test.ts
control "page bell mark clear told for nothing" $terminal/bells.ts "s/if (marked.delete(session)) {/marked.delete(session);\n      if (true) {/" vt $terminal/bells.test.ts
control "page bell mark never cleared on show" $terminal/TerminalBody.tsx '/^  useEffect(() => {$/,/^  }, \[bells, session.id, visible\]);$/s/if (visible) {/if (false) {/' vt $terminal/terminals.test.ts -t "the bell of a terminal"
control "page bell mark not in the tab's name" ui-next/shell/panel/SessionTabs.tsx 's/aria-label={mark === undefined ? sessionName(item) : `${sessionName(item)}, ${mark.label}`}/aria-label={sessionName(item)}/' vt ui-next/shell/panel/SessionTabs.test.tsx -t "the mark a tool puts"
control "page bell mark drawn for every tab" ui-next/shell/panel/SessionTabs.tsx 's/{mark === undefined ? null : <span className={styles.sessionMark}/{false ? null : <span className={styles.sessionMark}/' vt ui-next/shell/panel/SessionTabs.test.tsx -t "the mark a tool puts"

if [ $wrong -eq 0 ]; then
  echo "every control was seen"
else
  echo "$wrong control(s) NOT seen"
  exit 1
fi
