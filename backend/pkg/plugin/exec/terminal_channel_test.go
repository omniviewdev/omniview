//go:build !windows

package exec

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// THE CHANNEL TERMINAL AT THE EXEC LANE (docs/ui-next/terminal-channel-protocol.md).
//
// A terminal opened with launch.channel is reached by a capability and a stream, and by nothing else: it is invisible to the
// calls that name a terminal by its id, it sends no event of the events lane, it has no window, and the capability is nowhere
// the host writes. These tests drive it through the wrapper a page calls, with the host's window realm, controller and manager.

// pipeChannel is a stream as the exec lane serves it: the host's end is a terminal.Channel, and the page's end is the test.
type pipeChannel struct {
	mu     sync.Mutex
	cond   *sync.Cond
	toPage [][]byte
	toHost [][]byte
	closed bool
	done   chan struct{}
}

func newPipeChannel(t *testing.T) *pipeChannel {
	t.Helper()
	p := &pipeChannel{mu: sync.Mutex{}, toPage: nil, toHost: nil, closed: false, done: make(chan struct{})}
	p.cond = sync.NewCond(&p.mu)
	t.Cleanup(func() { _ = p.Close() })
	return p
}

func (p *pipeChannel) Send(frame []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return errors.New("closed")
	}
	p.toPage = append(p.toPage, frame)
	p.cond.Broadcast()
	return nil
}

func (p *pipeChannel) Recv() ([]byte, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for len(p.toHost) == 0 && !p.closed {
		p.cond.Wait()
	}
	if p.closed {
		return nil, errors.New("closed")
	}
	frame := p.toHost[0]
	p.toHost = p.toHost[1:]
	return frame, nil
}

func (p *pipeChannel) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.closed {
		p.closed = true
		close(p.done)
	}
	p.cond.Broadcast()
	return nil
}

func (p *pipeChannel) Done() <-chan struct{} { return p.done }

func (p *pipeChannel) page(frame []byte) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.closed {
		p.toHost = append(p.toHost, slices.Clone(frame))
	}
	p.cond.Broadcast()
}

func (p *pipeChannel) frames() [][]byte {
	p.mu.Lock()
	defer p.mu.Unlock()
	return slices.Clone(p.toPage)
}

// text is what the host sent as output, in order, and whether the stream was told how the terminal ended.
func (p *pipeChannel) text() (string, bool) {
	var out strings.Builder
	ended := false
	for _, frame := range p.frames() {
		switch {
		case len(frame) >= 9 && frame[0] == 0x82:
			out.Write(frame[9:])
		case len(frame) >= 1 && frame[0] == 0x84:
			ended = true
		}
	}
	return out.String(), ended
}

func (p *pipeChannel) waitText(t *testing.T, want string) string {
	t.Helper()
	var got string
	require.Eventually(t, func() bool { got, _ = p.text(); return strings.Contains(got, want) }, 30*time.Second, 2*time.Millisecond,
		"the stream never carried %q", want)
	return got
}

func (p *pipeChannel) waitEnded(t *testing.T) {
	t.Helper()
	require.Eventually(t, func() bool { _, ended := p.text(); return ended }, 30*time.Second, 2*time.Millisecond, "the stream never carried the end")
}

func attachRequest(capability string) []byte {
	return append([]byte{0x01}, fmt.Sprintf(`{"v":1,"cap":%q}`, capability)...)
}

// openChannel opens a channel terminal through the wrapper for a call that comes from window (none: no window).
func (fx *terminalFixture) openChannel(window application.Window, script string) *terminal.Session {
	fx.t.Helper()
	ctx := context.Background()
	if window != nil {
		ctx = fx.ctx(window)
	}
	info, err := fx.wrapper.CreateTerminal(ctx, execsdk.SessionOptions{Command: append(shell(fx.t), "-c", script)}, terminal.Launch{Channel: true})
	require.NoError(fx.t, err)
	require.NotEmpty(fx.t, info.Cap, "a channel terminal is answered its capability")
	return info
}

// serve serves a stream that shows the capability, on a goroutine of its own, and returns the page's end of it.
func (fx *terminalFixture) serve(capability string) *pipeChannel {
	fx.t.Helper()
	ch := newPipeChannel(fx.t)
	go fx.ctrl.ServeTerminalChannel(ch)
	ch.page(attachRequest(capability))
	return ch
}

// controlOffVariable names the controls the runner switches off (docs/ui-next/status/T3-channel/mutate.py.txt); the terminal
// package's tests read the same variable.
const controlOffVariable = "TERMINAL_CHANNEL_CONTROL_OFF"

// guarded runs the assertion that a negative control is named for: the runner puts a fault in a scratch copy of the source and
// expects the test to fail in this assertion, and then switches it off and expects the same fault to pass undetected.
func guarded(t *testing.T, name string, assertion func()) {
	t.Helper()
	if slices.Contains(strings.Split(os.Getenv(controlOffVariable), ","), name) {
		return
	}
	assertion()
}

// Every binding of the wrapper is of one of three kinds as far as a channel terminal is concerned: it names a terminal by its id
// (and a channel terminal is not found by it), it names one by its capability, or it names none. A binding that is added has to
// be put in one of them, which is how a new way to reach a terminal by its id cannot slip past the isolation.
func channelBindingKinds() ([]string, []string, []string) {
	byID := []string{
		"GetSession", "AttachSession", "DetachSession", "WriteSession", "CloseSession", "ResizeSession", "WriteTerminal",
		"ResizeTerminal", "IsBusy", "GetCwd", "AckTerminal", "AttachTerminal", "DetachTerminal",
	}
	byCapability := []string{"CloseChannelTerminal", "ChannelTerminalBusy", "ChannelTerminalCwd", "ListChannelTerminals", "DismissChannelTerminal"}
	unrelated := []string{
		"ServiceStartup", "ServiceShutdown", "CreateSession", "OpenNativeSession", "GetNativeTerminalSupport", "GetNativeTerminalApplications",
		"CreateTerminal", "ListTerminalShells", "ListSessions", "ListTerminals", "GetHandler", "GetHandlers", "GetPluginHandlers", "ListPlugins", "HasPlugin",
	}
	return byID, byCapability, unrelated
}

func TestEveryBindingOfTheWrapperIsClassifiedForTheChannelIsolation(t *testing.T) {
	byID, byCapability, unrelated := channelBindingKinds()
	known := map[string]string{}
	for kind, names := range map[string][]string{"by id": byID, "by capability": byCapability, "unrelated": unrelated} {
		for _, name := range names {
			require.NotContains(t, known, name, "%s is in two kinds", name)
			known[name] = kind
		}
	}
	wrapper := reflect.TypeOf(&ServiceWrapper{})
	var unclassified, vanished []string
	seen := map[string]bool{}
	for i := range wrapper.NumMethod() {
		name := wrapper.Method(i).Name
		seen[name] = true
		if _, ok := known[name]; !ok {
			unclassified = append(unclassified, name)
		}
	}
	for name := range known {
		if !seen[name] {
			vanished = append(vanished, name)
		}
	}
	sort.Strings(unclassified)
	sort.Strings(vanished)
	assert.Empty(t, unclassified, "a binding that is not classified: decide whether it names a terminal by its id, and test it in the isolation matrix")
	assert.Empty(t, vanished, "a classified binding that is no longer there: update the lists")
}

// A channel terminal is invisible to every binding that names a terminal by its id, for the window that made it, for another
// window and for a call that comes from none: each answers what an id that never was gets, in the same words, nothing of it is
// listed, and none of the calls touched the shell. The new calls of the lane are the only way to it.
func TestAChannelTerminalIsInvisibleToEveryBindingThatNamesATerminalByItsId(t *testing.T) {
	fx := newTerminalFixture(t)
	owner, other := fx.page(1), fx.page(2)
	info := fx.openChannel(owner, `stty -echo; printf 'up\n'; cat`)
	id := info.ID

	calls := map[string]func(ctx context.Context, id string) error{
		"GetSession":     func(_ context.Context, id string) error { _, err := fx.wrapper.GetSession(id); return err },
		"AttachSession":  func(_ context.Context, id string) error { _, _, err := fx.wrapper.AttachSession(id); return err },
		"DetachSession":  func(_ context.Context, id string) error { _, err := fx.wrapper.DetachSession(id); return err },
		"WriteSession":   func(_ context.Context, id string) error { return fx.wrapper.WriteSession(id, []byte("x\n")) },
		"CloseSession":   func(_ context.Context, id string) error { return fx.wrapper.CloseSession(id) },
		"ResizeSession":  func(_ context.Context, id string) error { return fx.wrapper.ResizeSession(id, 30, 90) },
		"WriteTerminal":  func(_ context.Context, id string) error { return fx.wrapper.WriteTerminal(id, 0, []byte("x\n")) },
		"ResizeTerminal": func(_ context.Context, id string) error { return fx.wrapper.ResizeTerminal(id, 0, 30, 90) },
		"IsBusy":         func(_ context.Context, id string) error { _, err := fx.wrapper.IsBusy(id); return err },
		"GetCwd":         func(_ context.Context, id string) error { _, err := fx.wrapper.GetCwd(id); return err },
		"AckTerminal":    func(_ context.Context, id string) error { return fx.wrapper.AckTerminal(id, 1) },
		"AttachTerminal": func(ctx context.Context, id string) error {
			_, err := fx.wrapper.AttachTerminal(ctx, id, terminal.AttachRequest{PageKey: keyA})
			return err
		},
		"DetachTerminal": func(ctx context.Context, id string) error {
			_, err := fx.wrapper.DetachTerminal(ctx, id, terminal.DetachRequest{PageKey: keyA})
			return err
		},
	}
	byID, _, _ := channelBindingKinds()
	names := make([]string, 0, len(calls))
	for name := range calls {
		names = append(names, name)
	}
	sort.Strings(names)
	sort.Strings(byID)
	require.Equal(t, byID, names, "the matrix drives exactly the bindings that name a terminal by its id")

	contexts := map[string]context.Context{
		"the window that made it": fx.ctx(owner),
		"another window":          fx.ctx(other),
		"no window":               context.Background(),
	}
	guarded(t, "exec-legacy-invisible", func() {
		for who, ctx := range contexts {
			for name, call := range calls {
				got := call(ctx, id)
				ghost := call(ctx, "ghost")
				require.Error(t, got, "%s, %s", name, who)
				require.Error(t, ghost, "%s, %s", name, who)
				assert.Equal(t, strings.ReplaceAll(ghost.Error(), "ghost", id), got.Error(), "%s, %s: the words of an id that never was", name, who)
			}
		}
	})
	sessions, err := fx.wrapper.ListSessions()
	require.NoError(t, err)
	for _, listed := range sessions {
		assert.NotEqual(t, id, listed.ID, "a channel terminal is not a session of the events lane")
	}
	for _, key := range []string{"", keyA, keyB} {
		for _, window := range []application.Window{owner, other} {
			listed := fx.listed(window, key)
			assert.Empty(t, listed, "no page lists a channel terminal, whatever key it passes")
		}
	}
	assert.Zero(t, fx.indexed(), "the events lane's index has no record of it")

	// The shell was not touched by any of it: what a leaked write would have typed is echoed before this sentinel is.
	stream := fx.serve(info.Cap)
	stream.waitText(t, "up")
	stream.page(append([]byte{0x02}, "S\n"...))
	got := stream.waitText(t, "S\r\n")
	// A shell that forks a child while the machine is loaded can print a diagnostic of its own before its first line (bash as sh on
	// macOS: "sh: child setpgid (n to n): Operation not permitted"). What the test is for is what came between the shell's line and
	// the sentinel: nothing that a call typed.
	assert.True(t, strings.HasSuffix(got, "up\r\nS\r\n"), "nothing reached the shell but what the stream typed: %q", got)
	busy, err := fx.wrapper.ChannelTerminalBusy(info.Cap)
	require.NoError(t, err)
	assert.Equal(t, terminal.StateBusy, busy.State, "the shell runs cat in the foreground")
	assert.False(t, gone(info.PID))
}

// A create that names the id of a channel terminal is refused as an id in use, as for any session, and the first shell is
// untouched. (An existence answer for a label, not for a capability: the id opens nothing, and nothing broadcasts it.)
func TestACreateThatNamesTheIdOfAChannelTerminalIsRefusedAndTheFirstShellIsUntouched(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	info := fx.openChannel(page, `sleep 600`)
	_, err := fx.openAs(page, terminal.Options{ID: info.ID, Command: shell(t)})
	require.Error(t, err)
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	assert.Equal(t, apperror.TypeResourceConflict, app.Type)
	assert.False(t, gone(info.PID))
	listed, err := fx.wrapper.ListChannelTerminals([]string{info.Cap})
	require.NoError(t, err)
	require.Len(t, listed, 1)
	assert.Equal(t, info.PID, listed[0].PID, "the channel terminal is the first shell")
}

// The five calls of the lane: each answers its terminal for the capability that opens it, and the one not-found for any that opens
// nothing; the list answers only for the capabilities it is given, in the order it is given them, and a list that is too long is
// refused. No call uses a window.
func TestTheFiveNewBindingsAnswerTheOneNotFoundForACapabilityThatOpensNothing(t *testing.T) {
	fx := newTerminalFixture(t)
	a := fx.openChannel(nil, `stty -echo; printf 'up\n'; cat`)
	b := fx.openChannel(nil, `printf 'x\n'; exit 0`)
	require.Eventually(t, func() bool {
		kept, err := fx.wrapper.ListChannelTerminals([]string{b.Cap})
		return err == nil && len(kept) == 1 && kept[0].Ended != nil
	}, 30*time.Second, 2*time.Millisecond, "the end of b is kept")

	wrong := []string{"", "x", strings.Repeat("A", 43), a.Cap[:42], a.Cap + "A", a.ID}
	for _, capability := range wrong {
		for name, call := range map[string]func(string) error{
			"CloseChannelTerminal":   fx.wrapper.CloseChannelTerminal,
			"DismissChannelTerminal": fx.wrapper.DismissChannelTerminal,
			"ChannelTerminalBusy":    func(c string) error { _, err := fx.wrapper.ChannelTerminalBusy(c); return err },
			"ChannelTerminalCwd":     func(c string) error { _, err := fx.wrapper.ChannelTerminalCwd(c); return err },
		} {
			err := call(capability)
			require.Error(t, err, "%s(%q)", name, capability)
			assert.Equal(t, terminal.ChannelNotFound().Error(), err.Error(), "%s: one answer", name)
			if capability != "" {
				assert.NotContains(t, err.Error(), capability, "%s: nothing the caller sent comes back", name)
			}
		}
		listed, err := fx.wrapper.ListChannelTerminals([]string{capability})
		require.NoError(t, err)
		assert.Empty(t, listed)
	}

	cwd, err := fx.wrapper.ChannelTerminalCwd(a.Cap)
	require.NoError(t, err)
	assert.NotEmpty(t, cwd.Path)
	listed, err := fx.wrapper.ListChannelTerminals([]string{b.Cap, "nope", a.Cap})
	require.NoError(t, err)
	require.Len(t, listed, 2, "only for the capabilities that open something, in the order given")
	assert.Equal(t, []string{b.ID, a.ID}, []string{listed[0].ID, listed[1].ID})
	require.NotNil(t, listed[0].Ended, "the end that b left is listed with how it ended")
	_, err = fx.wrapper.ListChannelTerminals(make([]string, terminal.MaxListedCaps+1))
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	assert.Equal(t, "INVALID_REQUEST", app.Code)
	none, err := fx.wrapper.ListChannelTerminals(nil)
	require.NoError(t, err)
	assert.Empty(t, none, "a call that is given no capability answers nothing: nothing is enumerated")

	require.NoError(t, fx.wrapper.DismissChannelTerminal(b.Cap))
	assert.Equal(t, terminal.ChannelNotFound().Error(), fx.wrapper.DismissChannelTerminal(b.Cap).Error())
	require.NoError(t, fx.wrapper.CloseChannelTerminal(a.Cap))
	assert.Equal(t, terminal.ChannelNotFound().Error(), fx.wrapper.CloseChannelTerminal(a.Cap).Error(), "a terminal that was closed is not there to close")
	requireGoneWithin(t, a.PID)
}

func requireGoneWithin(t *testing.T, pid int) {
	t.Helper()
	require.Eventually(t, func() bool { return gone(pid) }, 20*time.Second, 5*time.Millisecond, "the shell (pid %d) is still alive", pid)
}

// The create call: a channel terminal needs no window (it has none) and a terminal of the events lane still does; a channel
// terminal with a page key is refused, naming the field; the rule against a resource request stands for both.
func TestCreateTerminalForAChannelNeedsNoWindowAndTheOtherRulesStand(t *testing.T) {
	fx := newTerminalFixture(t)
	command := append(shell(t), "-c", "sleep 600")

	info, err := fx.wrapper.CreateTerminal(context.Background(), execsdk.SessionOptions{Command: command}, terminal.Launch{Channel: true})
	require.NoError(t, err, "a channel terminal belongs to no window")
	assert.NotEmpty(t, info.Cap)
	assert.Zero(t, fx.indexed(), "and the events lane's index has no record of it")
	assert.Empty(t, fx.ctrl.terminalManager.ListSessions())

	_, err = fx.wrapper.CreateTerminal(context.Background(), execsdk.SessionOptions{Command: command}, terminal.Launch{})
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	assert.Equal(t, apperror.TypeResourceForbidden, app.Type, "a terminal of the events lane still needs a window")

	_, err = fx.wrapper.CreateTerminal(context.Background(), execsdk.SessionOptions{Command: command}, terminal.Launch{Channel: true, PageKey: keyA})
	require.ErrorAs(t, err, &app)
	assert.Equal(t, "INVALID_REQUEST", app.Code)
	assert.Contains(t, app.Detail, "page_key")

	_, err = fx.wrapper.CreateTerminal(context.Background(), execsdk.SessionOptions{
		Command: command, ResourcePlugin: "p", ResourceKey: "k",
	}, terminal.Launch{Channel: true})
	require.Error(t, err)
	assert.Equal(t, resourcev2.NewError("INVALID_REQUEST", "A local terminal cannot execute a resource request.").Error(), err.Error(), "a channel terminal does not execute a resource request either")
}

// A channel terminal sends no event of the events lane, from its first byte to its end and its dismissal: not its output, not its
// CLOSE, not a detachment, none at all. (The same shell started on the events lane does, which shows that the recorder hears.)
func TestAChannelTerminalSendsNoEventOfTheEventsLane(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	plain := fx.open(page, terminal.Options{Command: append(shell(t), "-c", "printf 'plain\\n'")})
	require.Eventually(t, func() bool { return len(fx.closes(plain.ID)) == 1 }, 30*time.Second, 2*time.Millisecond, "the events lane sent its CLOSE")
	require.NotEmpty(t, fx.eventsOf(plain.ID), "the recorder hears the events lane")
	heard := len(fx.eventsOf(plain.ID))

	info := fx.openChannel(page, `stty -echo; printf 'one\n'; read x; printf 'two\n'; exit 2`)
	stream := fx.serve(info.Cap)
	stream.waitText(t, "one")
	stream.page(append([]byte{0x02}, "go\n"...))
	stream.waitEnded(t)
	stream.waitText(t, "two")
	again := fx.serve(info.Cap) // a page that comes back reads the end that was kept
	again.waitEnded(t)
	require.NoError(t, fx.wrapper.DismissChannelTerminal(info.Cap))

	guarded(t, "exec-no-legacy-event", func() {
		fx.mu.Lock()
		events := slices.Clone(fx.events)
		fx.mu.Unlock()
		assert.Len(t, events, heard, "no event but the plain terminal's: %v", events)
		for _, event := range events {
			assert.NotContains(t, event.name, info.ID, "an event named for the channel terminal")
		}
		assert.Empty(t, fx.closes(info.ID))
	})
}

// Closing or reloading a window ends no channel terminal: the terminal belongs to no window. Windows of both kinds that made channel
// terminals, and terminals of the events lane beside them whose end shows that the retirements were processed.
func TestAWindowThatClosesOrReloadsDoesNotEndAChannelTerminal(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	native := &terminalNativeWindow{id: 2}
	viaPage := fx.openChannel(page, `sleep 600`)
	viaNative := fx.openChannel(native, `sleep 600`)
	observeA := fx.open(page, terminal.Options{Command: append(shell(t), "-c", "sleep 600")})
	observeB := fx.open(native, terminal.Options{Command: append(shell(t), "-c", "sleep 600")})

	fx.retire(page) // a server-mode page that is gone: a reload is a page that is gone and another that comes
	native.closes()
	require.Eventually(t, func() bool { return len(fx.closes(observeA.ID)) == 1 && len(fx.closes(observeB.ID)) == 1 }, 30*time.Second, 2*time.Millisecond,
		"the retirements were processed: the terminals of the events lane ended")

	for name, info := range map[string]*terminal.Session{"the page's": viaPage, "the native window's": viaNative} {
		assert.False(t, gone(info.PID), "%s channel terminal is alive", name)
		listed, err := fx.wrapper.ListChannelTerminals([]string{info.Cap})
		require.NoError(t, err)
		require.Len(t, listed, 1, name)
		stream := fx.serve(info.Cap)
		require.Eventually(t, func() bool {
			for _, frame := range stream.frames() {
				if len(frame) > 0 && frame[0] == 0x81 {
					return true
				}
			}
			return false
		}, 30*time.Second, 2*time.Millisecond, "%s channel terminal is attached by its capability by a page of another window", name)
	}
}

//nolint:gochecknoglobals // The package tracer binds to the first provider of the process, so every run of the test shares one exporter.
var (
	capabilitySpanOnce     sync.Once
	capabilitySpanExporter = tracetest.NewInMemoryExporter()
)

// captureSpans installs the process-wide provider once and empties the exporter for the run that asks: the package tracer binds
// to the first global provider only, so a test that made a provider of its own heard its spans in the first run of a process and
// none in the second (go test -count=2).
func captureSpans(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	capabilitySpanOnce.Do(func() {
		otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(capabilitySpanExporter)))
	})
	capabilitySpanExporter.Reset()
	return capabilitySpanExporter
}

// The capability is nowhere the host writes: not in a log line (fields and message), not in an event, not in an error a call
// answered, not in a frame of the stream, not in a span. Whole, or in the parts of it that identify it.
func TestTheCapabilityAppearsNowhereInALogAnEventAnErrorAFrameOrASpan(t *testing.T) {
	spans := captureSpans(t)
	sink := &logtest.RecordingSink{}
	logger := logging.New(logging.Config{Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug)})
	fx := newTerminalFixtureLogged(t, logger)
	page := fx.page(1)

	var seen []string
	note := func(what string, parts ...any) { seen = append(seen, what+": "+fmt.Sprint(parts...)) }
	info := fx.openChannel(page, `stty -echo; printf 'one\n'; read x; printf 'two\n'; exit 2`)
	capability := info.Cap
	stream := fx.serve(capability)
	stream.waitText(t, "one")
	stream.page(append([]byte{0x02}, "go\n"...))
	stream.waitEnded(t)
	other := fx.openChannel(page, `sleep 600`)

	for _, wrong := range []string{capability[:40] + "XYZ", capability + "A", capability[1:]} {
		for _, err := range []error{
			fx.wrapper.CloseChannelTerminal(wrong), fx.wrapper.DismissChannelTerminal(wrong),
			func() error { _, err := fx.wrapper.ChannelTerminalBusy(wrong); return err }(),
			func() error { _, err := fx.wrapper.ChannelTerminalCwd(wrong); return err }(),
		} {
			require.Error(t, err)
			note("an error", err)
		}
	}
	listed, err := fx.wrapper.ListChannelTerminals([]string{capability, other.Cap})
	require.NoError(t, err)
	encoded, err := json.Marshal(listed)
	require.NoError(t, err)
	note("a list", string(encoded))
	require.NoError(t, fx.wrapper.DismissChannelTerminal(capability))
	require.NoError(t, fx.wrapper.CloseChannelTerminal(other.Cap))
	_, err = fx.wrapper.ListTerminals(fx.ctx(page), keyA)
	require.NoError(t, err)

	for _, frame := range stream.frames() {
		note("a frame", string(frame))
	}
	for _, record := range sink.Records() {
		note("a log line", record.Message, record.Fields)
	}
	fx.mu.Lock()
	for _, event := range fx.events {
		note("an event", event.name, event.data)
	}
	fx.mu.Unlock()
	ended := spans.GetSpans() // the exporter is a syncer: a span is there when it ends
	require.NotEmpty(t, ended, "the spans of the calls were recorded: the test heard them")
	for _, span := range ended {
		note("a span", span.Name, span.Attributes, span.Status, span.Events, span.Links)
	}

	parts := []string{capability, capability[:16], capability[len(capability)-16:], other.Cap}
	guarded(t, "capability-appears-nowhere", func() {
		for _, line := range seen {
			for _, part := range parts {
				assert.NotContains(t, line, part, "the capability (or a piece of it) is in %.200s", line)
			}
		}
	})
	t.Logf("scanned %d lines of logs, events, errors, frames and spans", len(seen))
}
