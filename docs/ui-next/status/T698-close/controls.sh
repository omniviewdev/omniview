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
trap 'rm -rf "$scratch"' EXIT
fail=0

overlay() { # overlay <name> <real file> <scratch file> [<real file> <scratch file>]...
  local out="$scratch/$1.json"; shift
  python3 - "$out" "$@" <<'PY'
import json, sys
out, pairs = sys.argv[1], sys.argv[2:]
json.dump({"Replace": {pairs[i]: pairs[i + 1] for i in range(0, len(pairs), 2)}}, open(out, "w"))
PY
}

run() { # run <overlay json or -> <test regexp> -> output in $scratch/last, status in $?
  local args=()
  [ "$1" != "-" ] && args=(-overlay="$1")
  go test -count=1 "${args[@]}" -run "$2" "$pkg" >"$scratch/last" 2>&1
}

expect_pass() { # expect_pass <label> <overlay> <regexp>
  if run "$2" "$3"; then echo "ok    $1"; else echo "FAIL  $1 (expected pass)"; sed -n 1,25p "$scratch/last"; fail=1; fi
}

expect_trip() { # expect_trip <label> <overlay> <regexp> <assertion message that must be in the failure>
  if run "$2" "$3"; then echo "FAIL  $1 (expected the fault to be detected)"; fail=1; return; fi
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

[ $fail -eq 0 ] && echo "ALL CONTROLS BEHAVED" || echo "CONTROLS FAILED"
exit $fail
