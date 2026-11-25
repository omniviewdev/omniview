//go:build !windows

package terminal

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/terminal/marks"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
)

// The tests of the shell integration (issue #694, step 2) run the user's real zsh and fish on a pty, with a home of
// their own whose startup files the tests write. A shell that is not installed is skipped by name: the test says
// "NOT RUN" and the report of the pull request names it.

// integrationPrompt is the prompt of the user's configuration in these tests.
const integrationPrompt = "P> "

// integrationDirPrefix is what the name of the host's temporary directory of an integration begins with.
const integrationDirPrefix = "omniview-integration-"

func integrationShell(t *testing.T, name string) string {
	t.Helper()
	path, err := exec.LookPath(name)
	if err != nil {
		t.Skipf("NOT RUN: no %s on this machine", name)
	}
	return path
}

func eachIntegrationShell(t *testing.T, body func(t *testing.T, name, shell string)) {
	t.Helper()
	for _, name := range []string{"zsh", "fish"} {
		t.Run(name, func(t *testing.T) { body(t, name, integrationShell(t, name)) })
	}
}

// userFiles writes the startup files of a user of the shell, with a prompt of the tests' own, and returns them.
func userFiles(t *testing.T, name, home string) []string {
	t.Helper()
	write := func(path, text string) string {
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o700))
		require.NoError(t, os.WriteFile(path, []byte(text), 0o600))
		return path
	}
	if name == "fish" {
		return []string{write(filepath.Join(home, ".config", "fish", "config.fish"),
			"set -g fish_greeting\nfunction fish_prompt\n  echo -n '"+integrationPrompt+"'\nend\nfunction fish_right_prompt\nend\n")}
	}
	return []string{
		write(filepath.Join(home, ".zshenv"), "# the user's zshenv\n"),
		write(filepath.Join(home, ".zprofile"), "# the user's zprofile\n"),
		write(filepath.Join(home, ".zshrc"), "PS1='"+integrationPrompt+"'\nRPS1=\nHISTFILE=/dev/null\nunsetopt PROMPT_SP\n"),
		write(filepath.Join(home, ".zlogin"), "# the user's zlogin\n"),
	}
}

func digests(t *testing.T, files []string) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, path := range files {
		data, err := os.ReadFile(path)
		require.NoError(t, err, "the user's file %s is gone", path)
		sum := sha256.Sum256(data)
		out[path] = hex.EncodeToString(sum[:])
	}
	return out
}

// userEnvironment is the environment the host was launched with, as the tests state it.
func userEnvironment(home string, extra ...string) []string {
	return append([]string{
		"HOME=" + home, "USER=omniview-test", "LOGNAME=omniview-test", "PATH=" + os.Getenv("PATH"),
		"XDG_CONFIG_HOME=" + filepath.Join(home, ".config"), "XDG_DATA_HOME=" + filepath.Join(home, ".local", "share"),
		"XDG_CACHE_HOME=" + filepath.Join(home, ".cache"), "XDG_STATE_HOME=" + filepath.Join(home, ".local", "state"),
	}, extra...)
}

// answeringSink answers the queries that a terminal answers (fish asks the terminal what it is before it starts), as the page does.
type answeringSink struct {
	*chunkSink
	m *Manager
}

func (a *answeringSink) Output(id string, data []byte) {
	a.chunkSink.Output(id, data)
	if bytes.Contains(data, []byte("\x1b[c")) || bytes.Contains(data, []byte("\x1b[0c")) {
		go func() { _ = a.m.Write(id, 0, []byte("\x1b[?62;c")) }()
	}
}

type integrationFixture struct {
	t     *testing.T
	name  string
	shell string
	home  string
	tmp   string
	files []string
	m     *Manager
	sink  *chunkSink
	logs  *logtest.RecordingSink
}

// newIntegrationFixture is a manager whose shells start from a launch environment of a home the test owns.
func newIntegrationFixture(t *testing.T, name, shell string, env ...string) *integrationFixture {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("TMPDIR", tmp)
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("ZDOTDIR", "")
	require.NoError(t, os.Unsetenv("ZDOTDIR"))
	f := &integrationFixture{t: t, name: name, shell: shell, home: home, tmp: tmp, files: userFiles(t, name, home), logs: &logtest.RecordingSink{}}
	f.sink = newChunkSink()
	answering := &answeringSink{chunkSink: f.sink, m: nil}
	logger := logging.New(logging.Config{
		Backend: logging.NewSinkBackend(f.logs), Level: logging.NewLevelController(logging.LevelTrace),
	})
	f.m = NewManager(t.Context(), logger, answering)
	answering.m = f.m
	t.Cleanup(func() {
		for _, id := range f.m.running() {
			_ = f.m.CloseSession(id)
		}
	})
	f.m.base = func() []string { return userEnvironment(home, env...) }
	return f
}

func (f *integrationFixture) start(args ...string) Session {
	f.t.Helper()
	info, err := f.m.Start(Options{Command: append([]string{f.shell}, args...), Cwd: f.home, Cols: 100, Rows: 30}, nil)
	require.NoError(f.t, err)
	return info
}

// started is a shell that is at its first prompt.
func (f *integrationFixture) started(args ...string) Session {
	f.t.Helper()
	info := f.start(args...)
	f.sink.waitFor(f.t, info.ID, integrationPrompt)
	return info
}

// prompts is how many prompts the shell has drawn.
func (f *integrationFixture) prompts(id string) int {
	return bytes.Count(f.sink.output(id), []byte(integrationPrompt))
}

// run types a line and waits for the prompt that follows it.
func (f *integrationFixture) run(id, line string) {
	f.t.Helper()
	before := f.prompts(id)
	// A terminal's Enter is a carriage return, not a line feed.
	require.NoError(f.t, f.m.Write(id, 0, []byte(line+"\r")))
	require.Eventually(f.t, func() bool { return f.prompts(id) > before }, 20*time.Second, 5*time.Millisecond, "no prompt after %q", line)
}

// scanned is what the host's scanner (step 1) makes of everything the shell wrote, with the session's own nonce.
func (f *integrationFixture) scanned(id string) *marks.Log {
	f.t.Helper()
	scanner := marks.New(marks.Config{Nonce: f.m.session(f.t, id).nonce, Now: time.Now, MaxRecords: 0, StartOffset: 0})
	scanner.Feed(f.sink.output(id), nil)
	return scanner.Log()
}

// fileOf is what a shell command of the test wrote into a file of the test: the shell's own words, not the stream's.
func (f *integrationFixture) fileOf(name string) string {
	f.t.Helper()
	data, err := os.ReadFile(filepath.Join(f.home, name))
	require.NoError(f.t, err)
	return string(data)
}

func (f *integrationFixture) integrationDirs() []string {
	f.t.Helper()
	found, err := filepath.Glob(filepath.Join(f.tmp, integrationDirPrefix+"*"))
	require.NoError(f.t, err)
	return found
}

func TestAShellStartedWithTheIntegrationPrintsTheMarksWithTheSessionNonceAroundACommand(t *testing.T) {
	eachIntegrationShell(t, func(t *testing.T, name, shell string) {
		f := newIntegrationFixture(t, name, shell)
		info := f.started()
		assert.Equal(t, Integration{State: IntegrationOn, Reason: ""}, info.Integration, "the create answer says the integration is on")
		nonce := f.m.session(t, info.ID).nonce
		require.False(t, nonce.IsZero(), "the host keeps a nonce for the session")

		f.run(info.ID, "echo hello")
		f.run(info.ID, "false")
		f.run(info.ID, `echo "a;b\\c"`)
		out := string(f.sink.output(info.ID))
		reveal := nonce.Reveal()
		for _, want := range []string{
			"\x1b]133;A", "\x1b]133;B", "\x1b]133;C", "\x1b]133;D;0", "\x1b]133;D;1", "\x1b]7;file://",
			"\x1b]633;E;echo hello;" + reveal, "\x1b]633;P;Cwd=" + info.Cwd + ";" + reveal,
		} {
			assert.Contains(t, out, want, "the shell prints this mark")
		}

		records := f.scanned(info.ID).Records()
		var lines []string
		for _, record := range records {
			if record.Ran {
				lines = append(lines, record.CommandLine)
				assert.Equal(t, marks.TrustNonce, record.Trust, "the command line %q carries the nonce", record.CommandLine)
				assert.Equal(t, marks.TrustNonce, record.CwdTrust, "the directory of %q carries the nonce", record.CommandLine)
				assert.Equal(t, info.Cwd, record.Cwd, "the directory of %q", record.CommandLine)
			}
		}
		assert.Equal(t, []string{"echo hello", "false", `echo "a;b\\c"`}, lines, "the commands, as typed")
		if len(records) >= 3 {
			assert.True(t, records[0].HasExitCode)
			assert.Equal(t, int32(0), records[0].ExitCode)
			assert.True(t, records[1].HasExitCode)
			assert.Equal(t, int32(1), records[1].ExitCode, "`false` ended with 1")
		}
	})
}

func TestTheIntegrationPrintsNothingOnTheTerminalOutsideItsMarks(t *testing.T) {
	eachIntegrationShell(t, func(t *testing.T, name, shell string) {
		oscs := regexp.MustCompile("\x1b\\][^\a\x1b]*(\a|\x1b\\\\)")
		session := func(integration bool) string {
			f := newIntegrationFixture(t, name, shell)
			f.m.SetIntegration(func() (bool, error) { return integration, nil })
			info := f.started()
			f.run(info.ID, "echo hello")
			f.run(info.ID, "false")
			raw := f.sink.output(info.ID)
			if integration {
				assert.Contains(t, string(raw), "\x1b]633;E;echo hello;", "the integrated run did print its marks")
			}
			text := string(oscs.ReplaceAll(raw, nil))
			if name == "fish" {
				text = typedText(raw)
			}
			// What the shell draws after the last command is repainted at its own pace (a trailing space, the cursor moves
			// of the next prompt): the runs are held to what comes before it.
			return text[:strings.LastIndex(text, "false")+len("false")]
		}
		off := session(false)
		on := session(true)
		assert.Contains(t, off, "hello", "the control session ran the command")
		assert.Equal(t, off, on, "with the marks taken out, the integrated terminal shows what the plain one does")
	})
}

// typedText is what a person reads of a stream: every escape sequence is gone and a backspace takes back the character
// before it. fish repaints the line it edits, in the order and with the cursor moves it chooses, so for fish this and not the
// bytes is what the two runs are held to; zsh is held to the bytes.
func typedText(raw []byte) string {
	escapes := regexp.MustCompile("\x1b\\][^\a\x1b]*(\a|\x1b\\\\)|\x1b\\[[0-9;?<>=]*[ -/]*[@-~]|\x1b[()][A-Z0-9]|\x1b[=>]")
	var out []rune
	for _, r := range string(escapes.ReplaceAll(raw, nil)) {
		switch r {
		case '\r':
		case '\b':
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
		default:
			out = append(out, r)
		}
	}
	return string(out)
}

func TestTheUsersStartupFilesAreByteIdenticalAfterASession(t *testing.T) {
	eachIntegrationShell(t, func(t *testing.T, name, shell string) {
		f := newIntegrationFixture(t, name, shell)
		before := digests(t, f.files)
		homeBefore := entries(t, f.home)
		info := f.started()
		require.Equal(t, IntegrationOn, info.Integration.State)
		f.run(info.ID, "echo hello")
		require.NoError(t, f.m.CloseSession(info.ID))
		assert.Equal(t, before, digests(t, f.files), "no file of the user's changed (sha256)")
		if name == "zsh" {
			assert.Equal(t, homeBefore, entries(t, f.home), "no file appeared in the user's home")
		}
	})
}

func entries(t *testing.T, dir string) []string {
	t.Helper()
	list, err := os.ReadDir(dir)
	require.NoError(t, err)
	names := make([]string, 0, len(list))
	for _, e := range list {
		names = append(names, e.Name())
	}
	return names
}

func TestAZDOTDIRTheUserSetIsHonouredAndRestored(t *testing.T) {
	shell := integrationShell(t, "zsh")
	for name, setup := range map[string]func(t *testing.T, home string) (env []string, files []string, want string){
		"in the launch environment": func(t *testing.T, home string) ([]string, []string, string) {
			zd := filepath.Join(home, "zd")
			require.NoError(t, os.MkdirAll(zd, 0o700))
			rc := filepath.Join(zd, ".zshrc")
			env := filepath.Join(zd, ".zshenv")
			require.NoError(t, os.WriteFile(rc, []byte("PS1='"+integrationPrompt+"'\nHISTFILE=/dev/null\nUSER_RC=ran\n"), 0o600))
			require.NoError(t, os.WriteFile(env, []byte("USER_ENV=ran\n"), 0o600))
			return []string{"ZDOTDIR=" + zd}, []string{rc, env}, zd
		},
		"set by the user's own .zshenv": func(t *testing.T, home string) ([]string, []string, string) {
			zd := filepath.Join(home, ".config", "zsh")
			require.NoError(t, os.MkdirAll(zd, 0o700))
			rc := filepath.Join(zd, ".zshrc")
			env := filepath.Join(home, ".zshenv")
			require.NoError(t, os.WriteFile(rc, []byte("PS1='"+integrationPrompt+"'\nHISTFILE=/dev/null\nUSER_RC=ran\n"), 0o600))
			require.NoError(t, os.WriteFile(env, []byte("export ZDOTDIR="+zd+"\nUSER_ENV=ran\n"), 0o600))
			return nil, []string{rc, env}, zd
		},
	} {
		t.Run(name, func(t *testing.T) {
			f := newIntegrationFixture(t, "zsh", shell)
			env, files, want := setup(t, f.home)
			f.m.base = func() []string { return userEnvironment(f.home, env...) }
			before := digests(t, files)
			info := f.started()
			assert.Equal(t, IntegrationOn, info.Integration.State)
			f.run(info.ID, "print -r -- zd=$ZDOTDIR env=$USER_ENV rc=$USER_RC > seen; env > exported")
			assert.Equal(t, "zd="+want+" env=ran rc=ran\n", f.fileOf("seen"), "the user's files ran, from the user's directory, and ZDOTDIR is theirs again")
			assert.Contains(t, f.fileOf("exported"), "\nZDOTDIR="+want+"\n", "the exported ZDOTDIR is the user's")
			assert.NotContains(t, f.fileOf("exported"), integrationDirPrefix, "no trace of the shim in the environment")
			require.NoError(t, f.m.CloseSession(info.ID))
			assert.Equal(t, before, digests(t, files), "the user's files are byte-identical")
		})
	}
}

func TestTheNonceIsInNoVariableOfTheShellAndNoChildGetsIt(t *testing.T) {
	eachIntegrationShell(t, func(t *testing.T, name, shell string) {
		f := newIntegrationFixture(t, name, shell)
		info := f.started()
		require.Equal(t, IntegrationOn, info.Integration.State)
		nonce := f.m.session(t, info.ID).nonce.Reveal()
		require.NotEmpty(t, nonce)
		// A shell variable that is not exported is where the script keeps the nonce: only what is exported reaches a child.
		command := "env > exported; command printenv > printed; set -x > exportedvars"
		if name == "zsh" {
			command = "env > exported; /usr/bin/env > printed; typeset -x > exportedvars"
		}
		f.run(info.ID, command)
		for _, file := range []string{"exported", "printed", "exportedvars"} {
			assert.NotContains(t, f.fileOf(file), nonce, "the nonce is not in what %s lists", file)
		}
		if runtime.GOOS == "linux" {
			pid := "$$"
			if name == "fish" {
				pid = "$fish_pid"
			}
			f.run(info.ID, "tr '\\0' '\\n' < /proc/"+pid+"/environ > initial")
			assert.NotContains(t, f.fileOf("initial"), nonce, "the nonce is not in the environment the shell was started with")
		}
		exported := f.fileOf("exported")
		assert.NotContains(t, exported, integrationDirPrefix, "the integration's directory is in no exported variable once the shell is up")
		for _, line := range strings.Split(exported, "\n") {
			assert.False(t, strings.HasPrefix(line, "ZDOTDIR="), "the shell has a ZDOTDIR the user never set: %q", line)
		}
	})
}

func TestTheNonceIsInNoLogNoErrorAndNoAnswerThatTheHostGives(t *testing.T) {
	eachIntegrationShell(t, func(t *testing.T, name, shell string) {
		f := newIntegrationFixture(t, name, shell)
		info := f.started()
		f.run(info.ID, "echo hello")
		nonce := f.m.session(t, info.ID).nonce
		require.False(t, nonce.IsZero())
		secret := nonce.Reveal()
		answer, err := json.Marshal(info)
		require.NoError(t, err)
		listed, err := json.Marshal(f.m.ListSessions())
		require.NoError(t, err)
		got, err := f.m.GetSession(info.ID)
		require.NoError(t, err)
		shown := fmt.Sprintf("%v %+v %#v %s %v", info, info, info, answer, got)
		assert.NotContains(t, shown, secret, "the answer of the create")
		assert.NotContains(t, string(listed), secret, "the list")
		assert.NotContains(t, fmt.Sprintf("%v %+v %#v", f.m.session(t, info.ID).info, info.Integration, f.m.session(t, info.ID).nonce), secret, "what prints the session")
		require.NoError(t, f.m.CloseSession(info.ID))
		end := f.sink.waitEnd(t, info.ID, 20*time.Second)
		assert.NotContains(t, fmt.Sprintf("%+v", end), secret, "the end")
		assert.NotEmpty(t, f.logs.Records(), "the host logged while the terminal ran")
		for _, record := range f.logs.Records() {
			assert.NotContains(t, fmt.Sprintf("%v %v %v", record.Message, record.Fields, record.ToMap()), secret, "a log line of the host")
		}
	})
}

func TestANestedLoginShellDoesNotInheritTheIntegration(t *testing.T) {
	eachIntegrationShell(t, func(t *testing.T, name, shell string) {
		f := newIntegrationFixture(t, name, shell)
		info := f.started()
		require.Equal(t, IntegrationOn, info.Integration.State)
		// The functions of the integration all begin with the same name; a shell that has any of them has the integration.
		probe := `print -r -- "nested zd=${ZDOTDIR-unset} functions=${(k)functions[(I)__omniview*]}"`
		if name == "fish" {
			probe = `set x clean; string match -q "*omniview-integration*" "$XDG_DATA_DIRS"; and set x shim; set f (functions -n | string match "__omniview*" | string join ,); echo "nested xdg=$x functions=$f"`
		}
		f.run(info.ID, shell+" -i -l -c '"+strings.ReplaceAll(probe, "'", `'\''`)+"' > nested")
		seen := f.fileOf("nested")
		assert.NotContains(t, seen, "shim", "the nested shell does not find the shim")
		assert.NotContains(t, seen, integrationDirPrefix, "the nested shell does not find the integration's directory")
		assert.True(t, strings.HasSuffix(strings.TrimSpace(seen), "functions="), "the nested shell has none of the integration's functions: %q", seen)
		if name == "zsh" {
			assert.Contains(t, seen, "zd=unset", "the nested shell reads the user's own files")
		}
	})
}

func TestTheIntegrationKeepsTheUsersPathOrderOnTheLaunchEnvironment(t *testing.T) {
	eachIntegrationShell(t, func(t *testing.T, name, shell string) {
		f := newIntegrationFixture(t, name, shell)
		prepend := "case \":$PATH:\" in *\":/omniview-user/shims:\"*) ;; *) PATH=\"/omniview-user/shims:$PATH\" ;; esac\nexport PATH\n"
		if name == "zsh" {
			require.NoError(t, os.WriteFile(filepath.Join(f.home, ".zprofile"), []byte(prepend), 0o600))
		} else {
			cfg := filepath.Join(f.home, ".config", "fish", "config.fish")
			require.NoError(t, os.WriteFile(cfg, []byte("set -gx PATH /omniview-user/shims $PATH\nfunction fish_prompt\n  echo -n '"+integrationPrompt+"'\nend\n"), 0o600))
		}
		info := f.started()
		assert.Equal(t, IntegrationOn, info.Integration.State)
		f.run(info.ID, "echo $PATH > path")
		assert.True(t, strings.HasPrefix(f.fileOf("path"), "/omniview-user/shims"), "the user's directory is first, with the integration on: %q", f.fileOf("path"))
	})
}

// The channel of the integration is closed in the shell before any program of the user's starts. fish cannot close a
// descriptor, so for fish the descriptor stays, with the other end gone and nothing to read: the test is for zsh.
func TestNoDescriptorOfTheChannelReachesAProgramOfTheUser(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("NOT RUN: /proc/self/fd is Linux's")
	}
	f := newIntegrationFixture(t, "zsh", integrationShell(t, "zsh"))
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "ls -l /proc/self/fd > descriptors")
	assert.NotContains(t, f.fileOf("descriptors"), "socket:", "no socket reaches a program the user runs")
}

// endedCommands waits until the shell has ended n commands that ran and returns the records.
func (f *integrationFixture) endedCommands(id string, n int) []marks.Record {
	f.t.Helper()
	var ran []marks.Record
	require.Eventually(f.t, func() bool {
		ran = ran[:0]
		for _, r := range f.scanned(id).Records() {
			if r.Ran && r.HasExitCode {
				ran = append(ran, r)
			}
		}
		return len(ran) >= n
	}, 20*time.Second, 10*time.Millisecond, "fewer than %d commands ended", n)
	return ran
}

func TestAMultiLineCommandIsRecordedWithItsNewlinesAndNotWithoutThem(t *testing.T) {
	eachIntegrationShell(t, func(t *testing.T, name, shell string) {
		f := newIntegrationFixture(t, name, shell)
		info := f.started()
		require.Equal(t, IntegrationOn, info.Integration.State)
		typed, want := "for i in 1 2\recho $i\rend\r", "for i in 1 2\necho $i\nend"
		if name == "zsh" {
			typed, want = "for i in 1 2; do\recho $i\rdone\r", "for i in 1 2; do\necho $i\ndone"
		}
		require.NoError(t, f.m.Write(info.ID, 0, []byte(typed)))
		ran := f.endedCommands(info.ID, 1)
		assert.Equal(t, want, ran[0].CommandLine, "the line as typed, newlines kept")
		assert.Equal(t, marks.TrustNonce, ran[0].Trust)
	})
}

// A user who binds Enter keeps their binding: the host adds nothing to it, so the command has no trusted line, and runs.
func TestAFishUserWhoBoundEnterKeepsTheirBindingAndTheCommandHasNoTrustedLine(t *testing.T) {
	f := newIntegrationFixture(t, "fish", integrationShell(t, "fish"))
	cfg := f.files[0]
	data, err := os.ReadFile(cfg)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(cfg, append(data, []byte("bind \\r execute\nbind \\n execute\n")...), 0o600))
	info := f.started()
	f.run(info.ID, "echo hello > ran")
	assert.Equal(t, "hello\n", f.fileOf("ran"), "the command ran")
	assert.NotContains(t, string(f.sink.output(info.ID)), "\x1b]633;E;", "no trusted line: the user's binding wins")
}

// An abbreviation is recorded as what ran: the expanded text, as fish_preexec and VS Code's own script have it.
func TestAFishAbbreviationIsRecordedExpandedAsWhatRan(t *testing.T) {
	f := newIntegrationFixture(t, "fish", integrationShell(t, "fish"))
	cfg := f.files[0]
	data, err := os.ReadFile(cfg)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(cfg, append(data, []byte("abbr -a gs 'echo status-expanded'\n")...), 0o600))
	info := f.started()
	require.NoError(t, f.m.Write(info.ID, 0, []byte("gs\r")))
	ran := f.endedCommands(info.ID, 1)
	assert.Equal(t, "echo status-expanded", ran[0].CommandLine)
}

// The escape of a long line that needs the per-character path is called directly (a pty would complete a Tab).
func TestTheFishEscapeOfA4KBLineWithControlBytesIsCorrectAndCheap(t *testing.T) {
	f := newIntegrationFixture(t, "fish", integrationShell(t, "fish"))
	info := f.started()
	script := "set l (string repeat -n 1300 (printf 'a\\x01;') | string join '')\nset s (date +%s%N)\n__omniview_escape $l > escaped\nset e (date +%s%N)\necho (math -s0 \"($e-$s)/1000000\") > cost\n"
	require.NoError(t, os.WriteFile(filepath.Join(f.home, "cost.fish"), []byte(script), 0o600))
	f.run(info.ID, "source cost.fish")
	assert.Equal(t, strings.Repeat(`a\x01\x3b`, 1300), f.fileOf("escaped"), "every control byte and every ';' is escaped")
	ms, err := strconv.Atoi(strings.TrimSpace(f.fileOf("cost")))
	if err != nil {
		t.Logf("%q", f.sink.output(info.ID))
	}
	require.NoError(t, err)
	t.Logf("fish escape of a 3900-byte line with 2600 bytes to escape: %d ms", ms)
	assert.Less(t, ms, 400, "the escape of the longest line costs under 400 ms")
}

// With xtrace on, zsh prints every command it runs: the hooks must not print the nonce there.
func TestZshXtraceNeverPrintsTheNonce(t *testing.T) {
	f := newIntegrationFixture(t, "zsh", integrationShell(t, "zsh"))
	require.NoError(t, os.WriteFile(filepath.Join(f.home, ".zshrc"), []byte("PS1='"+integrationPrompt+"'\nHISTFILE=/dev/null\nsetopt xtrace\n"), 0o600))
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "echo hello")
	f.run(info.ID, "false")
	nonce := f.m.session(t, info.ID).nonce.Reveal()
	out := regexp.MustCompile("\x1b\\][^\a\x1b]*(\a|\x1b\\\\)").ReplaceAll(f.sink.output(info.ID), nil)
	assert.Contains(t, string(out), "+", "xtrace is on: the shell traces")
	assert.NotContains(t, string(out), nonce, "the nonce is in the trace outside the marks")
}
