package invocation

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
)

func recordingLogger() (logging.Logger, *logtest.RecordingSink) {
	sink := &logtest.RecordingSink{}
	return logging.New(logging.Config{Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug)}), sink
}

// limitRealm is a realm of server-mode pages with a recording logger and a clock the test moves.
func limitRealm(t *testing.T) (*WindowRealm, *pageSockets, *logtest.RecordingSink, *time.Time) {
	t.Helper()
	log, sink := recordingLogger()
	sockets := newPageSockets()
	realm := NewWindowRealm(nil, WithLogger(log), WithPageSweep(sockets.connected, stepped))
	clock := time.Now()
	realm.now = func() time.Time { return clock }
	return realm, sockets, sink, &clock
}

func fillRealm(t *testing.T, realm *WindowRealm, sockets *pageSockets) {
	t.Helper()
	for id := uint(1); id <= maxRealmWindows; id++ {
		openPage(t, realm, sockets, id)
	}
}

func refusedPage(id uint) *pageWindow {
	return &pageWindow{realmWindow: realmWindow{Window: nil, id: id, onClose: nil}, client: "page-" + strconv.FormatUint(uint64(id), 10)}
}

func admitAs(realm *WindowRealm, window application.Window, authorize func(Principal, string, Target) error) error {
	_, err := NewBoundary(AuthorizeFunc(authorize)).Admit(realm.Context(realmWindowContext(window)), "resource.ListConnections", Target{})
	return err
}

func allow(Principal, string, Target) error { return nil }

func appError(t *testing.T, err error) *apperror.AppError {
	t.Helper()
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	return app
}

// B-89: a window refused for lack of a slot was answered "Access denied", the text of a permission refusal, and nothing was logged.
// The page's code for it is RESOURCE_LIMIT, which the frontend tells apart from FORBIDDEN; the text is the class's own, with no count in it.
func TestWindowRealmRefusesTheNextWindowWithALimitCodeNotAPermissionDenial(t *testing.T) {
	realm, sockets, _, _ := limitRealm(t)
	fillRealm(t, realm, sockets)

	refused := appError(t, admitAs(realm, refusedPage(maxRealmWindows+1), allow))
	require.Equal(t, "RESOURCE_LIMIT", refused.Code)
	require.Equal(t, apperror.TypeResourceLimit, refused.Type)
	require.Equal(t, 429, refused.Status)
	// The request id is a random UUID: its digits can spell the limit ("64") with no leak in the host's text, so the claim is made on
	// every field the host wrote, with the id (checked present, then set aside) left out.
	require.NotEmpty(t, refused.RequestID)
	hostText := *refused
	hostText.RequestID = ""
	require.NotContains(t, hostText.Error(), strconv.Itoa(maxRealmWindows), "the page is told the class, never the host's limit or count")
	require.NotContains(t, hostText.Error(), "scope")

	// A permission refusal of a window that has a slot stays FORBIDDEN: the two are told apart by the code.
	denied := appError(t, admitAs(realm, refusedPage(1), func(Principal, string, Target) error { return errors.New("no") }))
	require.Equal(t, "FORBIDDEN", denied.Code)
	require.NotEqual(t, denied.Code, refused.Code)

	// A caller with no window at all is still a plain denial, not a limit.
	_, err := NewBoundary(AuthorizeFunc(allow)).Admit(realm.Context(context.Background()), "resource.ListConnections", Target{})
	require.Equal(t, "FORBIDDEN", appError(t, err).Code)
}

func TestWindowRealmGivesTheLimitErrorToTheServicesThatAskForAScope(t *testing.T) {
	realm, sockets, _, _ := limitRealm(t)
	fillRealm(t, realm, sockets)

	scope, err := realm.AdmitWindow(refusedPage(maxRealmWindows + 1))
	require.Nil(t, scope)
	require.ErrorIs(t, err, ErrWindowLimit)
	require.Equal(t, "RESOURCE_LIMIT", appError(t, err).Code)

	scope, err = realm.AdmitWindow(refusedPage(1))
	require.NoError(t, err)
	require.NotNil(t, scope)

	// A window the realm closed is refused too, but it is not a limit: a closed page asks nothing more.
	closed := refusedPage(1000)
	sockets.connect(closed.client)
	sockets.drop(refusedPage(1).client)
	realm.sweep()
	realm.sweep()
	scope, err = realm.AdmitWindow(closed)
	require.NoError(t, err, "the slot the closed page freed is the next window's")
	require.NotNil(t, scope)
	sockets.drop(closed.client)
	realm.sweep()
	realm.sweep()
	scope, err = realm.AdmitWindow(closed)
	require.Nil(t, scope)
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrWindowLimit)
}

func refusalRecords(sink *logtest.RecordingSink) []logging.Record {
	var out []logging.Record
	for _, record := range sink.Records() {
		if record.Message == refusalMessage {
			out = append(out, record)
		}
	}
	return out
}

func fieldValue(record logging.Record, key string) any {
	for _, field := range record.Fields {
		if field.Key == key {
			return field.Value
		}
	}
	return nil
}

// One line for each window that is refused, not for each call it makes: a page retries every few seconds and would otherwise fill the log.
func TestWindowRealmLogsOnceForEachRefusedWindowNamingTheRegistryTheLimitAndTheCount(t *testing.T) {
	realm, sockets, sink, clock := limitRealm(t)
	fillRealm(t, realm, sockets)
	require.Empty(t, refusalRecords(sink), "a window that is served says nothing")

	first, second := refusedPage(maxRealmWindows+1), refusedPage(maxRealmWindows+2)
	for range 50 {
		require.Error(t, admitAs(realm, first, allow))
	}
	records := refusalRecords(sink)
	require.Len(t, records, 1, "fifty calls of one refused window are one line")
	require.Equal(t, logging.LevelWarn, records[0].Level)
	require.Equal(t, "window-realm", fieldValue(records[0], "registry"))
	require.Equal(t, maxRealmWindows, fieldValue(records[0], "limit"))
	require.Equal(t, maxRealmWindows, fieldValue(records[0], "count"))
	require.Equal(t, uint(maxRealmWindows+1), fieldValue(records[0], "window"))

	for range 5 {
		require.Error(t, admitAs(realm, second, allow))
	}
	require.Len(t, refusalRecords(sink), 2, "another refused window is its own line")

	// A window that stays refused is said again once a minute: the host's log says it is still happening, and no faster.
	*clock = clock.Add(refusalLogEvery - time.Second)
	require.Error(t, admitAs(realm, first, allow))
	require.Len(t, refusalRecords(sink), 2)
	*clock = clock.Add(2 * time.Second)
	require.Error(t, admitAs(realm, first, allow))
	require.Len(t, refusalRecords(sink), 3)

	// A refusal that is not a limit says nothing here: a missing window, a window the authorizer denies.
	before := len(sink.Records())
	_, _ = NewBoundary(AuthorizeFunc(allow)).Admit(realm.Context(context.Background()), "x", Target{})
	require.Error(t, admitAs(realm, refusedPage(1), func(Principal, string, Target) error { return errors.New("no") }))
	require.Len(t, sink.Records(), before)
}

func TestWindowRealmRemembersAtMostAFixedNumberOfRefusedWindowsAndCountsTheLinesItDropped(t *testing.T) {
	realm, sockets, sink, clock := limitRealm(t)
	fillRealm(t, realm, sockets)
	for id := uint(maxRealmWindows + 1); id <= maxRealmWindows+refusedWindowsKept+300; id++ {
		require.Error(t, admitAs(realm, refusedPage(id), allow))
	}
	realm.mu.Lock()
	kept := len(realm.refused)
	realm.mu.Unlock()
	require.LessOrEqual(t, kept, refusedWindowsKept)
	require.Len(t, refusalRecords(sink), refusedWindowsKept)

	// The next line says how many were not written, once, and the count starts again.
	*clock = clock.Add(refusalLogEvery + time.Second)
	require.Error(t, admitAs(realm, refusedPage(maxRealmWindows+1), allow))
	records := refusalRecords(sink)
	last := records[len(records)-1]
	require.Equal(t, 300, fieldValue(last, "suppressed"))
	require.Error(t, admitAs(realm, refusedPage(maxRealmWindows+2), allow))
	records = refusalRecords(sink)
	require.Zero(t, fieldValue(records[len(records)-1], "suppressed"))
}

func TestWindowRealmServesARefusedWindowOnceASlotIsFree(t *testing.T) {
	realm, sockets, sink, _ := limitRealm(t)
	fillRealm(t, realm, sockets)
	late := refusedPage(maxRealmWindows + 1)
	sockets.connect(late.client)
	require.Error(t, admitAs(realm, late, allow))

	sockets.drop(refusedPage(1).client)
	realm.sweep()
	realm.sweep()
	require.NoError(t, admitAs(realm, late, allow))
	require.Len(t, refusalRecords(sink), 1)
	realm.mu.Lock()
	_, remembered := realm.refused[IdentityOf(late)]
	realm.mu.Unlock()
	require.False(t, remembered, "a window that was served is not a refused window any more")
}

// A native window is refused the same way: the cap is the realm's, whatever the window's kind.
func TestWindowRealmRefusesTheNextNativeWindowWithTheSameCode(t *testing.T) {
	log, sink := recordingLogger()
	realm := NewWindowRealm(nil, WithLogger(log))
	for id := uint(1); id <= maxRealmWindows; id++ {
		require.NoError(t, admitAs(realm, &realmWindow{Window: nil, id: id, onClose: nil}, allow))
	}
	require.Equal(t, "RESOURCE_LIMIT", appError(t, admitAs(realm, &realmWindow{Window: nil, id: maxRealmWindows + 1, onClose: nil}, allow)).Code)
	require.Len(t, refusalRecords(sink), 1)
}

func TestWindowRealmWithoutALoggerStillRefusesWithTheCode(t *testing.T) {
	sockets := newPageSockets()
	realm := NewWindowRealm(nil, WithPageSweep(sockets.connected, stepped))
	fillRealm(t, realm, sockets)
	require.Equal(t, "RESOURCE_LIMIT", appError(t, admitAs(realm, refusedPage(maxRealmWindows+1), allow)).Code)
}

func TestWindowRealmRacingRefusedWindowsLogOncePerWindow(t *testing.T) {
	realm, sockets, sink, _ := limitRealm(t)
	fillRealm(t, realm, sockets)
	var group sync.WaitGroup
	for w := range 8 {
		window := refusedPage(uint(maxRealmWindows + 1 + w))
		for range 8 {
			group.Add(1)
			go func() {
				defer group.Done()
				_ = admitAs(realm, window, allow)
			}()
		}
	}
	group.Wait()
	require.Len(t, refusalRecords(sink), 8)
}

// ---- one retirement signal for every per-window registry ----

type retireLog struct {
	mu  sync.Mutex
	got []WindowIdentity
}

func (l *retireLog) add(identity WindowIdentity) {
	l.mu.Lock()
	l.got = append(l.got, identity)
	l.mu.Unlock()
}
func (l *retireLog) all() []WindowIdentity {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]WindowIdentity(nil), l.got...)
}

func TestWindowRealmTellsEverySubscriberWhenAPageIsRetiredByTheSweep(t *testing.T) {
	realm, sockets, owners := pageRealm(t, stepped)
	var first, second retireLog
	realm.OnRetire(first.add)
	realm.OnRetire(second.add)
	live, _ := openPage(t, realm, sockets, 1)
	gone, _ := openPage(t, realm, sockets, 2)
	sockets.drop(gone.client)
	realm.sweep()
	require.Empty(t, first.all(), "one absence is a blip, not a retirement")
	realm.sweep()
	realm.sweep()
	for _, log := range []*retireLog{&first, &second} {
		require.Equal(t, []WindowIdentity{IdentityOf(gone)}, log.all(), "exactly the page that closed, exactly once")
	}
	require.Len(t, owners.all(), 1)
	require.NotNil(t, realm.ScopeForWindow(live))
}

func TestWindowRealmTellsEverySubscriberWhenANativeWindowCloses(t *testing.T) {
	realm := NewWindowRealm(nil)
	var seen retireLog
	realm.OnRetire(seen.add)
	window, other := &realmWindow{Window: nil, id: 1, onClose: nil}, &realmWindow{Window: nil, id: 2, onClose: nil}
	require.NotNil(t, realm.ScopeForWindow(window))
	require.NotNil(t, realm.ScopeForWindow(other))
	window.onClose(nil)
	window.onClose(nil)
	require.Equal(t, []WindowIdentity{IdentityOf(window)}, seen.all(), "a second close event of the same window retires nothing again")
}

// The signal is sent outside the realm's lock: a subscriber closes a registry's sessions, and may ask the realm about its window.
func TestWindowRealmSignalsRetirementOutsideItsLock(t *testing.T) {
	realm, sockets, _ := pageRealm(t, stepped)
	window, _ := openPage(t, realm, sockets, 1)
	asked := make(chan *Scope, 1)
	realm.OnRetire(func(WindowIdentity) { asked <- realm.ScopeForWindow(window) })
	sockets.drop(window.client)
	done := make(chan struct{})
	go func() { realm.sweep(); realm.sweep(); close(done) }()
	select {
	case scope := <-asked:
		require.Nil(t, scope, "the retired window is already refused when the subscribers hear of it")
	case <-time.After(5 * time.Second):
		t.Fatal("a subscriber that asks the realm deadlocked it")
	}
	<-done
}

func TestWindowRealmSubscribersRunAfterTheSourceOwnerIsRetired(t *testing.T) {
	var order []string
	var mu sync.Mutex
	note := func(name string) {
		mu.Lock()
		order = append(order, name)
		mu.Unlock()
	}
	sockets := newPageSockets()
	realm := NewWindowRealm(func(string) { note("owner") }, WithPageSweep(sockets.connected, stepped))
	realm.OnRetire(func(WindowIdentity) { note("subscriber") })
	window, _ := openPage(t, realm, sockets, 1)
	sockets.drop(window.client)
	realm.sweep()
	realm.sweep()
	require.Equal(t, []string{"owner", "subscriber"}, order)
}
