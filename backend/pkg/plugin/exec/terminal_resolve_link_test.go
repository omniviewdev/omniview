//go:build !windows

package exec

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// THE RESOLUTION OF A LINK AT THE EXEC LANE (issue #696 step 3): the call is bound to a capability like the channel's other calls, resolves against where
// the shell is, and holds nothing of the user's text in a log line, a span or an error.

func (fx *terminalFixture) openChannelIn(dir string) *terminal.Session {
	fx.t.Helper()
	info, err := fx.wrapper.CreateTerminal(context.Background(), execsdk.SessionOptions{Command: append(shell(fx.t), "-c", "sleep 600")}, terminal.Launch{Channel: true, Cwd: dir})
	require.NoError(fx.t, err)
	return info
}

func realTemp(t *testing.T, files ...string) string {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	for _, name := range files {
		require.NoError(t, os.MkdirAll(filepath.Dir(filepath.Join(root, name)), 0o750))
		require.NoError(t, os.WriteFile(filepath.Join(root, name), []byte("x"), 0o600))
	}
	return root
}

func TestALinkResolvesAgainstWhereTheShellIsAndOnlyAgainstADirectoryTheShellVouchesFor(t *testing.T) {
	here := realTemp(t, "src/a.go")
	elsewhere := realTemp(t, "src/a.go", "src/only_there.go")
	fx := newTerminalFixture(t)
	info := fx.openChannelIn(here)

	got, err := fx.wrapper.ChannelTerminalResolveLink(info.Cap, "", "src/a.go:12:3")
	require.NoError(t, err)
	assert.Equal(t, terminal.LinkResolution{Kind: terminal.LinkFile, Path: filepath.Join(here, "src/a.go"), Line: 12, Col: 3}, got, "the control: the file is where the shell is")

	got, err = fx.wrapper.ChannelTerminalResolveLink(info.Cap, "", "src/b.go:12:3")
	require.NoError(t, err)
	assert.Equal(t, terminal.UnknownLink(terminal.LinkNotFound), got, "the same text with no such file")

	got, err = fx.wrapper.ChannelTerminalResolveLink(info.Cap, "", "src/only_there.go:1")
	require.NoError(t, err)
	assert.Equal(t, terminal.UnknownLink(terminal.LinkNotFound), got, "a file of another directory is not a link")

	got, err = fx.wrapper.ChannelTerminalResolveLink(info.Cap, elsewhere, "src/only_there.go:1")
	require.NoError(t, err)
	assert.Equal(t, terminal.UnknownLink(terminal.LinkUnvouched), got, "a directory that the page names alone is not looked in")

	got, err = fx.wrapper.ChannelTerminalResolveLink(info.Cap, here, "src/a.go")
	require.NoError(t, err)
	assert.Equal(t, terminal.LinkFile, got.Kind, "the control: the directory the shell is in is one it vouches for")

	for _, text := range []string{"/dev/null", "/proc/self/cwd", "../../../etc/passwd", "http://localhost:8080/", "a\x1b[31mb.go", strings.Repeat("a", 5000)} {
		got, err = fx.wrapper.ChannelTerminalResolveLink(info.Cap, "", text)
		require.NoError(t, err)
		assert.Equal(t, terminal.LinkUnknown, got.Kind, "%.20q", text)
	}
}

func TestACapabilityThatOpensNothingResolvesNothing(t *testing.T) {
	here := realTemp(t, "a.go")
	fx := newTerminalFixture(t)
	info := fx.openChannelIn(here)
	for _, wrong := range []string{"", "x", info.ID, info.Cap + "A", info.Cap[1:]} {
		_, err := fx.wrapper.ChannelTerminalResolveLink(wrong, "", "a.go")
		require.Error(t, err, "%q", wrong)
		assert.Equal(t, terminal.ChannelNotFound().Error(), err.Error())
	}
	got, err := fx.wrapper.ChannelTerminalResolveLink(info.Cap, "", "a.go")
	require.NoError(t, err)
	assert.Equal(t, terminal.LinkFile, got.Kind, "the control")
}

// A secret in a file name is in no log line, no span and no error: it is in the answer to the caller and nowhere else.
func TestASecretInAFileNameAppearsInNoLogLineSpanOrError(t *testing.T) {
	const secret = "s3cr3t-CANARY-9f2c1d"
	here := realTemp(t, "dir-"+secret+"/file-"+secret+".go")
	spans := captureSpans(t)
	sink := &logtest.RecordingSink{}
	logger := logging.New(logging.Config{Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug)})
	fx := newTerminalFixtureLogged(t, logger)
	info := fx.openChannelIn(here)

	var seen []string
	for _, text := range []string{"dir-" + secret + "/file-" + secret + ".go:4", "dir-" + secret + "/nope-" + secret + ".go", "/dev/" + secret, "http://" + secret + "/", "a\x1b" + secret} {
		got, err := fx.wrapper.ChannelTerminalResolveLink(info.Cap, "", text)
		require.NoError(t, err)
		if strings.HasPrefix(text, "dir-"+secret+"/file") {
			require.Equal(t, terminal.LinkFile, got.Kind, "the control: the name is found, and the answer holds it")
			require.Contains(t, got.Path, secret)
		}
	}
	_, err := fx.wrapper.ChannelTerminalResolveLink("wrong-"+secret, "/"+secret, "file-"+secret)
	require.Error(t, err)
	seen = append(seen, "an error: "+err.Error())
	for _, record := range sink.Records() {
		seen = append(seen, fmt.Sprint("a log line: ", record.Message, record.Fields))
	}
	ended := spans.GetSpans()
	var resolveSpans int
	for _, span := range ended {
		if span.Name == "exec.ChannelTerminalResolveLink" {
			resolveSpans++
		}
		seen = append(seen, fmt.Sprint("a span: ", span.Name, span.Attributes, span.Status, span.Events, span.Links))
	}
	require.Equal(t, 6, resolveSpans, "the control: the spans of the calls were recorded, so the test heard them")
	for _, line := range seen {
		assert.NotContains(t, line, secret, "the secret is in %.200s", line)
	}
}
