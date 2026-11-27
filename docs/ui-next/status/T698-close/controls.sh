#!/usr/bin/env bash
# Negative controls of #698 items 2, 7 and 8 (AGENTS 28): for each, a faulty copy of one file run with
# `go test -overlay` (the worktree is never touched) must trip the assertion the control is named for, and the
# same fault must pass undetected when that assertion is removed (a second overlay of the test file).
# Run from anywhere in the worktree: docs/ui-next/status/T698-close/controls.sh. Exit 0 only when all
# controls (baseline, tripped, undetected-without-the-assertion) behave as stated.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
root=$PWD
if [ -d "$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.4.linux-amd64/bin" ]; then
  export PATH="$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.4.linux-amd64/bin:$PATH"
fi
export GOWORK=off GOTOOLCHAIN=local
pkg=./backend/pkg/terminal/
scratch=$(mktemp -d)
fail=0

overlay() { # overlay <name> <real file> <scratch file> [<real file> <scratch file>]...
  local out="$scratch/$1.json"; shift
  python3 - "$out" "$@" <<'PY'
import json, sys
out, pairs = sys.argv[1], sys.argv[2:]
json.dump({"Replace": {pairs[i]: pairs[i + 1] for i in range(0, len(pairs), 2)}}, open(out, "w"))
PY
}

run() { # run <overlay json or -> <test regexp> [package] -> output in $scratch/last, status in $?
  local args=()
  [ "$1" != "-" ] && args=(-overlay="$1")
  go test -count=1 "${args[@]}" -run "$2" "${3:-$pkg}" >"$scratch/last" 2>&1
}

expect_pass() { # expect_pass <label> <overlay> <regexp> [package]
  if run "$2" "$3" "${4:-}"; then echo "ok    $1"; else echo "FAIL  $1 (expected pass)"; sed -n 1,25p "$scratch/last"; fail=1; fi
}

expect_trip() { # expect_trip <label> <overlay> <regexp> <assertion message that must be in the failure> [package]
  if run "$2" "$3" "${5:-}"; then echo "FAIL  $1 (expected the fault to be detected)"; fail=1; return; fi
  if grep -qF -- "$4" "$scratch/last"; then echo "ok    $1"; else echo "FAIL  $1 (failed, but not on: $4)"; sed -n 1,25p "$scratch/last"; fail=1; fi
}

mutate() { # mutate <src> <dst> <python expression on s>
  python3 - "$1" "$2" "$3" <<'PY'
import sys
src, dst, expr = sys.argv[1:]
s = open(src).read()
env = {"s": s}
exec(expr, env)
if env["s"] == s:
    sys.exit("mutation changed nothing: " + expr)
open(dst, "w").write(env["s"])
PY
  [ $? -eq 0 ] || { echo "FAIL  a mutation matched nothing: $3"; fail=1; }
}

mgr=$root/backend/pkg/terminal/manager.go
# vitest controls mutate the tracked file in place and put it back (the trap restores it, whatever happens).
restores=()
restore_all() { local pair i; for ((i = ${#restores[@]} - 1; i >= 0; i--)); do pair=${restores[i]}; [ -n "$pair" ] && cp "${pair%%|*}" "${pair##*|}"; done; rm -rf "$scratch"; }
trap restore_all EXIT

vt_run() { # vt_run <test file> -> output in $scratch/last
  pnpm exec vitest run "$1" >"$scratch/last" 2>&1
}

vt_reset() { local pair i; for ((i = ${#restores[@]} - 1; i >= 0; i--)); do pair=${restores[i]}; [ -n "$pair" ] && cp "${pair%%|*}" "${pair##*|}"; done; restores=(); }

# A pass is the second half of a control (the fault and the test with its assertion removed): the files go back after it.
vt_expect_pass() { if vt_run "$2"; then echo "ok    $1"; else echo "FAIL  $1 (expected pass)"; grep -E "×|AssertionError|Error:" "$scratch/last" | head -8; fail=1; fi; vt_reset; }

vt_expect_trip() { # vt_expect_trip <label> <test file> <assertion text in the failure>
  if vt_run "$2"; then echo "FAIL  $1 (expected the fault to be detected)"; fail=1; return; fi
  if grep -qF -- "$3" "$scratch/last"; then echo "ok    $1"; else echo "FAIL  $1 (failed, but not on: $3)"; grep -E "×|AssertionError|Error:" "$scratch/last" | head -8; fail=1; fi
}

vt_mutate() { # vt_mutate <file> <python expression on s>: keeps a copy, the trap puts it back
  local file=$1 copy="$scratch/vt.$RANDOM"
  cp "$file" "$copy"; restores+=("$copy|$file")
  python3 - "$file" "$2" <<'PY'
import sys
path, expr = sys.argv[1:]
s = open(path).read()
env = {"s": s}
exec(expr, env)
if env["s"] == s:
    sys.exit("mutation changed nothing: " + expr)
open(path, "w").write(env["s"])
PY
  [ $? -eq 0 ] || { echo "FAIL  a mutation matched nothing: $2"; fail=1; }
}

echo "== baseline"
expect_pass "baseline: the three items' tests pass on the tree" - 'TestACloseThatGaveUp|TestTheShellStartsInTheValidatedPath|TestAStartDirectoryThat|TestALateCredit'

echo "== item 2: CloseSession hides the timeout"
mutate "$mgr" "$scratch/m2.go" 's = s.replace("if m.awaitGone([]*session{s}) != nil {\n\t\treturn closeTimeoutError(sessionID, m.closeWait)\n\t}\n\treturn nil", "m.awaitGone([]*session{s})\n\treturn nil")'
overlay c2 "$mgr" "$scratch/m2.go"
expect_trip "item 2: a close that hides the timeout is detected by the typed-error assertion" "$scratch/c2.json" 'TestACloseThatGaveUp' "the session is not gone: the sink holds its last output"
t2=$root/backend/pkg/terminal/close_timeout_test.go
mutate "$t2" "$scratch/t2.go" 'import re; s = re.sub(r"\trequire\.Error\(t, err, \"the session is not gone[^\n]*\n\tproblem := appErr\(t, err\)\n\tassert\.Equal\(t, \"omniview:terminal/close-timeout\"[^\n]*\n\tassert\.Equal\(t, \"CLOSE_TIMEOUT\"[^\n]*\n\tassert\.Equal\(t, 504[^\n]*\n", "\t_ = err\n\t_, _ = assert.Equal, require.Error\n", s)'
overlay c2b "$mgr" "$scratch/m2.go" "$t2" "$scratch/t2.go"
expect_pass "item 2: the same fault passes undetected when the assertions on the answer are removed" "$scratch/c2b.json" 'TestACloseThatGaveUp'

echo "== item 7: startDirectory returns the cleaned path"
mutate "$mgr" "$scratch/m7.go" 's = s.replace("\treturn requested, nil\n}\n\n// launch starts", "\treturn filepath.Clean(requested), nil\n}\n\n// launch starts")'
overlay c7 "$mgr" "$scratch/m7.go"
expect_trip "item 7: a cleaned start directory is detected by the validated-path assertion" "$scratch/c7.json" 'TestTheShellStartsInTheValidatedPath' "the session says the path that was validated, unchanged"
t7=$root/backend/pkg/terminal/start_directory_test.go
mutate "$t7" "$scratch/t7.go" 'import re; s = re.sub(r"\tassert\.Equal\(t, requested, info\.Cwd[^\n]*\n", "", s); s = re.sub(r"\tassert\.Contains\(t, rec\.text[^\n]*\n\tassert\.NotContains\([^\n]*\n", "", s)'
overlay c7b "$mgr" "$scratch/m7.go" "$t7" "$scratch/t7.go"
expect_pass "item 7: the same fault passes undetected when the three assertions on the path are removed" "$scratch/c7b.json" 'TestTheShellStartsInTheValidatedPath'

echo "== item 8: the credit is looked up by id when it is reported"
mutate "$mgr" "$scratch/m8.go" 'a = s.index("type Credit struct"); b = s.index("// Busy says whether a program other"); s = s[:a] + "type Credit struct {\n\tm  *Manager\n\tid string\n}\n\nfunc (c Credit) Delivered(n int) {\n\tc.m.mu.RLock()\n\tsess := c.m.sessions[c.id]\n\tc.m.mu.RUnlock()\n\tif sess != nil && n > 0 {\n\t\tsess.flow.delivered(n)\n\t}\n}\n\nfunc (m *Manager) DeliveryCredit(sessionID string) Credit { return Credit{m: m, id: sessionID} }\n\n" + s[b:]'
overlay c8 "$mgr" "$scratch/m8.go"
expect_trip "item 8: a credit looked up by id is detected by the reused-id assertion" "$scratch/c8.json" 'TestALateCredit' "the late credit of the closed session reached the new one"
t8=$root/backend/pkg/terminal/delivery_credit_test.go
mutate "$t8" "$scratch/t8.go" 'import re; s = re.sub(r"\t\trequire\.Equal\(t, debt, owed[^\n]*\n", "\t\t_ = owed\n", s)'
overlay c8b "$mgr" "$scratch/m8.go" "$t8" "$scratch/t8.go"
expect_pass "item 8: the same fault passes undetected when the assertion is removed" "$scratch/c8b.json" 'TestALateCredit'

echo "== item 7: PWD of a path with a dot-dot is left for bash to clean"
env7=$root/backend/pkg/terminal/env.go
mutate "$env7" "$scratch/e7.go" 's = s.replace("\"PWD=\"+workingDirectory(dir),", "\"PWD=\"+dir,")'
overlay c7c "$env7" "$scratch/e7.go"
expect_trip "item 7: a PWD that is the validated path as given is detected by the bash assertions" "$scratch/c7c.json" 'TestEveryShellStarted' "pwd -P after cd ."
mutate "$root/backend/pkg/terminal/start_directory_test.go" "$scratch/t7c.go" 'import re; s = re.sub(r"\t\t\tassert\.Contains\(t, text, \"[abcd]-\"[^\n]*\n", "", s); s = s.replace("text := rec.waitFor(t, info.ID, \"end\")", "_, _ = data, rec.waitFor(t, info.ID, \"end\")")'
overlay c7d "$env7" "$scratch/e7.go" "$root/backend/pkg/terminal/start_directory_test.go" "$scratch/t7c.go"
expect_pass "item 7: the same fault passes undetected when the four assertions on where the shell is are removed" "$scratch/c7d.json" 'TestEveryShellStarted'

echo "== item 8 (exec): the sink never credits what the transport took"
ex=$root/backend/pkg/plugin/exec/terminal.go
mutate "$ex" "$scratch/x8.go" 's = s.replace("delivered: func() { credit.Delivered(len(data)) }", "delivered: func() { _ = credit }")'
overlay c8x "$ex" "$scratch/x8.go"
expect_trip "exec: a sink that never credits is detected by the finished-shell assertion" "$scratch/c8x.json" 'TestTheLocalSinkCredits' "the shell never finished: the sink did not credit what the transport took" ./backend/pkg/plugin/exec/
tx=$root/backend/pkg/plugin/exec/terminal_credit_test.go
mutate "$tx" "$scratch/tx.go" 'import re; s = re.sub(r"\trequire\.Eventually\(.*?\n\t\t\"the shell never finished[^\n]*\n", "\t_, _, _, _ = assert.Equal, require.Eventually, client, info\n", s, flags=re.S); s = re.sub(r"\tgot, _ := client\.received[^\n]*\n\tassert\.Equal[^\n]*\n\tassert\.Greater[^\n]*\n", "", s)'
sed -i 's|^\t"time"$||' "$scratch/tx.go"
overlay c8y "$ex" "$scratch/x8.go" "$tx" "$scratch/tx.go"
expect_pass "exec: the same fault passes undetected when the finished-shell assertions are removed" "$scratch/c8y.json" 'TestTheLocalSinkCredits' ./backend/pkg/plugin/exec/

echo "== item 2 (page): a close-timeout is a close that rejects"
ch=$root/ui-next/shell/panel/terminal/terminalChannel.ts
cht=$root/ui-next/shell/panel/terminal/terminalChannel.test.ts
vt_mutate "$ch" 's = s.replace("if (!isClosing(error)) {\n          throw error;\n        }", "throw error;")'
vt_expect_trip "page: a close that rejects on close-timeout is detected by the resolves assertion" "ui-next/shell/panel/terminal/terminalChannel.test.ts" "promise rejected"
vt_mutate "$cht" 's = s.replace("await expect(r.channels.close(\x27t1\x27)).resolves.toBeUndefined();", "await r.channels.close(\x27t1\x27).catch(() => undefined);")'
vt_expect_pass "page: the same fault passes undetected when the resolves assertion is removed" "ui-next/shell/panel/terminal/terminalChannel.test.ts"

echo "== item 2 (legacy drawer): a close-timeout is logged as an error"
pv=$root/ui/providers/BottomDrawer/provider.tsx
pvt=$root/ui/providers/BottomDrawer/__tests__/provider.test.tsx
vt_mutate "$pv" 's = s.replace("=> parseAppError(error).type === \x27omniview:terminal/close-timeout\x27", "=> false")'
vt_expect_trip "legacy: a drawer that logs the timeout is detected by the not-logged assertion" "ui/providers/BottomDrawer/__tests__/provider.test.tsx" "expected \"vi.fn()\" to not be called at all"
vt_mutate "$pvt" 'import re; s = re.sub(r"    expect\(log\.error\)\.not\.toHaveBeenCalled\(\);\n", "", s).replace("expect(log.error).toHaveBeenCalledTimes(1)", "expect(log.error).toHaveBeenCalled()")'
vt_expect_pass "legacy: the same fault passes undetected when the not-logged assertion is removed" "ui/providers/BottomDrawer/__tests__/provider.test.tsx"
vt_mutate "$pv" 's = s.replace("result.reason instanceof Error && !isClosing(result.reason)", "false")'
vt_expect_trip "legacy: a close of several tabs that reports no failure is detected by the one-failure assertion" "ui/providers/BottomDrawer/__tests__/provider.test.tsx" "expected \"vi.fn()\" to be called 1 times"
vt_mutate "$pvt" 'import re; s = re.sub(r"    await waitFor\(\(\) => \{\n      expect\(log\.error\)\.toHaveBeenCalledTimes\(1\);\n    \}\);\n    expect\(log\.error\)\.toHaveBeenCalledWith\(real[^\n]*\n", "    void real;\n", s)'
vt_expect_pass "legacy: the same fault passes undetected when the failure assertions are removed" "ui/providers/BottomDrawer/__tests__/provider.test.tsx"

[ $fail -eq 0 ] && echo "ALL CONTROLS BEHAVED" || echo "CONTROLS FAILED"
exit $fail
