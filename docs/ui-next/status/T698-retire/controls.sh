#!/usr/bin/env bash
# Negative controls of #698 item 1 (B-108, serial window retirement; AGENTS 28): for each, a faulty copy of
# window_realm.go run with `go test -overlay` (the worktree is never touched) must trip the assertion the control
# is named for, and the same fault must pass undetected when that assertion is removed (a second overlay of the
# test file). Run from anywhere in the worktree: docs/ui-next/status/T698-retire/controls.sh. Exit 0 only when
# all controls (baseline, tripped, undetected-without-the-assertion) behave as stated.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
root=$PWD
if [ -d "$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.4.linux-amd64/bin" ]; then
  export PATH="$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.4.linux-amd64/bin:$PATH"
fi
export GOWORK=off GOTOOLCHAIN=local
pkg=./backend/pkg/invocation/
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

realm=$root/backend/pkg/invocation/window_realm.go
test=$root/backend/pkg/invocation/window_realm_retire_test.go
ALL='TestSixPagesAreRetiredInTheTimeOfOneLadder|TestEverySubscriberHearsOfAClosingWindowWhileTheOthersStillWork|TestTheSourceOwnerOfEveryWindowIsRetiredBeforeItsSubscribersHear|TestAFailingRetirementDoesNotHideTheResultOfAnother|TestRetiringWindowsLeavesNoGoroutineBehind|TestEveryPanickingRetirementIsLoggedWithItsOwnStack|TestConcurrentlyWaitsForEveryCallNotJustAllButOne'

echo "== baseline"
expect_pass "baseline: the five retirement tests pass on the tree" - "$ALL"

# The shared wait of the tests: its failure and the length check that follows it are the one assertion "all began before any grace passed".
drop_began='import re; s = s.replace("t.Fatalf(\"%s: %d of %d began to retire while the first still held its grace; the rest wait for it\", what, len(seen), n)", "return seen"); s = re.sub(r"\n\t+require\.Len\(t, seen, (pages|subscribers)[^\n]*", "", s).replace("seen := gate.awaitEntered", "_ = gate.awaitEntered")'

echo "== the sweep retires the windows in line (the loop put back)"
mutate "$realm" "$scratch/m1.go" 's = s.replace("r.concurrently(len(gone), func(i int) { r.announce(gone[i].key, gone[i].scope) })", "for _, window := range gone {\n\t\tr.announce(window.key, window.scope)\n\t}")'
overlay c1 "$realm" "$scratch/m1.go"
expect_trip "serial sweep is detected by: all windows began before any grace passed" "$scratch/c1.json" 'TestSixPagesAreRetiredInTheTimeOfOneLadder' "began to retire while the first still held its grace"
mutate "$test" "$scratch/t1.go" "$drop_began"
overlay c1b "$realm" "$scratch/m1.go" "$test" "$scratch/t1.go"
expect_pass "serial sweep passes undetected when that assertion is removed" "$scratch/c1b.json" 'TestSixPagesAreRetiredInTheTimeOfOneLadder'

echo "== the announce tells the subscribers in line (the loop put back)"
mutate "$realm" "$scratch/m2.go" 's = s.replace("r.concurrently(len(subscribers), func(i int) { subscribers[i](key) })", "for _, fn := range subscribers {\n\t\tfn(key)\n\t}")'
overlay c2 "$realm" "$scratch/m2.go"
expect_trip "serial announce is detected by: all subscribers began before any grace passed" "$scratch/c2.json" 'TestEverySubscriberHearsOfAClosingWindowWhileTheOthersStillWork' "began to retire while the first still held its grace"
mutate "$test" "$scratch/t2.go" "$drop_began"
overlay c2b "$realm" "$scratch/m2.go" "$test" "$scratch/t2.go"
expect_pass "serial announce passes undetected when that assertion is removed" "$scratch/c2b.json" 'TestEverySubscriberHearsOfAClosingWindowWhileTheOthersStillWork'

echo "== the subscribers hear before the source owner is retired"
mutate "$realm" "$scratch/m3.go" 'a = s.index("\tif r.onRetire != nil {\n\t\tr.onRetire(scope.Principal().Owner())\n\t}\n"); blk = s[a:a + len("\tif r.onRetire != nil {\n\t\tr.onRetire(scope.Principal().Owner())\n\t}\n")]; s = s.replace(blk, ""); s = s.replace("\tr.concurrently(len(subscribers), func(i int) { subscribers[i](key) })\n}", "\tr.concurrently(len(subscribers), func(i int) { subscribers[i](key) })\n" + blk + "}")'
overlay c3 "$realm" "$scratch/m3.go"
expect_trip "subscribers before the owner are detected by the order assertion" "$scratch/c3.json" 'TestTheSourceOwnerOfEveryWindowIsRetiredBeforeItsSubscribersHear' "a subscriber heard of a window before the source owners were retired"
mutate "$test" "$scratch/t3.go" 'import re; s = re.sub(r"\trequire\.Zero\(t, early[^\n]*\n", "\t_ = early\n", s)'
overlay c3b "$realm" "$scratch/m3.go" "$test" "$scratch/t3.go"
expect_pass "subscribers before the owner pass undetected when the order assertion is removed" "$scratch/c3b.json" 'TestTheSourceOwnerOfEveryWindowIsRetiredBeforeItsSubscribersHear'

echo "== a failed retirement is swallowed"
mutate "$realm" "$scratch/m4.go" 's = s.replace("\tif failed {\n\t\tpanic(failure)\n\t}\n", "\tif failed {\n\t\t_ = failure\n\t}\n")'
overlay c4 "$realm" "$scratch/m4.go"
expect_trip "a swallowed failure is detected by: the failure reaches the sweep's caller" "$scratch/c4.json" 'TestAFailingRetirementDoesNotHideTheResultOfAnother' "the failure reaches the sweep's caller"
mutate "$test" "$scratch/t4.go" 'import re; s = re.sub(r"\trequire\.Equal\(t, \"window 3 failed to retire\", <-recovered[^\n]*\n", "\t<-recovered\n", s)'
overlay c4b "$realm" "$scratch/m4.go" "$test" "$scratch/t4.go"
expect_pass "a swallowed failure passes undetected when that assertion is removed" "$scratch/c4b.json" 'TestAFailingRetirementDoesNotHideTheResultOfAnother'

echo "== the sweep does not wait for the retirements"
mutate "$realm" "$scratch/m5.go" 's = s.replace("\tgroup.Wait()\n", "")'
overlay c5 "$realm" "$scratch/m5.go"
expect_trip "a sweep that does not wait is detected by: it returned while retirements still held their grace" "$scratch/c5.json" 'TestSixPagesAreRetiredInTheTimeOfOneLadder' "the sweep returned while retirements still held their grace"
mutate "$test" "$scratch/t5.go" 'import re; s = re.sub(r"\t\t\tselect \{\n\t\t\tcase <-done:\n\t\t\t\tt\.Fatal\(\"the sweep returned while[^\n]*\n\t\t\tdefault:\n\t\t\t\}\n", "", s)'
overlay c5b "$realm" "$scratch/m5.go" "$test" "$scratch/t5.go"
expect_pass "a sweep that does not wait passes undetected when that assertion is removed" "$scratch/c5b.json" 'TestSixPagesAreRetiredInTheTimeOfOneLadder'

echo "== concurrently waits for all but the last call"
mutate "$realm" "$scratch/m7.go" 's = s.replace("\t\tgroup.Add(1)\n\t\tgo func() {\n\t\t\tdefer group.Done()", "\t\tif i != n-1 {\n\t\t\tgroup.Add(1)\n\t\t}\n\t\tgo func() {\n\t\t\tif i != n-1 {\n\t\t\t\tdefer group.Done()\n\t\t\t}")'
overlay c7 "$realm" "$scratch/m7.go"
expect_trip "a wait that skips the last call is detected by the gate assertion" "$scratch/c7.json" 'TestConcurrentlyWaitsForEveryCallNotJustAllButOne' "still held its gate"
mutate "$test" "$scratch/t7.go" 'import re; s = re.sub(r"\t\tselect \{\n\t\tcase <-returned:\n\t\t\tt\.Fatalf\(\"concurrently returned while[^\n]*\n\t\tdefault:\n\t\t\}\n", "", s)'
overlay c7b "$realm" "$scratch/m7.go" "$test" "$scratch/t7.go"
expect_pass "that fault passes undetected when the gate assertion is removed" "$scratch/c7b.json" 'TestConcurrentlyWaitsForEveryCallNotJustAllButOne'

echo "== a panic is logged without its own stack (only the first is raised)"
mutate "$realm" "$scratch/m8.go" 's = s.replace("r.log.Errorw(context.Background(), retirementPanicMessage, \"panic\", fmt.Sprint(recovered), \"stack\", stack)", "_, _ = stack, fmt.Sprint(recovered)")'
overlay c8 "$realm" "$scratch/m8.go"
expect_trip "unlogged panics are detected by the both-logged assertion" "$scratch/c8.json" 'TestEveryPanickingRetirementIsLoggedWithItsOwnStack' "both panics are logged"
mutate "$test" "$scratch/t8.go" 'import re; s = re.sub(r"\trequire\.Len\(t, logged, 2[^\n]*\n", "", s); s = re.sub(r"\trequire\.Equal\(t, map\[string\]bool[^\n]*\n", "", s).replace("seen := map[string]bool{}", "seen := map[string]bool{}\n\t_ = seen")'
overlay c8b "$realm" "$scratch/m8.go" "$test" "$scratch/t8.go"
expect_pass "that fault passes undetected when the both-logged assertion is removed" "$scratch/c8b.json" 'TestEveryPanickingRetirementIsLoggedWithItsOwnStack'

echo "== a goroutine of the retirement is left behind"
mutate "$realm" "$scratch/m6.go" 's = s.replace("\tvar (\n\t\tgroup   sync.WaitGroup", "\tgo func() { <-make(chan struct{}) }()\n\tvar (\n\t\tgroup   sync.WaitGroup")'
overlay c6 "$realm" "$scratch/m6.go"
expect_trip "a leaked goroutine is detected by the goroutine count" "$scratch/c6.json" 'TestRetiringWindowsLeavesNoGoroutineBehind' "goroutines left behind by the retirements"
mutate "$test" "$scratch/t6.go" 's = s.replace("for runtime.NumGoroutine() > before {", "for false {")'
overlay c6b "$realm" "$scratch/m6.go" "$test" "$scratch/t6.go"
expect_pass "a leaked goroutine passes undetected when the count is removed" "$scratch/c6b.json" 'TestRetiringWindowsLeavesNoGoroutineBehind'

[ $fail -eq 0 ] && echo "ALL CONTROLS BEHAVED" || echo "CONTROLS FAILED"
exit $fail
