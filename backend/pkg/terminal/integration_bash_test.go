//go:build !windows

package terminal

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/terminal/marks"
)

// The tests of bash and pwsh (issue #694, step 3). A pwsh that is not installed is skipped by name ("NOT RUN").

func bashFixture(t *testing.T, profile string, env ...string) *integrationFixture {
	t.Helper()
	f := newIntegrationFixture(t, "bash", integrationShell(t, "bash"), env...)
	require.NoError(t, os.WriteFile(filepath.Join(f.home, ".bash_profile"), []byte("PS1='"+integrationPrompt+"'\nHISTFILE=/dev/null\n"+profile), 0o600))
	return f
}

func bashMajorMinor(t *testing.T) (int, int) {
	t.Helper()
	major, minor, err := probeBashVersion(integrationShell(t, "bash"))
	require.NoError(t, err)
	return major, minor
}

func TestBashIsStartedWithItsOwnRcfileAndWithoutTheLoginFlag(t *testing.T) {
	f, _, log := fakeFixture(t, "bash", "plain")
	f.m.bashVersion = func(string) (int, int, error) { return 5, 2, nil }
	info := f.start()
	assert.Equal(t, IntegrationOn, info.Integration.State)
	line := waitStarts(t, log, 1)[0]
	assert.Contains(t, line, "args=--rcfile ")
	assert.Contains(t, line, "-i", "interactive")
	assert.NotRegexp(t, `(^| )-l( |$)`, line, "bash ignores --rcfile under -l: the login is emulated by the script")
}

func TestBashBefore4_1IsSkippedAndStartedAsBefore(t *testing.T) {
	f, _, log := fakeFixture(t, "bash", "plain")
	f.m.bashVersion = func(string) (int, int, error) { return 3, 2, nil }
	info := f.start()
	assert.Equal(t, Integration{State: IntegrationSkipped, Reason: SkipBashTooOld}, info.Integration)
	line := waitStarts(t, log, 1)[0]
	assert.Contains(t, line, "args=-i -l", "the shell contract of T1-go 2.8: one start, -i -l")
	assert.Empty(t, f.integrationDirs())
	for _, v := range [][2]int{{4, 0}, {4, 1}} {
		f2, _, _ := fakeFixture(t, "bash", "plain")
		f2.m.bashVersion = func(string) (int, int, error) { return v[0], v[1], nil }
		want := IntegrationOn
		if v[1] == 0 {
			want = IntegrationSkipped
		}
		assert.Equal(t, want, f2.start().Integration.State, "bash %d.%d", v[0], v[1])
	}
}

func TestABashWhoseVersionCannotBeToldIsSkippedAndNotGuessed(t *testing.T) {
	f, _, _ := fakeFixture(t, "bash", "plain")
	f.m.bashVersion = func(string) (int, int, error) { return 0, 0, os.ErrNotExist }
	assert.Equal(t, Integration{State: IntegrationSkipped, Reason: SkipBashVersionUnknown}, f.start().Integration)
}

func TestTheRealBashProbeSaysItsVersion(t *testing.T) {
	major, minor := bashMajorMinor(t)
	assert.GreaterOrEqual(t, major, 3)
	assert.GreaterOrEqual(t, minor, 0)
	_, _, err := probeBashVersion(filepath.Join(t.TempDir(), "no-such-bash"))
	assert.Error(t, err)
}

// The login emulation runs the first of the user's login files, once, as a login shell would.
func TestTheLoginEmulationRunsTheFirstLoginFileOnceAndNoOtherOne(t *testing.T) {
	for name, files := range map[string][]string{
		"bash_profile wins": {".bash_profile", ".bash_login", ".profile"},
		"bash_login next":   {".bash_login", ".profile"},
		"profile last":      {".profile"},
	} {
		t.Run(name, func(t *testing.T) {
			f := newIntegrationFixture(t, "bash", integrationShell(t, "bash"))
			require.NoError(t, os.Remove(filepath.Join(f.home, ".bash_profile")))
			for _, file := range files {
				require.NoError(t, os.WriteFile(filepath.Join(f.home, file), []byte("echo "+file+" >> $HOME/ran\nPS1='"+integrationPrompt+"'\nHISTFILE=/dev/null\n"), 0o600))
			}
			info := f.started()
			require.Equal(t, IntegrationOn, info.Integration.State)
			assert.Equal(t, files[0]+"\n", f.fileOf("ran"), "one login file, once")
			assert.NotContains(t, f.fileOf("ran"), ".bashrc")
		})
	}
}

// A login file that sources ~/.bashrc, as most do, runs it once.
func TestTheBashrcThatTheLoginFileSourcesRunsOnce(t *testing.T) {
	f := bashFixture(t, "[ -r ~/.bashrc ] && . ~/.bashrc\n")
	require.NoError(t, os.WriteFile(filepath.Join(f.home, ".bashrc"), []byte("echo rc >> $HOME/ran\n"), 0o600))
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	assert.Equal(t, "rc\n", f.fileOf("ran"))
}

func TestAUserPromptCommandStillSeesTheStatusOfTheCommand(t *testing.T) {
	f := bashFixture(t, "PROMPT_COMMAND='echo \"$?\" >> $HOME/seen'\n")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "false")
	f.run(info.ID, "(exit 7)")
	f.run(info.ID, "true")
	assert.Equal(t, "0\n1\n7\n0\n", f.fileOf("seen"), "the user's PROMPT_COMMAND saw the status of each command")
	var codes []int32
	for _, r := range f.endedCommands(info.ID, 3) {
		codes = append(codes, r.ExitCode)
	}
	assert.Equal(t, []int32{1, 7, 0}, codes)
	f.run(info.ID, "echo $PROMPT_COMMAND > pc")
	assert.Contains(t, f.fileOf("pc"), "seen", "the user's PROMPT_COMMAND is still in place")
}

func TestAnArrayPromptCommandIsKeptAndSeesTheStatus(t *testing.T) {
	major, minor := bashMajorMinor(t)
	if major < 5 || (major == 5 && minor < 1) {
		t.Skip("NOT RUN: PROMPT_COMMAND is an array from bash 5.1")
	}
	f := bashFixture(t, "PROMPT_COMMAND=('echo \"$?\" >> $HOME/seen' 'echo second >> $HOME/seen')\n")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "false")
	assert.Equal(t, "0\nsecond\n1\nsecond\n", f.fileOf("seen"))
	assert.Equal(t, []int32{1}, []int32{f.endedCommands(info.ID, 1)[0].ExitCode})
}

// A preexec library of the user's (bash-preexec's form: a DEBUG trap that is given $_, and PROMPT_COMMAND) keeps working.
func TestAUsersDebugTrapAndPromptCommandKeepWorkingNextToTheScript(t *testing.T) {
	f := bashFixture(t, `__user_preexec() { echo "preexec[$1]" >> $HOME/hooks; }
trap '__user_preexec "$_"' DEBUG
PROMPT_COMMAND='echo precmd >> $HOME/hooks'
`)
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "echo hello")
	hooks := f.fileOf("hooks")
	assert.Contains(t, hooks, "precmd")
	assert.Contains(t, hooks, "preexec[", "the user's DEBUG trap still runs")
	ran := f.endedCommands(info.ID, 1)
	assert.Equal(t, "echo hello", ran[0].CommandLine)
	assert.Equal(t, marks.TrustNonce, ran[0].Trust)
}

// The line is read from the history, and the history does not always have it: the script never says a line that is not the one typed.
func TestAHistoryThatDoesNotHaveTheLineGivesNoLineAndNeverAWrongOne(t *testing.T) {
	f := bashFixture(t, "HISTCONTROL=ignoreboth\nHISTFILE=/dev/null\nHISTSIZE=100\n")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "echo first")
	f.run(info.ID, " echo hidden")
	f.run(info.ID, "echo first")
	f.run(info.ID, "echo first")
	ran := f.endedCommands(info.ID, 4)
	typed := []string{"echo first", "echo hidden", "echo first", "echo first"}
	for i, r := range ran {
		assert.Contains(t, []string{"", typed[i]}, r.CommandLine, "command %d: no line, or the line typed, never another", i)
	}
	assert.Equal(t, "echo first", ran[0].CommandLine, "a line the history has is trusted")
	assert.Equal(t, marks.TrustNonce, ran[0].Trust)
}

func TestTheScriptNeverClobbersBASHREMATCHOrTheStatus(t *testing.T) {
	f := bashFixture(t, "[[ abc =~ (b)(c) ]]\n")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "echo hello")
	f.run(info.ID, `echo "${BASH_REMATCH[1]}${BASH_REMATCH[2]}" > rematch`)
	assert.Equal(t, "bc\n", f.fileOf("rematch"), "the match of the user's own [[ =~ ]] survives the hooks")
}

func TestBashXtraceNeverPrintsTheNonceAndTheStatusesAreRight(t *testing.T) {
	f := bashFixture(t, "set -x\n")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "echo hello")
	f.run(info.ID, "false")
	f.run(info.ID, "(exit 7)")
	f.run(info.ID, "true")
	var codes []int32
	for _, r := range f.endedCommands(info.ID, 4) {
		codes = append(codes, r.ExitCode)
	}
	assert.Equal(t, []int32{0, 1, 7, 0}, codes)
	nonce := f.m.session(t, info.ID).nonce.Reveal()
	out := regexp.MustCompile("\x1b\\][^\a\x1b]*(\a|\x1b\\\\)").ReplaceAll(f.sink.output(info.ID), nil)
	assert.Contains(t, string(out), "+", "xtrace is on: the shell traces")
	assert.NotContains(t, string(out), nonce, "the nonce is in the trace outside the marks")
}

func TestBashClosesTheChannelBeforeAProgramOfTheUserRuns(t *testing.T) {
	f := bashFixture(t, "")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "ls -l /proc/self/fd > descriptors")
	assert.NotContains(t, f.fileOf("descriptors"), "socket:", "no socket reaches a program the user runs")
}

func TestABashLineWithControlBytesAndSeparatorsIsEscapedAndRecordedAsTyped(t *testing.T) {
	f := bashFixture(t, "")
	info := f.started()
	// Ctrl-V makes the tab a character of the line: a bare tab would complete.
	f.run(info.ID, `echo 'a;b\c'`+"\x16\t"+`# x`)
	ran := f.endedCommands(info.ID, 1)
	assert.Equal(t, `echo 'a;b\c'`+"\t"+`# x`, ran[0].CommandLine)
}

// ---- pwsh ----

func TestPwshIsStartedWithNoExitAndTheScriptAsItsCommand(t *testing.T) {
	f, _, log := fakeFixture(t, "pwsh", "plain")
	info := f.start()
	assert.Equal(t, IntegrationOn, info.Integration.State)
	line := waitStarts(t, log, 1)[0]
	for _, want := range []string{"-Login", "-NoLogo", "-NoExit", "-Command"} {
		assert.Contains(t, line, want)
	}
	assert.Contains(t, line, "integration.ps1")
}

func TestPwshStatusIsExitCodeOfANativeCommandAndOneForAFailedCmdlet(t *testing.T) {
	f := newIntegrationFixture(t, "pwsh", integrationShell(t, "pwsh"))
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "true")
	f.run(info.ID, "false")
	f.run(info.ID, "sh -c 'exit 7'")
	f.run(info.ID, "Get-Item /no/such/file-omniview")
	var codes []int32
	for _, r := range f.endedCommands(info.ID, 4) {
		codes = append(codes, r.ExitCode)
	}
	assert.Equal(t, []int32{0, 1, 7, 1}, codes)
}

// A hangup that arrives while the prompt commands run (bash runs them as a non-interactive shell, which does not hang up
// its jobs) still takes the background jobs with the shell, as the host's close promises (login_test.go).
func TestAHangupDuringThePromptCommandsStillHangsUpTheJobs(t *testing.T) {
	// The prompt command that follows the job's command stays 3 s when the test says so (a file), so that the hangup arrives
	// while the prompt commands run, and with `sleep` already running: not before it (that one has nothing to kill).
	f := bashFixture(t, "PROMPT_COMMAND='sleep 3 & echo $! >> $HOME/started; wait $!'\n")
	info := f.start()
	require.Equal(t, IntegrationOn, info.Integration.State)
	require.NoError(t, f.m.Write(info.ID, 0, []byte("sleep 587 & echo job-$!\r")))
	var job int
	require.Eventually(t, func() bool {
		found := regexp.MustCompile(`\njob-(\d+)`).FindSubmatch(f.sink.output(info.ID))
		if found == nil {
			return false
		}
		job, _ = strconv.Atoi(string(found[1]))
		return job > 0
	}, 20*time.Second, 10*time.Millisecond)
	t.Cleanup(func() { _ = syscall.Kill(job, syscall.SIGKILL) })
	// The first prompt command ran before the job's command was read, the second runs after it: wait until its sleep has been
	// started (its pid is in the file), and the shell is waiting for it.
	require.Eventually(t, func() bool {
		data, _ := os.ReadFile(filepath.Join(f.home, "started"))
		return strings.Count(string(data), "\n") >= 2
	}, 20*time.Second, 5*time.Millisecond)
	require.NoError(t, f.m.CloseSession(info.ID))
	require.Eventually(t, func() bool { return ended(job) }, 8*time.Second, 20*time.Millisecond, "the background job was hung up with its shell")
}

// An empty line and Ctrl-C at the prompt run no command: the hooks run again, and the DEBUG trap, still armed, must not take
// the first of them for the user's command (it once recorded the previous line again, with a C and a D).
func TestAnEmptyLineAndACtrlCAtThePromptMakeNoCommand(t *testing.T) {
	for _, form := range []string{"string", "array"} {
		t.Run(form, func(t *testing.T) {
			profile := ""
			if form == "array" {
				major, minor := bashMajorMinor(t)
				if major < 5 || (major == 5 && minor < 1) {
					t.Skip("NOT RUN: PROMPT_COMMAND is an array from bash 5.1")
				}
				profile = "PROMPT_COMMAND=(true)\n"
			}
			f := bashFixture(t, profile)
			info := f.started()
			require.Equal(t, IntegrationOn, info.Integration.State)
			f.run(info.ID, "echo hi")
			f.run(info.ID, "")
			before := f.prompts(info.ID)
			require.NoError(t, f.m.Write(info.ID, 0, []byte("\x03")))
			require.Eventually(t, func() bool { return f.prompts(info.ID) > before }, 20*time.Second, 5*time.Millisecond, "no prompt after Ctrl-C")
			f.run(info.ID, "echo done")
			var lines []string
			for _, r := range f.scanned(info.ID).Records() {
				if r.Ran {
					lines = append(lines, r.CommandLine)
				}
			}
			assert.Equal(t, []string{"echo hi", "echo done"}, lines, "only the commands that were typed ran")
			assert.Equal(t, 2, strings.Count(string(f.sink.output(info.ID)), "\x1b]633;E;"), "two lines were sent")
		})
	}
}

func TestAUserWithErrexitKeepsTheirShellWhenAStatusIsNotZero(t *testing.T) {
	f := bashFixture(t, "set -e\n")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "! true")
	f.run(info.ID, "[ -e /no/such/file ] && echo x")
	f.run(info.ID, "echo alive > alive")
	assert.Equal(t, "alive\n", f.fileOf("alive"), "the shell is still there after a status that is not zero")
	var codes []int32
	for _, r := range f.endedCommands(info.ID, 3) {
		codes = append(codes, r.ExitCode)
	}
	assert.Equal(t, []int32{1, 1, 0}, codes)
	f.run(info.ID, "case $- in *e*) echo on > errexit;; *) echo off > errexit;; esac")
	assert.Equal(t, "on\n", f.fileOf("errexit"), "the user's errexit is back on at the prompt")
}

func TestAUserWithNounsetKeepsTheMarksAndTheShell(t *testing.T) {
	f := bashFixture(t, "set -u\n")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "echo hello")
	f.run(info.ID, "(exit 3)")
	var codes []int32
	for _, r := range f.endedCommands(info.ID, 2) {
		codes = append(codes, r.ExitCode)
	}
	assert.Equal(t, []int32{0, 3}, codes)
	assert.Equal(t, 2, strings.Count(string(f.sink.output(info.ID)), "\x1b]633;E;"))
}

// The hooks put a HUP handler only while they run and never take the place of a user's: whoever set one, in the shell or in a
// file it sourced, keeps it, and a user who has none has none at the prompt.
func TestTheHooksLeaveNoHUPHandlerAtThePromptAndNeverReplaceTheUsers(t *testing.T) {
	f := bashFixture(t, "")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "trap -p HUP > none")
	assert.Empty(t, strings.TrimSpace(f.fileOf("none")), "no handler of ours stays at the prompt")
	f.run(info.ID, "trap '' HUP")
	f.run(info.ID, "echo a; echo b")
	f.run(info.ID, "trap -p HUP > typed")
	assert.Contains(t, f.fileOf("typed"), "SIGHUP", "the user's ignore is still in place after the hooks ran")
	assert.NotContains(t, f.fileOf("typed"), "omniview")

	g := bashFixture(t, "")
	infoG := g.started()
	require.NoError(t, os.WriteFile(filepath.Join(g.home, "settrap.sh"), []byte("trap 'echo bye > $HOME/bye' HUP\n"), 0o600))
	g.run(infoG.ID, ". ./settrap.sh")
	g.run(infoG.ID, "echo a")
	g.run(infoG.ID, "trap -p HUP > sourced")
	assert.Contains(t, g.fileOf("sourced"), "bye", "a handler set by a sourced file is the user's and stays")
	assert.NotContains(t, g.fileOf("sourced"), "omniview")
}

// ---- pwsh ----

func TestPwshAnEmptyLineRunsNoCommand(t *testing.T) {
	f := newIntegrationFixture(t, "pwsh", integrationShell(t, "pwsh"))
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "echo hi")
	f.run(info.ID, "")
	f.run(info.ID, "   ")
	f.run(info.ID, "echo done")
	var lines []string
	for _, r := range f.scanned(info.ID).Records() {
		if r.Ran {
			lines = append(lines, r.CommandLine)
		}
	}
	assert.Equal(t, []string{"echo hi", "echo done"}, lines, "an empty line is no command, as in zsh")
}

// The user's prompt may run a native command: it must not change the $LASTEXITCODE the user sees for their own command.
func TestPwshTheUsersPromptThatRunsANativeCommandDoesNotChangeLASTEXITCODE(t *testing.T) {
	f := newIntegrationFixture(t, "pwsh", integrationShell(t, "pwsh"))
	require.NoError(t, os.WriteFile(f.files[0], []byte("function prompt { & /bin/sh -c 'exit 5' | Out-Null; '"+integrationPrompt+"' }\n"), 0o600))
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "sh -c 'exit 7'")
	f.run(info.ID, "$LASTEXITCODE > lec")
	assert.Equal(t, "7", strings.TrimSpace(f.fileOf("lec")), "the code of the user's command, not of their prompt's")
}

// RETURN traps (and any other trap) are the user's: the script defines no function that stands in for `trap`.
func TestTheScriptDefinesNoTrapFunctionAndARETURNTrapFiresOnce(t *testing.T) {
	f := bashFixture(t, "")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, `f() { trap 'echo RET >> $HOME/ret' RETURN; echo body >> $HOME/ret; }`)
	f.run(info.ID, "f")
	assert.Equal(t, "body\nRET\n", f.fileOf("ret"), "the RETURN trap fired once, when the function returned")
	f.run(info.ID, "type -t trap > kind")
	assert.Equal(t, "builtin\n", f.fileOf("kind"), "trap is the builtin")
}

// A HUP handler set by `builtin trap`, `command trap` or by the user's own prompt command is the user's too.
func TestAHUPHandlerSetByBuiltinTrapOrByAPromptCommandIsKept(t *testing.T) {
	f := bashFixture(t, "")
	info := f.started()
	f.run(info.ID, "builtin trap 'echo a >> $HOME/hup' HUP")
	f.run(info.ID, "echo x")
	f.run(info.ID, "builtin trap -p HUP > builtin")
	assert.Contains(t, f.fileOf("builtin"), "echo a", "a handler set with builtin trap is kept")
	assert.NotContains(t, f.fileOf("builtin"), "omniview")

	g := bashFixture(t, "")
	infoG := g.started()
	g.run(infoG.ID, "command trap 'echo c >> $HOME/hup' HUP")
	g.run(infoG.ID, "echo x")
	g.run(infoG.ID, "trap -p HUP > command")
	assert.Contains(t, g.fileOf("command"), "echo c", "a handler set with command trap is kept")

	h := bashFixture(t, "PROMPT_COMMAND='builtin trap \"echo p >> $HOME/hup\" HUP'\n")
	infoH := h.started()
	h.run(infoH.ID, "echo x")
	h.run(infoH.ID, "trap -p HUP > prompt")
	assert.Contains(t, h.fileOf("prompt"), "echo p", "a handler set by the user's prompt command is kept")
	assert.NotContains(t, h.fileOf("prompt"), "omniview")
}

// A line of only a comment runs nothing: no command, no mark.
func TestACommentLineIsNotACommand(t *testing.T) {
	f := bashFixture(t, "")
	info := f.started()
	f.run(info.ID, "echo before")
	f.run(info.ID, "# just a comment")
	f.run(info.ID, "   # indented")
	f.run(info.ID, "echo after")
	var lines []string
	for _, r := range f.scanned(info.ID).Records() {
		if r.Ran {
			lines = append(lines, r.CommandLine)
		}
	}
	assert.Equal(t, []string{"echo before", "echo after"}, lines)
}

// With extdebug a DEBUG handler that returns non-zero skips the command: the composed trap keeps the user's status.
func TestAUsersDebugTrapThatSkipsACommandWithExtdebugStillSkipsIt(t *testing.T) {
	f := bashFixture(t, "shopt -s extdebug\ntrap '[[ $BASH_COMMAND != \"touch $HOME/skipped\" ]]' DEBUG\n")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "touch $HOME/skipped")
	f.run(info.ID, "touch $HOME/ran")
	_, err := os.Stat(filepath.Join(f.home, "skipped"))
	assert.True(t, os.IsNotExist(err), "the command the user's trap skipped did not run")
	_, err = os.Stat(filepath.Join(f.home, "ran"))
	assert.NoError(t, err, "the others ran")
}

// ---- pwsh ----

// The user's prompt gets the $? of the last command, as without the integration.
func TestPwshTheUsersPromptSeesTheStatusOfTheLastCommand(t *testing.T) {
	f := newIntegrationFixture(t, "pwsh", integrationShell(t, "pwsh"))
	require.NoError(t, os.WriteFile(f.files[0], []byte("function prompt { if ($?) { 'OK> ' } else { 'FAIL> ' } }\n"), 0o600))
	info := f.start()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.sink.waitFor(t, info.ID, "OK> ")
	count := func(text string) int { return strings.Count(string(f.sink.output(info.ID)), text) }
	step := func(line, want string) {
		before := count(want)
		require.NoError(t, f.m.Write(info.ID, 0, []byte(line+"\r")))
		require.Eventually(t, func() bool { return count(want) > before }, 20*time.Second, 5*time.Millisecond, "no %q after %q", want, line)
	}
	step("Get-Item /no/such/file-omniview -ErrorAction SilentlyContinue", "FAIL> ")
	step("echo fine", "OK> ")
	step("sh -c 'exit 3'", "FAIL> ")
	step("true", "OK> ")
}
