package plugin

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The fixture executable is what every process test of this package launches as a
// plugin, on every OS, so what it does is pinned here: each behaviour a test asks
// for is run for real and its effect read back. A fixture that did not exit when
// told to, or did not forward its child's streams and status, would turn every
// test built on it into a hang or a false pass.

const (
	fixtureChildEnv  = "OMNIVIEW_FIXTURE_SELFTEST_CHILD"
	fixtureChildExit = 5
)

// TestPluginFixtureSelfTestChildProcess is the process the fixture runs in the
// tests below. It does nothing in a normal run.
func TestPluginFixtureSelfTestChildProcess(_ *testing.T) {
	mode := os.Getenv(fixtureChildEnv)
	if mode == "" {
		return
	}
	_, removedSet := os.LookupEnv("FIXTURE_SELFTEST_REMOVED")
	_, _ = fmt.Fprintf(os.Stdout, "added=%s removed=%t args=%d\n", os.Getenv("FIXTURE_SELFTEST_ADDED"), removedSet, len(os.Args))
	if mode == "hang" {
		_, _ = fmt.Fprintln(os.Stdout, "ready")
		time.Sleep(time.Minute)
	}
	os.Exit(fixtureChildExit)
}

func startPluginFixture(t *testing.T, behaviour *pluginFixtureBehaviour) *exec.Cmd {
	t.Helper()
	binary, err := os.Executable()
	require.NoError(t, err)
	t.Setenv("FIXTURE_SELFTEST_BINARY", binary)
	executable := writePluginFixture(t, filepath.Join(t.TempDir(), "bin"), behaviour)
	return exec.Command(executable)
}

func TestPluginFixtureWithNoBehaviourExitsAtOnceWithStatusZero(t *testing.T) {
	command := startPluginFixture(t, nil)
	output, err := command.CombinedOutput()
	require.NoError(t, err, "%s", output)
	assert.Empty(t, string(output))
}

func TestPluginFixtureExitsWithTheStatusItIsGiven(t *testing.T) {
	command := startPluginFixture(t, &pluginFixtureBehaviour{ExitCode: 3})
	err := command.Run()
	var exit *exec.ExitError
	require.ErrorAs(t, err, &exit)
	assert.Equal(t, 3, exit.ExitCode())
}

func TestPluginFixtureStaysAliveUntilItIsKilled(t *testing.T) {
	command := startPluginFixture(t, &pluginFixtureBehaviour{SleepSeconds: 60})
	require.NoError(t, command.Start())
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	select {
	case err := <-done:
		t.Fatalf("a fixture told to hang ended by itself: %v", err)
	case <-time.After(500 * time.Millisecond):
	}
	require.NoError(t, command.Process.Kill())
	select {
	case waitErr := <-done:
		var exit *exec.ExitError
		require.ErrorAs(t, waitErr, &exit, "a killed process ends with an exit error")
	case <-time.After(10 * time.Second):
		t.Fatal("a killed fixture did not end")
	}
}

func TestPluginFixtureWritesRecordsExpandsAndRunsItsCommand(t *testing.T) {
	dir := t.TempDir()
	record := filepath.Join(dir, "record")
	t.Setenv("FIXTURE_SELFTEST_FILE", record)
	t.Setenv("FIXTURE_SELFTEST_SET", "value")
	t.Setenv("FIXTURE_SELFTEST_EMPTY", "")
	t.Setenv("FIXTURE_SELFTEST_REMOVED", "to be removed")
	t.Setenv(fixtureChildEnv, "exit")
	added := "added:${FIXTURE_SELFTEST_SET}"
	behaviour := pluginFixtureRunsTestBinary("FIXTURE_SELFTEST_BINARY", "TestPluginFixtureSelfTestChildProcess")
	behaviour.Records = []pluginFixtureRecord{{
		File: "${FIXTURE_SELFTEST_FILE}",
		Text: "${FIXTURE_SELFTEST_SET}|${FIXTURE_SELFTEST_UNSET-unset}|${FIXTURE_SELFTEST_EMPTY-kept}|${FIXTURE_SELFTEST_EMPTY:-empty}|" +
			"${FIXTURE_SELFTEST_SET:+set:-unset}|${FIXTURE_SELFTEST_EMPTY:+set:-unset}|${FIXTURE_SELFTEST_UNSET:+set}|$$",
	}}
	behaviour.Env = map[string]*string{"FIXTURE_SELFTEST_ADDED": &added, "FIXTURE_SELFTEST_REMOVED": nil}
	command := startPluginFixture(t, behaviour)
	var stdout strings.Builder
	command.Stdout = &stdout

	err := command.Run()

	var exit *exec.ExitError
	require.ErrorAs(t, err, &exit, "the status of the command it ran is the fixture's own")
	assert.Equal(t, fixtureChildExit, exit.ExitCode())
	assert.Equal(t, "added=added:value removed=false args=2\n", strings.ReplaceAll(stdout.String(), "\r\n", "\n"),
		"the command's output reaches the process that started the fixture, with the variables the fixture set and removed")
	written, err := os.ReadFile(record)
	require.NoError(t, err)
	assert.Equal(t, "value|unset||empty|set|unset||$", string(written))
}

// TestPluginFixtureEndsItsCommandWhenItIsKilled holds the property the channel
// tests rely on for cleanup: the host kills the process it started, and what that
// process runs must not outlive it (on Unix the two are one process; on Windows
// the fixture is the parent and ends its child through a job object). The command
// holds the write end of the pipe this test reads, so the pipe reaches its end
// only when no process that holds it is left.
func TestPluginFixtureEndsItsCommandWhenItIsKilled(t *testing.T) {
	t.Setenv(fixtureChildEnv, "hang")
	command := startPluginFixture(t, pluginFixtureRunsTestBinary("FIXTURE_SELFTEST_BINARY", "TestPluginFixtureSelfTestChildProcess"))
	read, write, err := os.Pipe()
	require.NoError(t, err)
	defer read.Close()
	command.Stdout = write
	require.NoError(t, command.Start())
	require.NoError(t, write.Close())
	reaped := make(chan struct{})
	go func() { _ = command.Wait(); close(reaped) }()
	t.Cleanup(func() { _ = command.Process.Kill(); <-reaped })

	lines := bufio.NewScanner(read)
	started := false
	for !started && lines.Scan() {
		started = lines.Text() == "ready"
	}
	require.True(t, started, "the command must have started")
	require.NoError(t, command.Process.Kill())

	ended := make(chan error, 1)
	go func() { _, copyErr := io.Copy(io.Discard, read); ended <- copyErr }()
	select {
	case copyErr := <-ended:
		require.NoError(t, copyErr)
	case <-time.After(15 * time.Second):
		t.Fatal("the command the fixture ran outlived the fixture")
	}
}
