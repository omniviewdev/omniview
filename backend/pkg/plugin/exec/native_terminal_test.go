package exec

import (
	"context"
	"errors"
	"os"
	osexec "os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	"github.com/stretchr/testify/require"
)

func TestNativeLaunchScriptLiteralFieldsAndSelfDeletion(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires a POSIX shell")
	}
	root := t.TempDir()
	directory, err := os.MkdirTemp(root, "private launch '")
	require.NoError(t, err)
	cwd := filepath.Join(root, "working directory '\n$literal")
	require.NoError(t, os.Mkdir(cwd, 0700))
	executable := filepath.Join(root, "CLI name '\nwith spaces")
	require.NoError(t, os.WriteFile(executable, []byte("#!/bin/sh\nprintf '%s\\0' \"$@\" \"$LITERAL\" \"$EMPTY\" \"$PWD\"\n"), 0700))
	command := &execsdk.NativeCommand{
		Executable: executable,
		Args:       []string{"", "a b", "single'quote", "\"double\"", "line\nnext\r\tend", "$(touch NEVER_CREATED); `touch NEVER_CREATED`", "--flag=value"},
		Env:        map[string]string{"LITERAL": "x='quoted'\n$(touch NEVER_CREATED); `false`", "EMPTY": ""},
		Cwd:        cwd,
	}
	path := filepath.Join(directory, "launch.sh")
	require.NoError(t, os.WriteFile(path, []byte(nativeLaunchScript(directory, executable, command)), 0600))
	process := osexec.Command("/bin/sh", path)
	process.Env = append(os.Environ(), "LITERAL=must be replaced", "EMPTY=must be empty")
	output, err := process.Output()
	require.NoError(t, err)
	want := append(append([]string{}, command.Args...), command.Env["LITERAL"], "", cwd)
	require.Equal(t, strings.Join(want, "\x00")+"\x00", string(output))
	_, err = os.Stat(directory)
	require.ErrorIs(t, err, os.ErrNotExist)
	_, err = os.Stat(filepath.Join(cwd, "NEVER_CREATED"))
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestNativeTerminalLaunchPrivateFileAndCleanup(t *testing.T) {
	for _, application := range []string{"terminal", "iterm2"} {
		for _, failed := range []bool{false, true} {
			t.Run(application+map[bool]string{false: "/success", true: "/failure"}[failed], func(t *testing.T) {
				root := t.TempDir()
				calls := 0
				launcher := macNativeTerminal{platform: "darwin", tempRoot: root, lookPath: func(name string) (string, error) {
					require.Equal(t, "fixture-cli", name)
					return "/fixture/bin/cli with spaces", nil
				}}
				launcher.resolveApplication = func(_ context.Context, bundleID string) (string, error) {
					calls++
					bundle, err := nativeApplicationID(application)
					require.NoError(t, err)
					require.Equal(t, bundle, bundleID)
					return "/Applications/Fixture 'quoted'.app", nil
				}
				launcher.runScript = func(ctx context.Context, script string) (string, error) {
					calls++
					entries, err := os.ReadDir(root)
					require.NoError(t, err)
					require.Len(t, entries, 1)
					directory := filepath.Join(root, entries[0].Name())
					info, err := os.Stat(directory)
					require.NoError(t, err)
					require.Equal(t, os.FileMode(0700), info.Mode().Perm())
					path := filepath.Join(directory, "launch.sh")
					info, err = os.Stat(path)
					require.NoError(t, err)
					require.Equal(t, os.FileMode(0600), info.Mode().Perm())
					body, err := os.ReadFile(path)
					require.NoError(t, err)
					require.Contains(t, string(body), "'/fixture/bin/cli with spaces' 'literal;not source'")
					require.Equal(t, nativeAppleScript(application, "/Applications/Fixture 'quoted'.app", path), script)
					if failed {
						return "", nativeScriptFailure{denied: true}
					}
					return "", nil
				}
				err := launcher.Launch(context.Background(), application, &execsdk.NativeCommand{Executable: "fixture-cli", Args: []string{"literal;not source"}})
				require.Equal(t, 2, calls)
				entries, readErr := os.ReadDir(root)
				require.NoError(t, readErr)
				if failed {
					require.Equal(t, "FORBIDDEN", resourcev2.ErrorCode(err))
					require.Empty(t, entries)
				} else {
					require.NoError(t, err)
					require.Len(t, entries, 1, "script stays private until the new process starts")
				}
			})
		}
	}
}

func TestNativeTerminalFailuresDoNotLaunch(t *testing.T) {
	for _, test := range []struct {
		name        string
		change      func(*macNativeTerminal, *execsdk.NativeCommand)
		application string
		code        string
	}{
		{"platform", func(m *macNativeTerminal, _ *execsdk.NativeCommand) { m.platform = "linux" }, "terminal", "UNSUPPORTED"},
		{"application", nil, "shell command", "INVALID_REQUEST"},
		{"invalid plan", func(_ *macNativeTerminal, p *execsdk.NativeCommand) { p.Args = []string{"nul\x00"} }, "terminal", "INVALID_REQUEST"},
		{"missing CLI", func(m *macNativeTerminal, _ *execsdk.NativeCommand) {
			m.lookPath = func(string) (string, error) { return "", os.ErrNotExist }
		}, "terminal", "UNAVAILABLE"},
		{"missing cwd", func(_ *macNativeTerminal, p *execsdk.NativeCommand) { p.Cwd = "/nonexistent-native-fixture" }, "terminal", "UNAVAILABLE"},
		{"relative cwd", func(_ *macNativeTerminal, p *execsdk.NativeCommand) { p.Cwd = "." }, "terminal", "UNAVAILABLE"},
		{"file cwd", func(_ *macNativeTerminal, p *execsdk.NativeCommand) {
			p.Cwd = filepath.Join(t.TempDir(), "file")
			require.NoError(t, os.WriteFile(p.Cwd, nil, 0600))
		}, "terminal", "UNAVAILABLE"},
		{"missing app", func(m *macNativeTerminal, _ *execsdk.NativeCommand) {
			m.resolveApplication = func(context.Context, string) (string, error) { return "", errors.New("private diagnostic") }
		}, "terminal", "UNAVAILABLE"},
		{"denied app", func(m *macNativeTerminal, _ *execsdk.NativeCommand) {
			m.runScript = func(context.Context, string) (string, error) { return "", nativeScriptFailure{denied: true} }
		}, "terminal", "FORBIDDEN"},
		{"timeout", func(m *macNativeTerminal, _ *execsdk.NativeCommand) {
			m.resolveApplication = func(context.Context, string) (string, error) { return "", context.DeadlineExceeded }
		}, "terminal", "UNAVAILABLE"},
		{"temp directory", func(m *macNativeTerminal, _ *execsdk.NativeCommand) {
			m.tempRoot = filepath.Join(t.TempDir(), "missing")
		}, "terminal", "UNAVAILABLE"},
	} {
		t.Run(test.name, func(t *testing.T) {
			launcher := macNativeTerminal{platform: "darwin", tempRoot: t.TempDir(), lookPath: func(string) (string, error) { return "/fixture/cli", nil }}
			launcher.resolveApplication = func(context.Context, string) (string, error) { return "/Applications/Fixture.app", nil }
			calls := 0
			launcher.runScript = func(context.Context, string) (string, error) { calls++; return "", nil }
			plan := &execsdk.NativeCommand{Executable: "fixture-cli"}
			if test.change != nil {
				test.change(&launcher, plan)
			}
			err := launcher.Launch(context.Background(), test.application, plan)
			require.Equal(t, test.code, resourcev2.ErrorCode(err))
			require.NotContains(t, err.Error(), "private diagnostic")
			require.LessOrEqual(t, calls, 1)
		})
	}
}

func TestNativeAutomationErrorsAndOutputBounds(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(nativeAutomationError(ctx, errors.New("private"), false)))
	require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(nativeAutomationError(context.Background(), errors.New("private"), false)))
	require.Equal(t, "FORBIDDEN", resourcev2.ErrorCode(nativeAutomationError(context.Background(), nativeScriptFailure{denied: true}, false)))
	var output nativeScriptOutput
	data := []byte(strings.Repeat("x", 32<<10))
	n, err := output.Write(data)
	require.NoError(t, err)
	require.Len(t, data, n)
	require.Equal(t, 16<<10, output.text.Len())
	n, err = output.Write([]byte("ignored"))
	require.NoError(t, err)
	require.Equal(t, 7, n)
	require.Equal(t, 16<<10, output.text.Len())
}
