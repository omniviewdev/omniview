//go:build server && !windows

package streamroute

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	"github.com/omniviewdev/omniview/backend/window"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// S3 OF THE REVIEW OF PR 704. The protocol document told the UI to keep the capability in the host's window-state slot, and that slot
// is the one place where every window and every caller can read it: GetState and ListStates take a window name and check no caller
// (in the server build every page is named main), and windows.json keeps the slots on disk in plaintext. The host itself never puts
// a capability there, and this test is what keeps it so: the real window service, made on the route's application as main.go makes
// it, is asked everything it can be asked about state after every step of the life of two channel terminals, which run through the
// real route and the real bindings, and not one answer may hold a capability, nor the session file once the service has written it.
//
// A guard that finds nothing proves nothing, so it is shown to look: a harmless slot is saved first and is in the answers and in the
// file, and the runner of the negative controls (docs/ui-next/status/T3-channel/mutate.py.txt) puts the capability in a slot, as the
// old document advised, in a scratch copy of this test, and the test must fail by the assertion that looks.

// controlOffVariable names the assertions that the runner of the negative controls switches off, as in the tests of the terminal and
// exec packages.
const controlOffVariable = "TERMINAL_CHANNEL_CONTROL_OFF"

// guarded runs the assertion that a negative control is named for, unless the runner has switched it off.
func guarded(t *testing.T, name string, assertion func()) {
	t.Helper()
	if slices.Contains(strings.Split(os.Getenv(controlOffVariable), ","), name) {
		return
	}
	assertion()
}

// marker is what the harmless slot holds: a JSON string, which the session file keeps and the answers return.
const marker = `"a-harmless-marker"`

// windowState is a window service as main.go makes it, on the route's application and with its session file in a directory of the
// test, and the capabilities that the test has seen: what it asks, and whether any answer holds one of them.
type windowState struct {
	t            *testing.T
	service      *window.Service
	sessionPath  string
	capabilities []string
}

func newWindowState(t *testing.T) *windowState {
	t.Helper()
	theRoute(t) // the application is made once for the process
	sessionPath := filepath.Join(t.TempDir(), window.SessionFileName)
	mainWindow := application.NewWindow(application.WebviewWindowOptions{Name: window.MainWindowName})
	service := window.NewService(route.app, mainWindow, window.ServiceOptions{
		WindowTemplate: application.WebviewWindowOptions{}, SessionPath: sessionPath, Log: logging.NewNop(),
	})
	t.Cleanup(func() { _ = service.ServiceShutdown() })
	return &windowState{t: t, service: service, sessionPath: sessionPath, capabilities: nil}
}

// know says the test has seen a capability: no answer may hold it from now on.
func (w *windowState) know(capability string) {
	w.capabilities = append(w.capabilities, capability)
}

func encode(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	require.NoError(t, err)
	return string(raw)
}

// answers is everything the window service says about state: the slots of every window it lists, and of main, and every window's
// slots at once.
func (w *windowState) answers() map[string]string {
	w.t.Helper()
	names := []string{window.MainWindowName}
	for _, info := range w.service.List() {
		if !slices.Contains(names, info.Name) {
			names = append(names, info.Name)
		}
	}
	out := make(map[string]string, len(names)+1)
	for _, name := range names {
		slots, err := w.service.GetState(name)
		require.NoError(w.t, err)
		out["GetState("+name+")"] = encode(w.t, slots)
	}
	out["ListStates()"] = encode(w.t, w.service.ListStates())
	return out
}

// holds says whether an answer has the capability in it. (The capability is never handed to an assertion that would print it.)
func holds(answer, capability string) bool { return strings.Contains(answer, capability) }

// check asks the window service, after a step, and says what the step was if an answer holds a capability.
func (w *windowState) check(step string) {
	w.t.Helper()
	guarded(w.t, "no-window-state-holds-the-capability", func() {
		for call, answer := range w.answers() {
			for _, capability := range w.capabilities {
				assert.False(w.t, holds(answer, capability), "after %s: the answer of %s holds the capability of a channel terminal", step, call)
			}
		}
	})
}

// flushed writes the session file, as the host does when it quits, and checks that it holds what was saved and no capability.
func (w *windowState) flushed() {
	w.t.Helper()
	require.NoError(w.t, w.service.ServiceShutdown(), "the session is written")
	raw, err := os.ReadFile(w.sessionPath)
	require.NoError(w.t, err, "the session file exists, because a slot was saved")
	require.Contains(w.t, string(raw), strings.Trim(marker, `"`), "and it holds the slot that was saved: a search of a file that holds nothing proves nothing")
	guarded(w.t, "no-window-state-holds-the-capability", func() {
		for _, capability := range w.capabilities {
			assert.False(w.t, holds(string(raw), capability), "windows.json holds the capability of a channel terminal")
		}
	})
}

func TestNoWindowStateCallReturnsTheCapabilityOfAChannelTerminalAtAnyStepOfItsLife(t *testing.T) {
	port, wrapper := theRoute(t)
	state := newWindowState(t)
	require.NoError(t, state.service.SaveState(window.MainWindowName, "marker", marker))
	slots, err := state.service.GetState(window.MainWindowName)
	require.NoError(t, err)
	require.Equal(t, marker, slots["marker"], "the window service answers what a page saved: the check below is looking at the real thing")
	state.check("a harmless slot was saved")

	// A terminal that a page lives with: create, attach, type, list, ask, drop, attach again by the offset, close.
	info := startTerminal(t, wrapper, "sh", "-c", "cat")
	state.know(info.Cap)
	state.check("the create of a channel terminal")

	page := dial(t, port)
	page.write(attach(info.Cap, nil))
	page.until("ready", func(s *streamState) bool { return s.ready != nil })
	state.check("the attach of a stream")

	page.write(append([]byte{pInput}, "hello\n"...))
	echoed := page.until("the echo", func(s *streamState) bool { return bytes.Count(s.output, []byte("hello\r\n")) >= 2 })
	end := echoed.next
	state.check("the input and its echo")

	listed, err := wrapper.ListChannelTerminals([]string{info.Cap})
	require.NoError(t, err)
	require.Len(t, listed, 1)
	state.check("ListChannelTerminals")
	_, err = wrapper.ChannelTerminalBusy(info.Cap)
	require.NoError(t, err)
	state.check("ChannelTerminalBusy")
	_, err = wrapper.ChannelTerminalCwd(info.Cap)
	require.NoError(t, err)
	state.check("ChannelTerminalCwd")
	_, err = wrapper.ChannelTerminalCommands(info.Cap)
	require.NoError(t, err)
	state.check("ChannelTerminalCommands")
	_, err = wrapper.ChannelTerminalResolveLink(info.Cap, "", "a.go")
	require.NoError(t, err)
	state.check("ChannelTerminalResolveLink")

	require.NoError(t, page.conn.CloseNow(), "the page is gone, with no frame to say so")
	waitListed(t, wrapper, info.Cap, func(l terminal.ChannelListed) bool { return !l.Attached })
	state.check("the stream dropped and the terminal detached")

	again := dial(t, port)
	again.write(attach(info.Cap, &end))
	again.until("ready", func(s *streamState) bool { return s.ready != nil })
	state.check("the stream that attaches again by its offset")

	require.NoError(t, wrapper.CloseChannelTerminal(info.Cap))
	again.until("the end", func(s *streamState) bool { return s.ended >= 1 })
	state.check("CloseChannelTerminal")

	// A terminal that ends by itself leaves its end, which a stream reads and the page dismisses.
	bye := startTerminal(t, wrapper, "sh", "-c", `printf 'bye\n'; exit 0`)
	state.know(bye.Cap)
	state.check("the create of a terminal that ends by itself")
	waitListed(t, wrapper, bye.Cap, func(l terminal.ChannelListed) bool { return l.Ended != nil })
	state.check("the end of a terminal is kept")
	last := dial(t, port)
	last.write(attach(bye.Cap, nil))
	last.until("the kept end", func(s *streamState) bool { return s.ended >= 1 })
	state.check("a stream that attaches to the kept end")
	require.NoError(t, wrapper.DismissChannelTerminal(bye.Cap))
	state.check("DismissChannelTerminal")

	state.flushed()
}
