//go:build !windows

package terminal

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// launch.env (issue #695, step 1): extra environment for the shell, validated before anything starts. Every refusal
// is INVALID_REQUEST naming `launch.env.<NAME>`, never carries a value, and starts nothing.

const envCanary = "CANARY-9f3a1c-value"

func envOutput(t *testing.T, m *Manager, sink *chunkSink, script string, env map[string]string) string {
	t.Helper()
	info, err := m.Start(Options{Command: []string{sh(t), "-c", script}, Env: env}, nil)
	require.NoError(t, err)
	require.Equal(t, EndExited, sink.waitEnd(t, info.ID, 20*time.Second).Reason)
	return string(sink.output(info.ID))
}

func TestALaunchEnvValueIsVisibleToTheShell(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	sink := newChunkSink()
	m := newChunkManager(t, sink)
	m.base = func() []string { return []string{"HOME=" + os.Getenv("HOME"), "PATH=/usr/bin:/bin", "FROM_BASE=base", "REPLACED=base"} }
	out := envOutput(t, m, sink, `echo a=$OMNI_A; echo b=$OMNI_B; echo base=$FROM_BASE; echo replaced=$REPLACED; echo lower=$omni_lower; env | grep -c '^REPLACED='`,
		map[string]string{"OMNI_A": "plain", "OMNI_B": "has space = and \"quotes\" 'x' $HOME", "REPLACED": "launch", "omni_lower": "ok", "_UNDER9": ""})
	assert.Contains(t, out, "a=plain\r\n")
	assert.Contains(t, out, "b=has space = and \"quotes\" 'x' $HOME\r\n")
	assert.Contains(t, out, "base=base\r\n", "what the launch environment holds stays")
	assert.Contains(t, out, "replaced=launch\r\n", "a name already in the launch environment takes the given value")
	assert.Contains(t, out, "lower=ok\r\n")
	assert.Contains(t, out, "\r\n1\r\n", "the replaced name is in the environment once")
}

func TestALaunchEnvPathIsTheShellsPath(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	sink := newChunkSink()
	m := newChunkManager(t, sink)
	m.base = func() []string { return []string{"HOME=" + os.Getenv("HOME"), "PATH=/usr/bin:/bin"} }
	out := envOutput(t, m, sink, `echo path=$PATH`, map[string]string{"PATH": "/opt/mine:/usr/bin:/bin"})
	assert.Contains(t, out, "path=/opt/mine:/usr/bin:/bin\r\n")
}

func TestARefusedLaunchEnvNamesTheFieldStartsNothingAndNeverEchoesAValue(t *testing.T) {
	long := strings.Repeat("N", MaxEnvName+1)
	for name, c := range map[string]struct {
		env   map[string]string
		field string
	}{
		"OMNIVIEW_ prefix":            {map[string]string{"OMNIVIEW_UI": envCanary}, "launch.env.OMNIVIEW_UI"},
		"PLUGIN_ prefix":              {map[string]string{"PLUGIN_ID": envCanary}, "launch.env.PLUGIN_ID"},
		"WAILS_ prefix":               {map[string]string{"WAILS_MCP_TOKEN": envCanary}, "launch.env.WAILS_MCP_TOKEN"},
		"GOWORK":                      {map[string]string{"GOWORK": envCanary}, "launch.env.GOWORK"},
		"FRONTEND_DEVSERVER_URL":      {map[string]string{"FRONTEND_DEVSERVER_URL": envCanary}, "launch.env.FRONTEND_DEVSERVER_URL"},
		"TMUX":                        {map[string]string{"TMUX": envCanary}, "launch.env.TMUX"},
		"TMUX_PANE":                   {map[string]string{"TMUX_PANE": envCanary}, "launch.env.TMUX_PANE"},
		"launching terminal identity": {map[string]string{"ITERM_SESSION_ID": envCanary}, "launch.env.ITERM_SESSION_ID"},
		"launching terminal size":     {map[string]string{"COLUMNS": envCanary}, "launch.env.COLUMNS"},
		"TERM":                        {map[string]string{"TERM": envCanary}, "launch.env.TERM"},
		"COLORTERM":                   {map[string]string{"COLORTERM": envCanary}, "launch.env.COLORTERM"},
		"TERM_PROGRAM":                {map[string]string{"TERM_PROGRAM": envCanary}, "launch.env.TERM_PROGRAM"},
		"TERM_PROGRAM_VERSION":        {map[string]string{"TERM_PROGRAM_VERSION": envCanary}, "launch.env.TERM_PROGRAM_VERSION"},
		"PWD":                         {map[string]string{"PWD": envCanary}, "launch.env.PWD"},
		"SHELL":                       {map[string]string{"SHELL": envCanary}, "launch.env.SHELL"},
		"a name with =":               {map[string]string{"A=B": envCanary}, "launch.env"},
		"an empty name":               {map[string]string{"": envCanary}, "launch.env"},
		"a name with NUL":             {map[string]string{"A\x00B": envCanary}, "launch.env"},
		"a name that starts with 9":   {map[string]string{"9NAME": envCanary}, "launch.env"},
		"a name with a dash":          {map[string]string{"MY-NAME": envCanary}, "launch.env"},
		"a name with a space":         {map[string]string{"MY NAME": envCanary}, "launch.env"},
		"a name that is not ASCII":    {map[string]string{"NÄME": envCanary}, "launch.env"},
		"a name over the bound":       {map[string]string{long: envCanary}, "launch.env"},
		"a value with NUL":            {map[string]string{"OMNI_X": envCanary + "\x00" + envCanary}, "launch.env.OMNI_X"},
		"a value over the bound":      {map[string]string{"OMNI_X": envCanary + strings.Repeat("v", MaxEnvValue)}, "launch.env.OMNI_X"},
		"one refused among good":      {map[string]string{"OMNI_A": "1", "OMNI_B": "2", "TERM": envCanary}, "launch.env.TERM"},
	} {
		t.Run(name, func(t *testing.T) {
			m, rec := newTestManager(t)
			_, err := m.Start(Options{Command: []string{sh(t), "-c", "sleep 30"}, Env: c.env}, nil)
			require.Error(t, err)
			app := appErr(t, err)
			assert.Equal(t, "INVALID_REQUEST", app.Code)
			assert.Equal(t, apperror.TypeValidation, app.Type)
			assert.Equal(t, http.StatusBadRequest, app.Status)
			assert.Contains(t, app.Detail, c.field)
			assert.NotContains(t, err.Error(), envCanary, "an error never carries a value")
			assert.NotContains(t, app.Detail, envCanary)
			assert.Empty(t, m.running(), "nothing is started")
			assert.Empty(t, rec.output, "nothing is announced")
		})
	}
}

func TestTheNamesTheHostStripsAreExactlyTheNamesLaunchEnvRefuses(t *testing.T) {
	// One source of truth: every name the strip list drops from the launch environment is refused in launch.env.
	for _, name := range []string{"OMNIVIEW_X", "PLUGIN_X", "WAILS_X", "ITERM_X", "KITTY_X", "WEZTERM_X", "ALACRITTY_X", "GHOSTTY_X", "VSCODE_X", "LC_TERMINAL", "LC_TERMINAL_VERSION",
		"GOWORK", "FRONTEND_DEVSERVER_URL", "COLUMNS", "LINES", "TMUX", "TMUX_PANE", "STY", "VTE_VERSION", "TERM_SESSION_ID", "TERMINAL_EMULATOR", "WT_SESSION", "WT_PROFILE_ID"} {
		require.True(t, hostPrivate(name), name)
		assert.Error(t, checkLaunchEnv(map[string]string{name: "v"}), "%s is stripped from the launch environment, so launch.env refuses it", name)
	}
	assert.NoError(t, checkLaunchEnv(map[string]string{"LANG": "x", "PATH": "x", "HOME": "x", "LC_ALL": "x", "EDITOR": "x"}))
}

func TestAHostVariableNeverReachesTheShellThroughLaunchEnv(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	sink := newChunkSink()
	m := newChunkManager(t, sink)
	m.base = func() []string {
		return []string{"HOME=" + os.Getenv("HOME"), "PATH=/usr/bin:/bin", "WAILS_MCP_TOKEN=" + envCanary}
	}
	_, err := m.Start(Options{Command: []string{sh(t), "-c", "echo token=$WAILS_MCP_TOKEN"}, Env: map[string]string{"WAILS_MCP_TOKEN": envCanary}}, nil)
	require.Error(t, err)
	// And with no launch.env the host's canary is stripped as before.
	out := envOutput(t, m, sink, "echo token=${WAILS_MCP_TOKEN-unset}", nil)
	assert.Contains(t, out, "token=unset\r\n")
	assert.NotContains(t, out, envCanary)
}

func TestLaunchEnvBoundsAreInclusive(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	sink := newChunkSink()
	m := newChunkManager(t, sink)
	m.base = func() []string { return []string{"HOME=" + os.Getenv("HOME"), "PATH=/usr/bin:/bin"} }

	exact := map[string]string{"OMNI_BIG": strings.Repeat("v", MaxEnvValue), strings.Repeat("N", MaxEnvName): "x"}
	out := envOutput(t, m, sink, `printf 'len=%s\n' "${#OMNI_BIG}"`, exact)
	assert.Contains(t, out, "len=32768\n")

	many := map[string]string{}
	for i := range MaxEnvEntries {
		many["OMNI_"+strings.Repeat("N", 3)+string(rune('A'+i/26))+string(rune('A'+i%26))] = "v"
	}
	require.Len(t, many, MaxEnvEntries)
	require.NoError(t, checkLaunchEnv(many), "the most entries is allowed")
	many["OMNI_ONE_MORE"] = "v"
	err := checkLaunchEnv(many)
	require.Error(t, err)
	assert.Contains(t, appErr(t, err).Detail, "launch.env")

	// The total: entries that are each in bounds and together past MaxEnvBytes.
	total := map[string]string{}
	for i := 0; len(total)*(MaxEnvValue+6) <= MaxEnvBytes; i++ {
		total["OMNI_"+string(rune('A'+i%26))+string(rune('A'+i/26))] = strings.Repeat("v", MaxEnvValue)
	}
	require.LessOrEqual(t, len(total), MaxEnvEntries)
	err = checkLaunchEnv(total)
	require.Error(t, err)
	assert.Contains(t, appErr(t, err).Detail, "launch.env")
	assert.NotContains(t, err.Error(), "vvvv")
}

// The shell integration takes ZDOTDIR (zsh) and XDG_DATA_DIRS (fish) over for the start and gives the user's value back.
// Decision: launch.env may set them, they are the user's value in the shell's eyes, and the integration still works:
// the shim runs, the user's files are read from the directory named, and the shell sees the name as it was given.
func TestAZDOTDIRInLaunchEnvIsTheUsersAndTheIntegrationStillWorks(t *testing.T) {
	shell := integrationShell(t, "zsh")
	f := newIntegrationFixture(t, "zsh", shell)
	zd := filepath.Join(f.home, "launched-zd")
	require.NoError(t, os.MkdirAll(zd, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(zd, ".zshrc"), []byte("PS1='"+integrationPrompt+"'\nHISTFILE=/dev/null\nUSER_RC=ran\n"), 0o600))
	f.m.base = func() []string { return userEnvironment(f.home) }
	info, err := f.m.Start(Options{Command: []string{shell}, Cwd: f.home, Cols: 100, Rows: 30, Env: map[string]string{"ZDOTDIR": zd}}, nil)
	require.NoError(t, err)
	f.sink.waitFor(t, info.ID, integrationPrompt)
	assert.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "print -r -- zd=$ZDOTDIR rc=$USER_RC > seen; env > exported")
	assert.Equal(t, "zd="+zd+" rc=ran\n", f.fileOf("seen"), "the files of the directory given ran, and ZDOTDIR is the given one again")
	assert.NotContains(t, f.fileOf("exported"), integrationDirPrefix, "no trace of the shim")
	assert.NotEmpty(t, f.scanned(info.ID).Records(), "the integration marks reach the host")
}

func TestXDGDataDirsInLaunchEnvIsTheUsersAndTheIntegrationStillWorks(t *testing.T) {
	shell := integrationShell(t, "fish")
	f := newIntegrationFixture(t, "fish", shell)
	f.m.base = func() []string { return userEnvironment(f.home) }
	info, err := f.m.Start(Options{Command: []string{shell}, Cwd: f.home, Cols: 100, Rows: 30, Env: map[string]string{"XDG_DATA_DIRS": "/opt/share:/usr/share"}}, nil)
	require.NoError(t, err)
	f.sink.waitFor(t, info.ID, integrationPrompt)
	assert.Equal(t, IntegrationOn, info.Integration.State)
	f.run(info.ID, "echo $XDG_DATA_DIRS > seen")
	assert.Equal(t, "/opt/share:/usr/share\n", f.fileOf("seen"), "fish sees the value given")
}
