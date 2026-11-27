//go:build !windows

package terminal

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/terminal/marks"
)

// The tests of the shell integration against the prompt frameworks that users run (issue #694, step 7). None of the
// frameworks is installed by the machine and no test downloads anything. testdata/frameworks holds:
//
//   - vendor/: single files of MIT and ISC projects, UNCHANGED, with their licences (bash-preexec; the init scripts of
//     starship; lib/termsupport.zsh and lib/functions.zsh of oh-my-zsh; the termtitle module of Zim);
//   - standins/: HERMETIC STAND-INS of what is too big to vendor (powerlevel10k, zsh4humans, the starship binary, the
//     loaders of oh-my-zsh and Zim). Each cites the upstream file and the lines it copies; none of them is the framework;
//   - homes/: the startup files of a user of each framework, copied into the temporary home of a test.
//
// The shells are REAL (the machine's zsh and bash, and fish when it is installed: a missing shell is skipped by name,
// "NOT RUN"). The emulator is none: the tests read the bytes the shell wrote on its pty and give them to the host's
// scanner (package marks), as the manager does.
//
// The commands every test runs are the ones the issue names: `true`, `false` and a command that ends with 3.

// frameworkCase is one user of one framework in one real shell.
type frameworkCase struct {
	// home is the directory of testdata/frameworks/homes whose files the user has.
	home  string
	shell string
	// exit3 is the command that ends with status 3: a subshell, unless the shell or the framework cannot see one (fish has no
	// such syntax, and bash-preexec, with or without the integration, does not see a subshell: its trap is not called for it).
	exit3 string
	// hooksLeftOut is a framework whose own hooks make the integration leave its hooks out (powerlevel10k: P9K_VERSION).
	hooksLeftOut bool
	// ownEnd is a framework that prints the start and the end of a command (OSC 133 C and D) itself.
	ownEnd bool
	// ownCwd is a framework that prints OSC 7 itself.
	ownCwd bool
	// shellPath is the shell binary under test, set for bash (OMNIVIEW_TEST_BASHES); empty means the one on PATH.
	shellPath string
	// statusLog is the file of the home where the framework's own hook wrote the status it saw.
	statusLog string
}

func frameworkCases() []frameworkCase {
	return []frameworkCase{
		{home: "p10k-zsh", shell: "zsh", exit3: "(exit 3)", hooksLeftOut: true, ownEnd: true, ownCwd: false, statusLog: "framework-status"},
		{home: "starship-zsh", shell: "zsh", exit3: "(exit 3)", hooksLeftOut: false, ownEnd: false, ownCwd: false, statusLog: "framework-status"},
		{home: "starship-zsh-133", shell: "zsh", exit3: "(exit 3)", hooksLeftOut: false, ownEnd: false, ownCwd: false, statusLog: "framework-status"},
		{home: "omz-zsh", shell: "zsh", exit3: "(exit 3)", hooksLeftOut: false, ownEnd: false, ownCwd: true, statusLog: "framework-status"},
		{home: "zim-zsh", shell: "zsh", exit3: "(exit 3)", hooksLeftOut: false, ownEnd: false, ownCwd: false, statusLog: "framework-status"},
		{home: "z4h-zsh", shell: "zsh", exit3: "(exit 3)", hooksLeftOut: false, ownEnd: true, ownCwd: false, statusLog: "framework-status"},
		{home: "z4h-p10k-zsh", shell: "zsh", exit3: "(exit 3)", hooksLeftOut: true, ownEnd: true, ownCwd: false, statusLog: "framework-status"},
		{home: "bash-preexec", shell: "bash", exit3: "sh -c 'exit 3'", hooksLeftOut: false, ownEnd: false, ownCwd: false, statusLog: "framework-status"},
		{home: "starship-bash", shell: "bash", exit3: "(exit 3)", hooksLeftOut: false, ownEnd: false, ownCwd: false, statusLog: "framework-status"},
		{home: "starship-bash-133", shell: "bash", exit3: "(exit 3)", hooksLeftOut: false, ownEnd: false, ownCwd: false, statusLog: "framework-status"},
		{home: "starship-bash-preexec", shell: "bash", exit3: "sh -c 'exit 3'", hooksLeftOut: false, ownEnd: false, ownCwd: false, statusLog: "framework-status"},
		{home: "starship-fish", shell: "fish", exit3: "sh -c 'exit 3'", hooksLeftOut: false, ownEnd: true, ownCwd: true, statusLog: "framework-status"},
	}
}

func frameworksDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("testdata", "frameworks"))
	require.NoError(t, err)
	return dir
}

// frameworkFixture is a manager whose shell starts in a home that has the files of a user of the framework, and nothing else.
func frameworkFixture(t *testing.T, c frameworkCase, integration bool) *integrationFixture {
	t.Helper()
	dir := frameworksDir(t)
	f := newIntegrationFixture(t, c.shell, c.shellBinary(t), "FRAMEWORKS="+dir)
	for _, path := range f.files {
		require.NoError(t, os.Remove(path))
	}
	require.NoError(t, os.CopyFS(f.home, os.DirFS(filepath.Join(dir, "homes", c.home))))
	f.files = nil
	require.NoError(t, filepath.WalkDir(f.home, func(path string, entry os.DirEntry, err error) error {
		if err == nil && !entry.IsDir() {
			f.files = append(f.files, path)
		}
		return err
	}))
	require.NotEmpty(t, f.files, "the home of %s has files", c.home)
	f.m.SetIntegration(func() (bool, error) { return integration, nil })
	return f
}

// shellBinary is the shell under test: the explicit path of a case, or the one on PATH.
func (c frameworkCase) shellBinary(t *testing.T) string {
	t.Helper()
	if c.shellPath == "" {
		return integrationShell(t, c.shell)
	}
	if reason := integrationShellSkip("bash", func() (int, int, error) { return probeBashVersion(c.shellPath) }); reason != "" {
		t.Skipf("NOT RUN: %s", reason)
	}
	return c.shellPath
}

// testBashes are the bash binaries under test, chosen explicitly: OMNIVIEW_TEST_BASHES is a colon-separated list of paths (to run
// 5.2 and 5.3 in one go); with none the bash on PATH is the only one.
func testBashes(t *testing.T) []string {
	t.Helper()
	if list := os.Getenv("OMNIVIEW_TEST_BASHES"); list != "" {
		return strings.Split(list, ":")
	}
	path, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("NOT RUN: no bash on this machine")
	}
	return []string{path}
}

// bashLabel is the name of the bash version of a binary, for the name of a test: "bash-5.3.15".
func bashLabel(t *testing.T, path string) string {
	t.Helper()
	out, err := exec.Command(path, "-c", "printf %s \"$BASH_VERSION\"").Output()
	require.NoError(t, err, "bash %s says no version", path)
	return "bash-" + strings.SplitN(string(out), "(", 2)[0]
}

// withBashes is the case once for each bash under test (a bash case), or once.
func withBashes(t *testing.T, c frameworkCase) []frameworkCase {
	t.Helper()
	if c.shell != "bash" {
		return []frameworkCase{c}
	}
	var out []frameworkCase
	for _, path := range testBashes(t) {
		c.shellPath = path
		out = append(out, c)
	}
	return out
}

// caseName names a test of a case: the home, and the version of the bash when it is one.
func caseName(t *testing.T, c frameworkCase) string {
	t.Helper()
	label := c.home
	if label == "" {
		label = c.shell
	}
	if c.shellPath != "" {
		label += "@" + bashLabel(t, c.shellPath)
	}
	return label
}

func eachFramework(t *testing.T, keep func(c frameworkCase) bool, body func(t *testing.T, c frameworkCase)) {
	t.Helper()
	for _, c := range frameworkCases() {
		if keep != nil && !keep(c) {
			continue
		}
		for _, each := range withBashes(t, c) {
			t.Run(caseName(t, each), func(t *testing.T) { body(t, each) })
		}
	}
}

// runThree runs `true`, `false` and the command that ends with 3, each to its prompt.
func (f *integrationFixture) runThree(id string, c frameworkCase) {
	f.t.Helper()
	f.run(id, "true")
	f.run(id, "false")
	f.run(id, c.exit3)
}

// ranRecords is the records of the commands that ran, once n of them have ended.
func (f *integrationFixture) ranRecords(id string, n int) []marks.Record {
	f.t.Helper()
	var ran []marks.Record
	require.Eventually(f.t, func() bool {
		ran = ran[:0]
		for _, r := range f.scanned(id).Records() {
			if r.Ran {
				ran = append(ran, r)
			}
		}
		return len(ran) >= n
	}, 20*time.Second, 10*time.Millisecond, "fewer than %d commands ran", n)
	// Whatever else has come since is a duplicate, and is counted.
	return ran
}

func exitCodes(records []marks.Record) []int32 {
	codes := make([]int32, 0, len(records))
	for _, r := range records {
		if r.HasExitCode {
			codes = append(codes, r.ExitCode)
		} else {
			codes = append(codes, -1)
		}
	}
	return codes
}

func (f *integrationFixture) homeFile(name string) string {
	f.t.Helper()
	data, err := os.ReadFile(filepath.Join(f.home, name))
	if os.IsNotExist(err) {
		return ""
	}
	require.NoError(f.t, err)
	return string(data)
}

// The genuine marks of the integration stay trusted next to a framework that has hooks of its own: each command is ONE record,
// with the line as typed and the right status, and nothing a framework prints makes a second one.
func TestAFrameworksUserStillGetsTheGenuineMarksTrustedWithTheRightExitCodes(t *testing.T) {
	eachFramework(t, func(c frameworkCase) bool { return !c.hooksLeftOut }, func(t *testing.T, c frameworkCase) {
		f := frameworkFixture(t, c, true)
		info := f.started()
		require.Equal(t, IntegrationOn, info.Integration.State, "the framework does not make the integration fail")
		f.runThree(info.ID, c)
		ran := f.ranRecords(info.ID, 3)

		require.Len(t, ran, 3, "three commands ran, so three records: a mark of the framework makes no second command")
		var lines []string
		trusted := 0
		for _, r := range ran {
			lines = append(lines, r.CommandLine)
			if r.Trust == marks.TrustNonce {
				trusted++
			}
			assert.Equal(t, marks.TrustNonce, r.CwdTrust, "the directory of %q carries the nonce", r.CommandLine)
			assert.Equal(t, info.Cwd, r.Cwd, "the directory of %q", r.CommandLine)
		}
		assert.Equal(t, []string{"true", "false", c.exit3}, lines, "every command line is the one that was typed, vouched for by the nonce")
		assert.Equal(t, 3, trusted, "no trusted command is missing and none is a duplicate")
		assert.Equal(t, []int32{0, 1, 3}, exitCodes(ran), "the exit codes of `true`, `false` and the command that ends with 3")
		for _, r := range ran {
			assert.Equal(t, marks.StateEnded, r.State)
		}
	})
}

// A framework that is skipped by the integration still gives the page its own marks, believed as far as anyone can believe
// them: for navigation, with no command line and no trusted directory.
func TestWhatAFrameworkPrintsOnItsOwnIsAcceptedAtLowTrustAndNeverAsACommandLine(t *testing.T) {
	eachFramework(t, func(c frameworkCase) bool { return c.ownEnd || c.ownCwd }, func(t *testing.T, c frameworkCase) {
		if c.shell == "fish" && fishMajor(t, c.shellBinary(t)) < 4 {
			t.Skip("NOT RUN: fish before 4 prints no marks of its own, so there is nothing of the framework's to accept")
		}
		f := frameworkFixture(t, c, false)
		info := f.started()
		require.Equal(t, IntegrationOff, info.Integration.State, "the control runs with the setting off, so every mark is the framework's")
		f.runThree(info.ID, c)
		raw := string(f.sink.output(info.ID))
		log := f.scanned(info.ID)
		if c.ownEnd {
			assert.Contains(t, raw, "\x1b]133;D;", "the framework does print its own end mark: the test is about it")
			ran := f.ranRecords(info.ID, 3)
			assert.Len(t, ran, 3, "three commands, three records")
			assert.Equal(t, []int32{0, 1, 3}, exitCodes(ran), "the framework's own end marks give the exit codes")
			for _, r := range ran {
				assert.Equal(t, marks.TrustUnverified, r.Trust, "the framework's mark is not a trusted command line")
				assert.Empty(t, r.CommandLine, "no command line comes from a mark that carries no nonce (a cmdline_url is not one)")
				assert.Equal(t, marks.TrustUnverified, r.CwdTrust)
			}
		}
		if c.ownCwd {
			assert.Contains(t, raw, "\x1b]7;file://", "the framework does print its own OSC 7: the test is about it")
			cwd, trust := log.Cwd()
			assert.Equal(t, info.Cwd, cwd, "the directory the framework printed is the right one")
			assert.Equal(t, marks.TrustUnverified, trust, "and it is believed as far as OSC 7 can be believed: not for a new terminal")
		}
		for _, r := range log.Records() {
			assert.Empty(t, r.CommandLine, "with no nonce there is no command line")
		}
	})
}

// powerlevel10k sets P9K_VERSION as a variable of the shell while .zshrc runs, so the host cannot see it in the launch
// environment: the script looks for it at the end of .zlogin (`${+P9K_VERSION}`), and leaves its hooks out. The user's p10k
// prints its own marks: they stay what they are, and nothing of the integration's is next to them.
func TestAPowerlevel10kUserGetsNoHooksFromTheIntegrationAndKeepsTheirOwnMarks(t *testing.T) {
	// p10k alone, and zsh4humans with its default prompt (which loads p10k).
	eachFramework(t, func(c frameworkCase) bool { return c.hooksLeftOut }, func(t *testing.T, c frameworkCase) { p10kUserBody(t, c) })
}

func p10kUserBody(t *testing.T, c frameworkCase) {
	t.Helper()
	f := frameworkFixture(t, c, true)
	info := f.started()
	assert.Equal(t, IntegrationOn, info.Integration.State, "the script still tells the host the shell is up")
	f.runThree(info.ID, c)
	f.run(info.ID, "print -rl -- $precmd_functions $preexec_functions > hooks")

	hooks := f.homeFile("hooks")
	assert.NotContains(t, hooks, "__omniview", "no hook of the integration is in the arrays of a shell that has P9K_VERSION")
	assert.Contains(t, hooks, "_p9k_precmd", "the hooks of powerlevel10k are")
	raw := string(f.sink.output(info.ID))
	assert.NotContains(t, raw, "\x1b]633;", "the integration printed no mark of its own")
	assert.Contains(t, raw, "\x1b]133;D;", "the marks are p10k's")

	var ran []marks.Record
	for _, r := range f.scanned(info.ID).Records() {
		if r.Ran {
			ran = append(ran, r)
		}
	}
	require.GreaterOrEqual(t, len(ran), 3)
	assert.Equal(t, []int32{0, 1, 3}, exitCodes(ran[:3]), "p10k's end marks carry the status of the user's commands")
	for _, r := range ran {
		assert.Equal(t, marks.TrustUnverified, r.Trust, "p10k's marks are low trust")
		assert.Empty(t, r.CommandLine, "p10k's start mark carries a cmdline_url, never a trusted line")
	}
}

// The hook of a framework sees the status of the user's command ($? of zsh and bash, $status of fish), and the hooks of the
// framework are called for every command.
func TestTheStatusAFrameworksHookSeesIsTheUsersAndEveryCommandReachesTheFramework(t *testing.T) {
	eachFramework(t, nil, func(t *testing.T, c frameworkCase) {
		seen := func(integration bool) ([]string, string, string) {
			f := frameworkFixture(t, c, integration)
			info := f.started()
			f.runThree(info.ID, c)
			log := f.homeFile(c.statusLog)
			require.NotEmpty(t, log, "the framework's hook did not run")
			return strings.Fields(log), f.homeFile("framework-preexec"), string(f.sink.output(info.ID))
		}
		off, offPreexec, _ := seen(false)
		on, onPreexec, raw := seen(true)
		require.GreaterOrEqual(t, len(on), 3)
		assert.Equal(t, []string{"0", "1", "3"}, on[len(on)-3:], "the status the framework's hook saw after true, false and the command that ends with 3")
		assert.Equal(t, off, on, "the statuses are what the same framework sees with no integration")
		assert.Equal(t, offPreexec, onPreexec, "the commands the framework's preexec saw are the ones it sees with no integration")
		if c.home == "bash-preexec" {
			assert.Equal(t, "true\nfalse\n"+c.exit3+"\n", onPreexec, "bash-preexec's preexec is called for every command, the first one too")
		}
		if c.home == "omz-zsh" {
			assert.Contains(t, raw, "ERR P> ", "the prompt of oh-my-zsh reads the status with %? when it is drawn: it sees 1 after `false`")
			assert.Contains(t, raw, "OK P> ")
		}
	})
}

// The prompt is the framework's own, byte for byte, and the integration prints nothing but its marks.
func TestAFrameworksPromptTextIsUnchangedAndNothingIsPrintedOutsideTheMarks(t *testing.T) {
	eachFramework(t, nil, func(t *testing.T, c frameworkCase) {
		oscs := regexp.MustCompile("\x1b\\][^\a\x1b]*(\a|\x1b\\\\)")
		session := func(integration bool) string {
			f := frameworkFixture(t, c, integration)
			info := f.started()
			f.runThree(info.ID, c)
			raw := f.sink.output(info.ID)
			text := string(oscs.ReplaceAll(raw, nil))
			if c.shell == "fish" {
				// fish repaints the line it edits at its own pace: a space it draws before the newline is a timing, not text.
				text = regexp.MustCompile(` +\n`).ReplaceAllString(typedText(raw), "\n")
			}
			// What the shell draws after the last command is repainted at its own pace: the runs are held to what comes before it.
			end := strings.LastIndex(text, c.exit3) + len(c.exit3)
			require.Greater(t, end, len(c.exit3)-1, "the last command is in the output")
			return text[:end]
		}
		off := session(false)
		on := session(true)
		assert.Contains(t, off, "P> ", "the control run drew the framework's prompt")
		assert.Equal(t, off, on, "with the marks taken out, the integrated terminal shows what the framework draws alone")
	})
}

func TestTheFilesOfAFrameworksUserAreByteIdenticalAfterASession(t *testing.T) {
	eachFramework(t, nil, func(t *testing.T, c frameworkCase) {
		f := frameworkFixture(t, c, true)
		before := digests(t, f.files)
		info := f.started()
		f.runThree(info.ID, c)
		require.NoError(t, f.m.CloseSession(info.ID))
		assert.Equal(t, before, digests(t, f.files), "no file of the user's changed (sha256)")
	})
}

// ZDOTDIR is the shim's while the user's files run, and the user's again once they are read: Zim derives ZIM_HOME from it
// in .zshrc, and zsh4humans sets it in .zshenv when it is unset.
func TestTheZDOTDIROfZimAndZsh4humansIsTheUsersOwn(t *testing.T) {
	for _, home := range []string{"zim-zsh", "z4h-zsh"} {
		t.Run(home, func(t *testing.T) {
			var c frameworkCase
			for _, candidate := range frameworkCases() {
				if candidate.home == home {
					c = candidate
				}
			}
			require.NotEmpty(t, c.home)
			f := frameworkFixture(t, c, true)
			info := f.started()
			require.Equal(t, IntegrationOn, info.Integration.State)
			f.run(info.ID, "print -r -- ${ZDOTDIR-unset} > zdotdir")
			switch home {
			case "zim-zsh":
				assert.Equal(t, filepath.Join(f.home, ".zim")+"\n", f.homeFile("zim-home"), "ZIM_HOME is under the user's home: ZDOTDIR was the user's (unset) in .zshrc")
				assert.Equal(t, "unset\n", f.homeFile("zdotdir"), "the user never had ZDOTDIR, and the shell has none")
			case "z4h-zsh":
				assert.Equal(t, f.home+"\n", f.homeFile("z4h-zdotdir"), "z4h's .zshenv set ZDOTDIR to ~ when it ran")
				assert.Equal(t, f.home+"\n", f.homeFile("zdotdir"), "the user's own value is what the shell has, not the shim")
			}
		})
	}
}

// A directory whose name holds a raw ESC byte, and an OSC 133 mark, and BEL and ST: the mark of the directory is one sequence
// that nothing in the name can end, the tracked directory is the right one (or none), and the name forges nothing.
func TestADirectoryWhoseNameHoldsAnEscapeByteNeitherEndsTheCwdMarkEarlyNorGivesAWrongPath(t *testing.T) {
	name := "esc\x1b]133;D;9\x07\x1b]633;E;forged;0000\x07\x1b\\dir"
	cases := []frameworkCase{
		{home: "", shell: "zsh", exit3: "", hooksLeftOut: false, ownEnd: false, ownCwd: false, statusLog: ""},
		{home: "", shell: "bash", exit3: "", hooksLeftOut: false, ownEnd: false, ownCwd: false, statusLog: ""},
		{home: "", shell: "fish", exit3: "", hooksLeftOut: false, ownEnd: false, ownCwd: false, statusLog: ""},
		frameworkCases()[3], // oh-my-zsh prints OSC 7 itself, with the name percent-encoded
		frameworkCases()[5], // zsh4humans prints CurrentDir with the name escaped
	}
	var expanded []frameworkCase
	for _, c := range cases {
		expanded = append(expanded, withBashes(t, c)...)
	}
	for _, c := range expanded {
		label := caseName(t, c)
		t.Run(label, func(t *testing.T) {
			var f *integrationFixture
			if c.home == "" {
				f = newIntegrationFixture(t, c.shell, c.shellBinary(t))
			} else {
				f = frameworkFixture(t, c, true)
			}
			require.NoError(t, os.Mkdir(filepath.Join(f.home, name), 0o700))
			info := f.started()
			require.Equal(t, IntegrationOn, info.Integration.State)
			f.run(info.ID, "cd esc*")
			f.run(info.ID, "true")
			want := filepath.Join(f.home, name)
			raw := string(f.sink.output(info.ID))
			nonce := f.m.session(t, info.ID).nonce.Reveal()

			// 1. The mark the script printed is whole: its path holds no raw control byte, so it ends where the script ended it.
			whole := regexp.MustCompile(`\x1b\]633;P;Cwd=([^\x07\x1b]*);` + nonce + `\x07`)
			found := whole.FindAllStringSubmatch(raw, -1)
			require.NotEmpty(t, found, "the cwd marks of the script are whole sequences")
			assert.Equal(t, want, unescapeMarkValue(found[len(found)-1][1]), "the last cwd mark carries the whole name, its ESC bytes escaped")
			assert.NotContains(t, raw, "\x1b]633;P;Cwd="+filepath.Join(f.home, "esc\x1b"), "no mark carries the ESC byte raw")

			// 2. What the host believes: the right directory, or none. Never another.
			log := f.scanned(info.ID)
			cwd, _ := log.Cwd()
			assert.True(t, cwd == want || cwd == "", "the tracked directory is %q: right or unknown", cwd)
			// The system's answer (GetCwd, which prefers the shell's proof only where it is the very directory the process is in)
			// is the real path, whatever the mark said.
			answer, err := f.m.Cwd(info.ID)
			require.NoError(t, err)
			assert.Equal(t, want, answer.Path, "GetCwd names the real directory")
			// 3. The name forged nothing: no record has the end mark's code or the command line the name tried to make.
			// fish prints the directory's name raw in its own title (OSC 0), so the name's `133;D;9` reaches the stream from fish and
			// not from the integration: a forged low-trust end mark that the host cannot tell from fish's own. The integration is held
			// to what it prints: a control run with the setting off is the proof that the mark is fish's, not ours.
			shellPrintsTheName := c.shell == "fish" && fishPrintsTheName(t, name)
			for _, r := range log.Records() {
				assert.NotEqual(t, "forged", r.CommandLine)
				if r.HasExitCode && !shellPrintsTheName {
					assert.NotEqual(t, int32(9), r.ExitCode, "the name's own `133;D;9` ended no command")
				}
			}
		})
	}
}

// unescapeMarkValue reverses the escaping of a mark's value (\\ and \xHH), as the host does.
func unescapeMarkValue(s string) string {
	var out strings.Builder
	for i := 0; i < len(s); i++ {
		switch {
		case s[i] == '\\' && i+1 < len(s) && s[i+1] == '\\':
			out.WriteByte('\\')
			i++
		case s[i] == '\\' && i+3 < len(s) && s[i+1] == 'x':
			var b byte
			for _, h := range []byte{s[i+2], s[i+3]} {
				b <<= 4
				switch {
				case h >= '0' && h <= '9':
					b |= h - '0'
				case h >= 'a' && h <= 'f':
					b |= h - 'a' + 10
				case h >= 'A' && h <= 'F':
					b |= h - 'A' + 10
				}
			}
			out.WriteByte(b)
			i += 3
		default:
			out.WriteByte(s[i])
		}
	}
	return out.String()
}

// fishPrintsTheName says whether fish alone (the setting off) puts the name's `133;D;9` in the stream: it prints the directory raw in
// its own title (OSC 0), so the mark is fish's and not the integration's.
func fishPrintsTheName(t *testing.T, name string) bool {
	t.Helper()
	off := newIntegrationFixture(t, "fish", integrationShell(t, "fish"))
	off.m.SetIntegration(func() (bool, error) { return false, nil })
	require.NoError(t, os.Mkdir(filepath.Join(off.home, name), 0o700))
	info := off.started()
	off.run(info.ID, "cd esc*")
	off.run(info.ID, "true")
	// The bytes, not the records: with no marks of its own (fish 3.x) no record is open for the name's end mark to close.
	return bytes.Contains(off.sink.output(info.ID), []byte("\x1b]133;D;9"))
}

// bash-preexec 0.7.0 takes another way on bash 5.3 (PS0, not the DEBUG trap): this test is the one that runs on it. It is NOT RUN, by
// name, when no bash 5.3 is among OMNIVIEW_TEST_BASHES.
func TestBashPreexecOnBash53RecordsEveryCommandWithItsOwnLine(t *testing.T) {
	var path string
	for _, candidate := range testBashes(t) {
		if major, minor, err := probeBashVersion(candidate); err == nil && (major > 5 || (major == 5 && minor >= 3)) {
			path = candidate
		}
	}
	if path == "" {
		t.Skip("NOT RUN: no bash 5.3 in OMNIVIEW_TEST_BASHES")
	}
	for _, home := range []string{"bash-preexec", "starship-bash-preexec"} {
		t.Run(home+"@"+bashLabel(t, path), func(t *testing.T) {
			c := frameworkCase{home: home, shell: "bash", exit3: "sh -c 'exit 3'", hooksLeftOut: false, ownEnd: false, ownCwd: false, shellPath: path, statusLog: "framework-status"}
			f := frameworkFixture(t, c, true)
			info := f.started()
			f.runThree(info.ID, c)
			f.run(info.ID, "echo four")
			ran := f.ranRecords(info.ID, 4)
			var lines []string
			for _, r := range ran {
				lines = append(lines, r.CommandLine)
			}
			assert.Equal(t, []string{"true", "false", c.exit3, "echo four"}, lines, "each command's trusted line is its own, and there is no fifth record")
			assert.Equal(t, []int32{0, 1, 3, 0}, exitCodes(ran))
		})
	}
}

// A command of the user's whose name begins like bash-preexec's (`__bp_`) is the user's: it is recorded, with its status. Only
// bash-preexec's own commands are none of the user's.
func TestAUsersCommandNamedLikeBashPreexecsIsStillRecorded(t *testing.T) {
	eachFramework(t, func(c frameworkCase) bool { return c.home == "bash-preexec" }, func(t *testing.T, c frameworkCase) {
		f := frameworkFixture(t, c, true)
		info := f.started()
		f.run(info.ID, "eval '__bp_mine() { return 5; }'")
		f.run(info.ID, "__bp_mine")
		f.run(info.ID, "__bp_mine; echo x")
		ran := f.ranRecords(info.ID, 3)
		var lines []string
		for _, r := range ran {
			lines = append(lines, r.CommandLine)
		}
		assert.Equal(t, []string{"eval '__bp_mine() { return 5; }'", "__bp_mine", "__bp_mine; echo x"}, lines)
		assert.Equal(t, []int32{0, 5, 0}, exitCodes(ran))
	})
}

// testFishes are the fish binaries under test, chosen explicitly: OMNIVIEW_TEST_FISHES is a colon-separated list of fish paths (the
// CI image has 3.7, which prints no marks of its own; 4.x prints C and D itself). One fish per run: each needs its own share directory
// visible (an overlay mount, see T5-frameworks.md). With none, the fish on PATH.
func testFishes(t *testing.T) []string {
	t.Helper()
	if list := os.Getenv("OMNIVIEW_TEST_FISHES"); list != "" {
		return strings.Split(list, ":")
	}
	path, err := exec.LookPath("fish")
	if err != nil {
		t.Skip("NOT RUN: no fish on this machine")
	}
	return []string{path}
}

// Every fish gives the exit codes of `true`, `false` and a command that ends with 3 on its end marks, with the trusted line.
func TestFishGivesTheRightExitCodesOnEveryVersionUnderTest(t *testing.T) {
	for _, path := range testFishes(t) {
		out, err := exec.Command(path, "--version").Output()
		require.NoError(t, err)
		t.Run("fish-"+strings.TrimSpace(strings.TrimPrefix(string(out), "fish, version ")), func(t *testing.T) {
			f := newIntegrationFixture(t, "fish", path)
			info := f.started()
			require.Equal(t, IntegrationOn, info.Integration.State)
			for _, c := range []string{"true", "false", "sh -c 'exit 3'"} {
				f.run(info.ID, c)
			}
			ran := f.ranRecords(info.ID, 3)
			require.Len(t, ran, 3)
			assert.Equal(t, []int32{0, 1, 3}, exitCodes(ran))
			for _, r := range ran {
				assert.Equal(t, marks.TrustNonce, r.Trust, "the line of %q", r.CommandLine)
			}
		})
	}
}

// bash-preexec with the shell options that make traps follow into functions (extdebug, set -T): the user's preexec runs exactly once
// per command, every record has its own line, an empty line is no command, on every bash under test.
func TestBashPreexecWithExtdebugOrFunctraceRecordsEachCommandOnceWithItsOwnLine(t *testing.T) {
	modes := map[string]string{"plain": "", "extdebug": "shopt -s extdebug\n", "functrace": "set -T\n"}
	for name, option := range modes {
		for _, path := range testBashes(t) {
			t.Run(name+"@"+bashLabel(t, path), func(t *testing.T) {
				c := frameworkCase{home: "bash-preexec", shell: "bash", exit3: "sh -c 'exit 3'", hooksLeftOut: false, ownEnd: false, ownCwd: false, shellPath: path, statusLog: "framework-status"}
				f := frameworkFixture(t, c, true)
				// The option is set before bash-preexec is sourced, as a user's .bashrc would.
				rc := filepath.Join(f.home, ".bashrc")
				body, err := os.ReadFile(rc)
				require.NoError(t, err)
				require.NoError(t, os.WriteFile(rc, append([]byte(option), body...), 0o600))
				info := f.started()
				cmds := []string{"true", "false", c.exit3, "__bp_mine() { return 5; }; __bp_mine", "__bp_mine; echo x"}
				for _, line := range cmds {
					f.run(info.ID, line)
				}
				f.run(info.ID, "")
				ran := f.ranRecords(info.ID, len(cmds))
				var lines []string
				for _, r := range ran {
					lines = append(lines, r.CommandLine)
				}
				assert.Equal(t, cmds, lines, "each command's trusted line is its own, and an empty line makes no record")
				assert.Equal(t, []int32{0, 1, 3, 5, 0}, exitCodes(ran))
				assert.Equal(t, strings.Join(cmds, "\n")+"\n", f.homeFile("framework-preexec"), "the user's preexec ran once per command")
			})
		}
	}
}
