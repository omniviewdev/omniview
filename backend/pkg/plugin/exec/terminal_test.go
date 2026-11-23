//go:build !windows

package exec

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	"github.com/omniviewdev/omniview/internal/shellenv"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// terminalPage is a server-mode window as Wails builds it: it names its page, and its close event never fires.
type terminalPage struct {
	application.Window
	id     uint
	client string
}

func (w *terminalPage) ID() uint         { return w.id }
func (w *terminalPage) ClientID() string { return w.client }
func (w *terminalPage) OnWindowEvent(events.WindowEventType, func(*application.WindowEvent)) func() {
	return func() {}
}

// terminalNativeWindow is a native window: its close event fires, and runs every callback registered for it.
type terminalNativeWindow struct {
	application.Window
	id       uint
	mu       sync.Mutex
	onClosed []func(*application.WindowEvent)
}

func (w *terminalNativeWindow) ID() uint { return w.id }
func (w *terminalNativeWindow) OnWindowEvent(_ events.WindowEventType, callback func(*application.WindowEvent)) func() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.onClosed = append(w.onClosed, callback)
	return func() {}
}

func (w *terminalNativeWindow) closes() {
	w.mu.Lock()
	callbacks := slices.Clone(w.onClosed)
	w.mu.Unlock()
	for _, callback := range callbacks {
		callback(nil)
	}
}

// terminalPages stands for Wails' registry of connected pages.
type terminalPages struct {
	mu   sync.Mutex
	open map[string]bool
}

func (p *terminalPages) set(client string, connected bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.open[client] = connected
}

func (p *terminalPages) connected(client string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.open[client]
}

// terminalFixture is the host's exec lane for local terminals as main composes it: the window realm, the
// wrapper the pages call, the controller and the manager under it, and the events the windows would get.
type terminalFixture struct {
	t       *testing.T
	ctrl    *controller
	wrapper *ServiceWrapper
	pages   *terminalPages
	realm   *invocation.WindowRealm

	mu     sync.Mutex
	events []execTestEvent
}

func newTerminalFixture(t *testing.T) *terminalFixture {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	pages := &terminalPages{open: map[string]bool{}}
	realm := invocation.NewWindowRealm(nil, invocation.WithPageSweep(pages.connected, 5*time.Millisecond))
	ctrl, ok := NewController(logging.NewNop(), nil, nil).(*controller)
	require.True(t, ok)
	fx := &terminalFixture{t: t, ctrl: ctrl, pages: pages, realm: realm, wrapper: &ServiceWrapper{Ctrl: ctrl, Realm: realm}}
	ctrl.events = execTestEmitter(func(name string, data ...any) bool {
		fx.mu.Lock()
		defer fx.mu.Unlock()
		fx.events = append(fx.events, execTestEvent{name: name, data: data[0]})
		return true
	})
	ctrl.startTerminals(ctx)
	t.Cleanup(func() {
		for _, session := range ctrl.terminalManager.ListSessions() {
			_ = ctrl.CloseSession(session.ID)
		}
		cancel()
	})
	return fx
}

func (fx *terminalFixture) page(id uint) *terminalPage {
	fx.t.Helper()
	page := &terminalPage{id: id, client: "page-" + strconv.FormatUint(uint64(id), 10)}
	fx.pages.set(page.client, true)
	return page
}

func shell(t *testing.T) []string {
	t.Helper()
	path, err := exec.LookPath("sh")
	require.NoError(t, err)
	return []string{path}
}

func (fx *terminalFixture) openAs(window application.Window, opts terminal.Options) (*terminal.Session, error) {
	ctx := context.Background()
	if window != nil {
		ctx = context.WithValue(ctx, application.WindowKey, window)
	}
	return fx.wrapper.CreateTerminal(ctx, execsdk.SessionOptions{ID: opts.ID, Command: opts.Command}, terminal.Launch{Cols: opts.Cols, Rows: opts.Rows})
}

func (fx *terminalFixture) open(window application.Window, opts terminal.Options) *terminal.Session {
	fx.t.Helper()
	if opts.Command == nil {
		opts.Command = shell(fx.t)
	}
	session, err := fx.openAs(window, opts)
	require.NoError(fx.t, err)
	return session
}

func (fx *terminalFixture) eventsOf(id string) []execTestEvent {
	fx.mu.Lock()
	defer fx.mu.Unlock()
	var out []execTestEvent
	for _, event := range fx.events {
		if strings.HasSuffix(event.name, "/"+id) {
			out = append(out, event)
		}
	}
	return out
}

func (fx *terminalFixture) output(id string) string {
	var text strings.Builder
	for _, event := range fx.eventsOf(id) {
		if event.name == localOutputEvent+id {
			if out, ok := event.data.(*terminalOutput); ok {
				text.Write(out.Bytes())
			}
		}
	}
	return text.String()
}

func (fx *terminalFixture) closes(id string) []terminal.End {
	var ends []terminal.End
	for _, event := range fx.eventsOf(id) {
		if event.name == localCloseEvent+id {
			if end, ok := event.data.(terminal.End); ok {
				ends = append(ends, end)
			}
		}
	}
	return ends
}

func (fx *terminalFixture) indexed() int {
	fx.ctrl.mu.RLock()
	defer fx.ctrl.mu.RUnlock()
	return len(fx.ctrl.sessionIndex)
}

func gone(pid int) bool { return errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) }

func allGone(pids []int) bool {
	for _, pid := range pids {
		if !gone(pid) {
			return false
		}
	}
	return true
}

// aliveOf counts the processes of pids that still exist.
func aliveOf(pids []int) int {
	alive := 0
	for _, pid := range pids {
		if !gone(pid) {
			alive++
		}
	}
	return alive
}

// children lists the live child processes of this test process, as the system says (nothing the manager
// keeps): a shell that no table remembers is still found here. The listing's own process is not one.
func children(t *testing.T) ([]int, bool) {
	t.Helper()
	if _, err := exec.LookPath("ps"); err != nil {
		return nil, false
	}
	list := exec.Command("ps", "-A", "-o", "pid=,ppid=,stat=")
	out, err := list.Output()
	require.NoError(t, err)
	var pids []int
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		pid, _ := strconv.Atoi(fields[0])
		ppid, _ := strconv.Atoi(fields[1])
		if ppid == os.Getpid() && pid != list.Process.Pid && !strings.HasPrefix(fields[2], "Z") {
			pids = append(pids, pid)
		}
	}
	return pids, true
}

// The create answer states what the host knows, through the wrapper a page calls, and the CLOSE event
// carries the same typed end the manager made.
func TestCreateTerminalAnswersWhatTheHostKnowsAndTheCloseEventIsTyped(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	info := fx.open(page, terminal.Options{
		Command: append(shell(t), "-c", "stty size; echo done-$((1000+1)); exit 7"), Cols: 133, Rows: 41,
	})
	assert.Equal(t, 133, info.Cols)
	assert.Equal(t, 41, info.Rows)
	assert.Equal(t, shell(t)[0], info.Shell.Path)
	assert.NotEmpty(t, info.Shell.Name)
	assert.Equal(t, os.Getenv("HOME"), info.Cwd)
	require.Eventually(t, func() bool { return len(fx.closes(info.ID)) == 1 }, 20*time.Second, 5*time.Millisecond)
	assert.Contains(t, fx.output(info.ID), "41 133", "the shell started at the size the answer states")
	assert.Contains(t, fx.output(info.ID), "done-1001")

	events := fx.eventsOf(info.ID)
	require.NotEmpty(t, events)
	last := events[len(events)-1]
	assert.Equal(t, localCloseEvent+info.ID, last.name, "the CLOSE is the last event of the session")
	end, ok := last.data.(terminal.End)
	require.True(t, ok, "the CLOSE payload is a typed end, not text: %T", last.data)
	assert.Equal(t, terminal.EndExited, end.Reason)
	require.NotNil(t, end.ExitCode)
	assert.Equal(t, 7, *end.ExitCode)
	assert.Zero(t, fx.indexed(), "an ended session leaves the index")
	assert.Empty(t, fx.ctrl.terminalManager.ListSessions())
}

func TestCreateTerminalRefusesACallThatComesFromNoWindow(t *testing.T) {
	fx := newTerminalFixture(t)
	_, err := fx.openAs(nil, terminal.Options{Command: shell(t)})
	require.Error(t, err)
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	assert.Equal(t, apperror.TypeResourceForbidden, app.Type)
	assert.Empty(t, fx.ctrl.terminalManager.ListSessions(), "a terminal nothing could retire is not started")

	bare := &ServiceWrapper{Ctrl: fx.ctrl}
	_, err = bare.CreateTerminal(context.WithValue(context.Background(), application.WindowKey, fx.page(2)), execsdk.SessionOptions{Command: shell(t)}, terminal.Launch{})
	require.Error(t, err, "a wrapper with no window realm starts nothing either")
	assert.Zero(t, fx.indexed())
}

func TestCreateTerminalRefusesAWindowThatIsAlreadyRetired(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(3)
	fx.open(page, terminal.Options{})
	fx.pages.set(page.client, false)
	require.Eventually(t, func() bool { return len(fx.ctrl.terminalManager.ListSessions()) == 0 }, 20*time.Second, 5*time.Millisecond)
	_, err := fx.openAs(page, terminal.Options{Command: shell(t)})
	require.ErrorIs(t, err, invocation.ErrWindowUnavailable, "a closed page is refused, not served a shell nobody can reach")
	assert.Empty(t, fx.ctrl.terminalManager.ListSessions())
}

// What the page sends is checked before anything starts: a local terminal runs no resource request (it
// never did), and a size that is not a size is refused in words that name the field.
func TestCreateTerminalRefusesWhatIsNotATerminalBeforeAnythingStarts(t *testing.T) {
	fx := newTerminalFixture(t)
	ctx := context.WithValue(context.Background(), application.WindowKey, fx.page(7))

	_, err := fx.wrapper.CreateTerminal(ctx, execsdk.SessionOptions{Command: shell(t), ResourcePlugin: "plugin", ResourceKey: "pods"}, terminal.Launch{})
	require.Error(t, err)
	assert.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))

	_, err = fx.wrapper.CreateTerminal(ctx, execsdk.SessionOptions{Command: shell(t)}, terminal.Launch{Cols: 5000, Rows: 24})
	require.ErrorIs(t, err, terminal.ErrInvalid)
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	assert.Equal(t, "INVALID_REQUEST", app.Code)
	assert.Contains(t, app.Detail, "cols")

	_, err = fx.wrapper.CreateTerminal(ctx, execsdk.SessionOptions{Command: []string{"/bin/cat"}}, terminal.Launch{})
	require.ErrorIs(t, err, shellenv.ErrUnsupported, "a program that is not a shell is refused, never replaced by one")
	require.ErrorAs(t, err, &app)
	assert.Equal(t, "SHELL_UNSUPPORTED", app.Code)

	assert.Empty(t, fx.ctrl.terminalManager.ListSessions())
	assert.Zero(t, fx.indexed(), "a refused terminal leaves nothing in the index")
}

// B-88 for terminals. Open 100 terminals across 20 pages and let the pages go (closed, or reloaded: the
// new page is a new window). Count by the pids recorded at creation: no shell is left, every shell's
// CLOSE says the window ended it, and the page that stayed keeps its own.
func TestHundredTerminalsAcrossTwentyRetiredPagesLeaveNoShellAlive(t *testing.T) {
	fx := newTerminalFixture(t)
	var pids []int
	var ids []string
	var pages []*terminalPage
	for p := uint(1); p <= 20; p++ {
		page := fx.page(p)
		pages = append(pages, page)
		for range 5 {
			info := fx.open(page, terminal.Options{})
			pids = append(pids, info.PID)
			ids = append(ids, info.ID)
		}
	}
	keeper := fx.page(21)
	var kept []*terminal.Session
	for range 2 {
		kept = append(kept, fx.open(keeper, terminal.Options{}))
	}
	require.Len(t, pids, 100)
	require.Zero(t, 100-aliveOf(pids), "all 100 shells are running before the pages go")
	require.Len(t, fx.ctrl.terminalManager.ListSessions(), 102)

	for _, page := range pages {
		fx.pages.set(page.client, false)
	}
	require.Eventually(t, func() bool { return allGone(pids) }, 60*time.Second, 10*time.Millisecond,
		"%d of the 100 shells are still alive", aliveOf(pids))

	assert.Zero(t, aliveOf(pids), "0 shells alive, counted by the pids recorded when they started")
	listed := fx.ctrl.terminalManager.ListSessions()
	require.Len(t, listed, 2, "the page that is still there keeps its terminals")
	for _, id := range ids {
		ends := fx.closes(id)
		require.Len(t, ends, 1, "session %s: one CLOSE", id)
		assert.Equal(t, terminal.EndClosed, ends[0].Reason)
		assert.Equal(t, terminal.ClosedByWindow, ends[0].ClosedBy, "the window ended it: the restored tab can say so")
	}
	for _, info := range kept {
		assert.False(t, gone(info.PID), "the other page's shell is untouched")
		assert.Empty(t, fx.closes(info.ID))
	}
	assert.Equal(t, 2, fx.indexed(), "the index holds the two that live")
	if left, ok := children(t); ok {
		assert.Len(t, left, 2, "the system's own list of this process's children: the two kept shells")
	}
}

// A native window announces its own close; the same signal ends its shells.
func TestANativeWindowClosingEndsItsTerminals(t *testing.T) {
	fx := newTerminalFixture(t)
	window := &terminalNativeWindow{id: 1}
	other := &terminalNativeWindow{id: 2}
	mine := fx.open(window, terminal.Options{})
	theirs := fx.open(other, terminal.Options{})
	window.closes()
	require.Eventually(t, func() bool { return gone(mine.PID) }, 20*time.Second, 5*time.Millisecond)
	ends := fx.closes(mine.ID)
	require.Len(t, ends, 1)
	assert.Equal(t, terminal.ClosedByWindow, ends[0].ClosedBy)
	assert.False(t, gone(theirs.PID))
	other.closes()
	require.Eventually(t, func() bool { return gone(theirs.PID) }, 20*time.Second, 5*time.Millisecond)
}

// The window can go while its shell is starting: whichever of the two happens first, no shell outlives it.
func TestAWindowRetiredWhileItsTerminalStartsLeavesNoShell(t *testing.T) {
	fx := newTerminalFixture(t)
	var mu sync.Mutex
	var pids []int
	command := shell(t)
	for i := range 25 {
		page := fx.page(uint(100 + i))
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			info, err := fx.openAs(page, terminal.Options{Command: command})
			if err == nil {
				mu.Lock()
				pids = append(pids, info.PID)
				mu.Unlock()
			}
		}()
		go func() {
			defer wg.Done()
			time.Sleep(time.Duration(rand.IntN(25)) * time.Millisecond)
			fx.pages.set(page.client, false)
		}()
		wg.Wait()
	}
	require.Eventually(t, func() bool { return len(fx.ctrl.terminalManager.ListSessions()) == 0 }, 60*time.Second, 10*time.Millisecond,
		"every page is gone, so no session is left")
	mu.Lock()
	defer mu.Unlock()
	require.Eventually(t, func() bool { return allGone(pids) }, 30*time.Second, 10*time.Millisecond)
	require.Eventually(t, func() bool {
		left, ok := children(t)
		return !ok || len(left) == 0
	}, 30*time.Second, 20*time.Millisecond, "the system lists no child of this process: no shell was left behind by a race")
	assert.Zero(t, fx.indexed())
}

// The local terminal is the exec lane's, and only CreateTerminal makes one: a shell cannot be started
// through the plugin route under the name "local" (that started one with no owner).
func TestCreateSessionDoesNotStartALocalTerminal(t *testing.T) {
	fx := newTerminalFixture(t)
	_, err := fx.ctrl.CreateSession(context.Background(), "local", "local", execsdk.SessionOptions{Command: shell(t), TTY: true})
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err), "the old route is refused in typed words, not served")
	assert.Empty(t, fx.ctrl.terminalManager.ListSessions())
	assert.Zero(t, fx.indexed())
}

func TestCreateTerminalRefusesAnIdThatAnotherSessionHasWithoutTouchingIt(t *testing.T) {
	fx := newTerminalFixture(t)
	fx.ctrl.mu.Lock()
	fx.ctrl.sessionIndex["taken"] = sessionIndex{pluginID: "some-plugin", connectionID: "c", local: false}
	fx.ctrl.mu.Unlock()
	_, err := fx.openAs(fx.page(4), terminal.Options{ID: "taken", Command: shell(t)})
	require.ErrorIs(t, err, terminal.ErrIDInUse)
	fx.ctrl.mu.RLock()
	entry := fx.ctrl.sessionIndex["taken"]
	fx.ctrl.mu.RUnlock()
	assert.Equal(t, "some-plugin", entry.pluginID, "the other session's route is not overwritten")
	assert.Empty(t, fx.ctrl.terminalManager.ListSessions())
}

// A terminal's own id can be chosen by the page, so the page listens before the shell starts; and a
// shell that exits at once still leaves the index clean (its CLOSE can come before CreateTerminal returns).
func TestAShellThatExitsAtOnceLeavesNoIndexEntry(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(5)
	for i := range 20 {
		info := fx.open(page, terminal.Options{ID: fmt.Sprintf("quick-%d", i), Command: append(shell(t), "-c", "exit 0")})
		require.Eventually(t, func() bool { return len(fx.closes(info.ID)) == 1 }, 20*time.Second, 5*time.Millisecond)
	}
	require.Eventually(t, func() bool { return fx.indexed() == 0 }, 10*time.Second, 5*time.Millisecond)
}

// Writes and resizes through the wrapper keep their numbers' order, and the busy fact is asked at close time.
func TestWrapperOrdersInputAndAnswersTheBusyFact(t *testing.T) {
	fx := newTerminalFixture(t)
	info := fx.open(fx.page(6), terminal.Options{Cols: 80, Rows: 24})
	require.NoError(t, fx.wrapper.ResizeTerminal(info.ID, 1, 40, 120))
	require.NoError(t, fx.wrapper.WriteTerminal(info.ID, 2, []byte("stty size; echo sized-$((1000+2))\n")))
	require.Eventually(t, func() bool { return strings.Contains(fx.output(info.ID), "sized-1002") }, 20*time.Second, 5*time.Millisecond)
	assert.Contains(t, fx.output(info.ID), "40 120", "the resize numbered 1 came before the write numbered 2")

	busy, err := fx.wrapper.IsBusy(info.ID)
	require.NoError(t, err)
	assert.Equal(t, terminal.StateIdle, busy.State)

	require.NoError(t, fx.wrapper.WriteTerminal(info.ID, 3, []byte("sleep 57\n")))
	require.Eventually(t, func() bool {
		got, askErr := fx.wrapper.IsBusy(info.ID)
		return askErr == nil && got.State == terminal.StateBusy && got.Name == "sleep"
	}, 10*time.Second, 10*time.Millisecond)

	// A session of a plugin runs elsewhere: the host holds no terminal for it, and says it cannot tell.
	fx.ctrl.mu.Lock()
	fx.ctrl.sessionIndex["remote"] = sessionIndex{pluginID: "plugin", connectionID: "c", local: false}
	fx.ctrl.mu.Unlock()
	remote, err := fx.wrapper.IsBusy("remote")
	require.NoError(t, err)
	assert.Equal(t, terminal.StateUnknown, remote.State)
	assert.Equal(t, terminal.ReasonRemote, remote.Reason)
	_, err = fx.wrapper.IsBusy("no-such-session")
	require.Error(t, err)

	require.NoError(t, fx.wrapper.CloseSession(info.ID))
	ends := fx.closes(info.ID)
	require.Len(t, ends, 1)
	assert.Equal(t, terminal.ClosedByRequest, ends[0].ClosedBy)
}
