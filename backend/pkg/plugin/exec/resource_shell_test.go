package exec

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// The provider doubles separate the five decisions under test: membership of the launch row,
// permission to exec, process creation, attachment, and whether that attachment is still live.
// An attach response alone is not evidence: the SDK also answers it for retained output of a dead process.
type shellTestResources struct {
	aConnectionTheHostHolds
	proof        resource.ExtensionRootProof
	admitted     *resource.ExtensionRootProof
	rootCurrent  bool
	routeRetired bool
	guardCalls   int
}

func (r *shellTestResources) AdmitExtensionRoot(_ context.Context, owner string, p resource.ExtensionRootProof) (resourcev2.ResourceReference, resourcev2.AccessRoute, func(context.Context) error, error) {
	if !r.rootCurrent || owner != r.proof.Owner || !reflect.DeepEqual(p, r.proof) {
		return resourcev2.ResourceReference{}, resourcev2.AccessRoute{}, nil, resourcev2.NewError("FORBIDDEN", "Wrong launch row.")
	}
	native := &r.proof
	if r.admitted != nil {
		native = r.admitted
	}
	return native.Reference, resourcev2.AccessRoute{Connection: native.Connection}, func(context.Context) error {
		r.guardCalls++
		if !r.rootCurrent || !reflect.DeepEqual(p, r.proof) {
			return resourcev2.NewError("RESET_REQUIRED", "Launch row retired.")
		}
		return nil
	}, nil
}

func (r *shellTestResources) GuardExtensionRootRoute(context.Context, string, resource.ExtensionRootProof) (func(context.Context) error, error) {
	return func(ctx context.Context) error {
		if r.routeRetired {
			return resourcev2.NewError("RESET_REQUIRED", "Connection epoch changed.")
		}
		return ctx.Err()
	}, nil
}

type shellTestProvider struct {
	Provider
	opts       sdkexec.SessionOptions
	session    sdkexec.Session
	creates    int
	gets       int
	getHook    func()
	closes     []string
	resizes    []string
	attachHook func(*sdkexec.Session)
	closed     chan struct{}
}

func (p *shellTestProvider) CreateSession(_ *sdktypes.PluginContext, opts sdkexec.SessionOptions) (*sdkexec.Session, error) {
	p.opts = opts
	p.creates++
	p.session = sdkexec.Session{ID: opts.ID, CreatedAt: time.Unix(int64(p.creates), 0)}
	result := p.session
	return &result, nil
}

func (p *shellTestProvider) AttachSession(_ *sdktypes.PluginContext, id string) (*sdkexec.Session, []byte, error) {
	if id != p.session.ID {
		return nil, nil, sdkexec.NewSessionNotFoundError(id)
	}
	p.session.Attached = true
	result := p.session
	if p.attachHook != nil {
		p.attachHook(&result)
	}
	return &result, []byte("before attach"), nil
}

func (p *shellTestProvider) GetSession(_ *sdktypes.PluginContext, id string) (*sdkexec.Session, error) {
	p.gets++
	if p.getHook != nil {
		p.getHook()
	}
	if p.session.ID != id {
		return nil, sdkexec.NewSessionNotFoundError(id)
	}
	result := p.session
	return &result, nil
}

func (p *shellTestProvider) ListSessions(*sdktypes.PluginContext) ([]*sdkexec.Session, error) {
	return []*sdkexec.Session{&p.session}, nil
}

func (p *shellTestProvider) CloseSession(_ *sdktypes.PluginContext, id string) error {
	p.closes = append(p.closes, id)
	if id != p.session.ID {
		return sdkexec.NewSessionNotFoundError(id)
	}
	p.session = sdkexec.Session{}
	if p.closed != nil {
		close(p.closed)
	}
	return nil
}

func (p *shellTestProvider) ResizeSession(_ *sdktypes.PluginContext, id string, cols, rows int32) error {
	if id != p.session.ID || cols != 90 || rows != 30 {
		return resourcev2.NewError("INVALID_REQUEST", "Incorrect resize.")
	}
	p.resizes = append(p.resizes, id)
	return nil
}

type shellTestWindow struct {
	application.Window
	id     uint
	retire func(*application.WindowEvent)
}

func (w *shellTestWindow) ID() uint { return w.id }
func (w *shellTestWindow) OnWindowEvent(_ events.WindowEventType, fn func(*application.WindowEvent)) func() {
	w.retire = fn
	return func() {}
}

type shellTest struct {
	*anEndedSessionFixture
	w         ServiceWrapper
	page      *shellTestWindow
	ctx       context.Context
	r         *shellTestResources
	p         *shellTestProvider
	permitted bool
	id        string
}

func newShellTest(t *testing.T) *shellTest {
	t.Helper()
	f := newEndedSessionFixture(t)
	page := &shellTestWindow{id: 1}
	realm := invocation.NewWindowRealm(nil)
	principal := realm.ScopeForWindow(page).Principal()
	uid := "incarnation-of-object"
	r := &shellTestResources{rootCurrent: true, proof: resource.ExtensionRootProof{
		Owner: endedFixturePlugin, Connection: endedFixtureConnection, ViewID: "view", ViewGeneration: "generation", RowKey: "row",
		Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "canonical", Type: "thing", ID: "object", Authority: "authority", Scope: []resourcev2.ScopeEntry{}}, Incarnation: &uid},
	}}
	p := &shellTestProvider{}
	s := &shellTest{anEndedSessionFixture: f, w: ServiceWrapper{Ctrl: f.ctrl, Realm: realm}, page: page,
		ctx: context.WithValue(t.Context(), application.WindowKey, page), r: r, p: p, permitted: true, id: uuid.NewString()}
	f.install(endedFixturePlugin, p)
	f.ctrl.resourceClient = r
	f.ctrl.startTerminals(t.Context())
	f.ctrl.handlerMap[endedFixturePlugin] = map[string]sdkexec.Handler{"thing": {
		Plugin: "canonical", Resource: "thing", DefaultCommand: []string{"registered-shell"}, TargetBuilder: sdkexec.ActionTargetBuilder{Selectors: map[string]string{"target": "$.name"}},
	}}
	streamCtx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	f.ctrl.streams = map[string]execProviderStream{endedFixturePlugin: {ctx: streamCtx, cancel: cancel, done: make(chan struct{}), inputLock: &sync.RWMutex{}}}
	boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(who invocation.Principal, operation string, target invocation.Target) error {
		require.Equal(t, principal, who)
		require.Equal(t, "exec.CreateSession", operation)
		require.Equal(t, endedFixturePlugin, target.Provider)
		if !s.permitted {
			return resourcev2.NewError("FORBIDDEN", "Exec not permitted.")
		}
		return nil
	}))
	f.ctrl.SetReferenceAdmitter(func(ctx context.Context, operation, plugin string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) (context.Context, error) {
		require.Equal(t, r.proof.Reference, reference)
		require.Equal(t, r.proof.Connection, route.Connection)
		return boundary.Admit(ctx, operation, invocation.Target{Provider: plugin, Connection: route.Connection})
	})
	return s
}

func (s *shellTest) encoded(params map[string]string) string {
	s.t.Helper()
	data, err := json.Marshal(map[string]any{"id": s.id, "root": s.r.proof, "params": params})
	require.NoError(s.t, err)
	return string(data)
}

func encodedShellRoot(t *testing.T, proof resource.ExtensionRootProof) string {
	t.Helper()
	data, err := json.Marshal(proof)
	require.NoError(t, err)
	return string(data)
}

func (s *shellTest) launch() *ResourceShellAttachment {
	s.t.Helper()
	result, err := s.w.CreateResourceShell(s.ctx, endedFixturePlugin, s.encoded(map[string]string{"target": "a"}))
	require.NoError(s.t, err)
	require.Equal(s.t, s.id, result.ID)
	require.NotEmpty(s.t, result.Attachment)
	return result
}

func TestResourceShellRequiresRowExecAndRegisteredSelector(t *testing.T) {
	for _, tc := range []string{"missing window", "foreign row", "exec denial", "arbitrary argv", "resource body", "unadvertised mode", "missing selector", "large selector", "control character", "not a UUID"} {
		t.Run(tc, func(t *testing.T) {
			s := newShellTest(t)
			encoded := s.encoded(map[string]string{"target": "a"})
			ctx := s.ctx
			switch tc {
			case "missing window":
				ctx = t.Context()
			case "foreign row":
				s.r.rootCurrent = false
			case "exec denial":
				s.permitted = false
			case "arbitrary argv":
				encoded = strings.TrimSuffix(encoded, "}") + `,"command":["caller-command"]}`
			case "resource body":
				encoded = strings.TrimSuffix(encoded, "}") + `,"resource_data":{"kind":"map"}}`
			case "unadvertised mode":
				encoded = s.encoded(map[string]string{"mode": "other-operation"})
			case "missing selector":
				encoded = s.encoded(nil)
			case "large selector":
				encoded = s.encoded(map[string]string{"target": strings.Repeat("s", 257)})
			case "control character":
				encoded = s.encoded(map[string]string{"target": "bad\nvalue"})
			case "not a UUID":
				s.id = "session"
				encoded = s.encoded(nil)
			}
			result, err := s.w.CreateResourceShell(ctx, endedFixturePlugin, encoded)
			require.Error(t, err)
			require.Nil(t, result)
			require.Zero(t, s.p.creates)
		})
	}
}

func TestResourceShellFirstAttachAndWindowOwnedIO(t *testing.T) {
	s := newShellTest(t)
	a := s.launch()
	pid := s.p.session.ID
	require.NotEqual(t, s.id, pid)
	require.Equal(t, []byte("before attach"), a.Replay)
	require.True(t, s.p.opts.TTY)
	require.Nil(t, s.p.opts.ResourceData)
	require.Equal(t, []string{"registered-shell"}, s.p.opts.Command)
	require.Equal(t, map[string]string{"target": "a"}, s.p.opts.Params)
	require.Equal(t, s.r.proof.Reference, *s.p.opts.Reference)
	require.Positive(t, s.r.guardCalls)
	// Even a callback for the same numeric window ID cannot close the next generation's process.
	s.ctrl.releaseResourceShells(shellOwner{window: invocation.IdentityOf(s.page), scope: invocation.NewScope(invocation.TrustedUI)})
	require.Empty(t, s.p.closes)
	s.r.rootCurrent = false // navigation closed the launch view; the session did not move
	require.True(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, ""))
	require.True(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, ""), "a later opening can check its attachment before mounting the owner hook")
	s.r.rootCurrent = true
	s.r.proof.ViewID = "fresh-view" // the same native object can be observed again after navigation
	fresh := encodedShellRoot(t, s.r.proof)
	s.permitted = false
	require.False(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, fresh))
	s.permitted = true
	require.True(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, fresh))
	require.NoError(t, s.w.WriteResourceShell(s.ctx, s.id, a.Attachment, []byte("input")))
	input := <-s.ctrl.inChans[endedFixturePlugin]
	require.Equal(t, pid, input.SessionID)
	require.Equal(t, []byte("input"), input.Data)
	require.Error(t, s.w.WriteResourceShell(s.ctx, s.id, a.Attachment, make([]byte, resourceShellInputLimit+1)))
	require.Empty(t, s.ctrl.inChans[endedFixturePlugin])
	require.NoError(t, s.w.ResizeResourceShell(s.ctx, s.id, a.Attachment, 30, 90))
	s.frame(endedFixturePlugin, aStdoutFrame(pid, "after attach"))
	require.False(t, s.window.told(localOutputEvent+s.id), "output is never broadcast")
	frame, err := s.w.ReadResourceShell(s.ctx, s.id, a.Attachment)
	require.NoError(t, err)
	require.Equal(t, shellRunning, frame.State)
	require.Equal(t, []byte("after attach"), frame.Data)
	require.False(t, s.window.told(localOutputEvent+pid))
	other := context.WithValue(t.Context(), application.WindowKey, &shellTestWindow{id: 2})
	require.False(t, s.w.CheckResourceShell(other, s.id, a.Attachment, fresh))
	require.Error(t, s.w.WriteResourceShell(other, s.id, a.Attachment, []byte("input")))
	require.Error(t, s.w.ResizeResourceShell(other, s.id, a.Attachment, 30, 90))
	require.Error(t, s.w.CloseResourceShell(other, s.id, a.Attachment))
	for _, id := range []string{s.id, pid} {
		_, _, attachErr := s.w.AttachSession(id)
		require.Error(t, attachErr)
		_, detachErr := s.w.DetachSession(id)
		require.Error(t, detachErr)
		require.Error(t, s.w.WriteSession(id, []byte("legacy")))
		require.Error(t, s.w.ResizeSession(id, 30, 90))
		require.Error(t, s.w.CloseSession(id))
	}
	listed, err := s.w.ListSessions()
	require.NoError(t, err)
	require.Empty(t, listed, "no restore/adoption of another window's shell")
	s.page.retire(nil)
	require.Equal(t, []string{pid}, s.p.closes)
	frame, err = s.w.ReadResourceShell(s.ctx, s.id, a.Attachment)
	require.NoError(t, err)
	require.Equal(t, shellDetached, frame.State)
	require.False(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, fresh))
}

func TestResourceShellChecksActualProcessOnAttach(t *testing.T) {
	for _, why := range []string{"changed id", "wrong process", "not attached", "retained replay", "row retired", "window retired"} {
		t.Run(why, func(t *testing.T) {
			s := newShellTest(t)
			s.p.attachHook = func(answer *sdkexec.Session) {
				switch why {
				case "changed id":
					answer.ID = "other"
				case "wrong process":
					answer.CreatedAt = answer.CreatedAt.Add(time.Second)
				case "not attached":
					answer.Attached = false
				case "retained replay":
					s.p.session = sdkexec.Session{}
				case "row retired":
					s.r.rootCurrent = false
				case "window retired":
					s.page.retire(nil)
				}
			}
			a, err := s.w.CreateResourceShell(s.ctx, endedFixturePlugin, s.encoded(map[string]string{"target": "a"}))
			require.Nil(t, a)
			require.Error(t, err)
			require.Equal(t, 1, s.p.creates)
			require.Empty(t, s.p.session.ID, "no abandoned process after a rejected launch")
		})
	}
}

func TestResourceShellOldAttachmentCannotAffectReplacement(t *testing.T) {
	s := newShellTest(t)
	a := s.launch()
	old := s.p.session.ID
	require.NoError(t, s.w.CloseResourceShell(s.ctx, s.id, a.Attachment))
	b := s.launch() // deliberately reuse the public event ID
	require.NotEqual(t, a.Attachment, b.Attachment)
	require.NotEqual(t, old, s.p.session.ID)
	before := len(s.window.events)
	s.frame(endedFixturePlugin, aStdoutFrame(old, "late"))
	s.frame(endedFixturePlugin, aCloseSignal(old))
	s.frame(endedFixturePlugin, aCloseSignal(s.id)) // only private IDs identify a provider process
	require.Len(t, s.window.events, before)
	root := encodedShellRoot(t, s.r.proof)
	require.False(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, root))
	require.Error(t, s.w.WriteResourceShell(s.ctx, s.id, a.Attachment, []byte("late")))
	require.Error(t, s.w.ResizeResourceShell(s.ctx, s.id, a.Attachment, 30, 90))
	require.Error(t, s.w.CloseResourceShell(s.ctx, s.id, a.Attachment))
	require.True(t, s.w.CheckResourceShell(s.ctx, s.id, b.Attachment, root))
	s.p.session.CreatedAt = s.p.session.CreatedAt.Add(time.Hour) // same provider ID, independently observed different process
	require.False(t, s.w.CheckResourceShell(s.ctx, s.id, b.Attachment, root))
	frame, err := s.w.ReadResourceShell(s.ctx, s.id, b.Attachment)
	require.NoError(t, err)
	require.Equal(t, shellDetached, frame.State)
	require.Error(t, s.w.CloseResourceShell(s.ctx, s.id, b.Attachment))
	require.Equal(t, []string{old}, s.p.closes, "never close the replacement process")
}

func TestResourceShellRetiredRouteBlocksInputWithoutClosingTranscript(t *testing.T) {
	s := newShellTest(t)
	a := s.launch()
	s.r.routeRetired = true
	require.False(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, encodedShellRoot(t, s.r.proof)))
	require.Error(t, s.w.WriteResourceShell(s.ctx, s.id, a.Attachment, []byte("late")))
	require.Error(t, s.w.ResizeResourceShell(s.ctx, s.id, a.Attachment, 30, 90))
	require.Empty(t, s.ctrl.inChans[endedFixturePlugin])
	require.Empty(t, s.p.resizes)
	require.Empty(t, s.p.closes, "withdrawn menu eligibility does not dispose the user's shell")
	require.NoError(t, s.w.CloseResourceShell(s.ctx, s.id, a.Attachment), "the owner can still dispose the actual process")
}

func TestResourceShellStreamRetirementSignalsLostAttachment(t *testing.T) {
	s := newShellTest(t)
	a := s.launch()
	old := s.ctrl.streams[endedFixturePlugin]
	s.ctrl.endResourceShellStream(endedFixturePlugin, old.done)
	frame, err := s.w.ReadResourceShell(s.ctx, s.id, a.Attachment)
	require.NoError(t, err)
	require.Equal(t, shellDetached, frame.State)
	require.False(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, encodedShellRoot(t, s.r.proof)))
	require.Error(t, s.w.WriteResourceShell(s.ctx, s.id, a.Attachment, []byte("late")))
	require.Error(t, s.w.CloseResourceShell(s.ctx, s.id, a.Attachment))
}

func TestResourceShellPrivateReadWaitCancelAndFinalBytes(t *testing.T) {
	s := newShellTest(t)
	a := s.launch()
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := s.w.ReadResourceShell(ctx, s.id, a.Attachment)
		done <- err
	}()
	require.Eventually(t, func() bool {
		s.ctrl.mu.RLock()
		defer s.ctrl.mu.RUnlock()
		return s.ctrl.resourceShells[s.id].output.reading
	}, time.Second, time.Millisecond)
	_, err := s.w.ReadResourceShell(s.ctx, s.id, a.Attachment)
	require.Error(t, err, "one outstanding read per attachment")
	other := context.WithValue(t.Context(), application.WindowKey, &shellTestWindow{id: 2})
	foreign, err := s.w.ReadResourceShell(other, s.id, a.Attachment)
	require.NoError(t, err)
	require.Equal(t, shellDetached, foreign.State)
	require.Empty(t, foreign.Data)
	cancel()
	select {
	case readErr := <-done:
		require.ErrorIs(t, readErr, context.Canceled)
	case <-time.After(time.Second):
		t.Fatal("cancelled read remained blocked")
	}
	id := s.p.session.ID
	s.p.session = sdkexec.Session{} // real SDK removes GetSession before its ordered final frames
	require.False(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, encodedShellRoot(t, s.r.proof)))
	require.Error(t, s.w.WriteResourceShell(s.ctx, s.id, a.Attachment, []byte("late")))
	s.frame(endedFixturePlugin, aStdoutFrame(id, "first"))
	s.frame(endedFixturePlugin, sdkexec.StreamOutput{SessionID: id, Target: sdkexec.StreamTargetStdErr, Data: []byte("-second")})
	s.frame(endedFixturePlugin, aCloseSignal(id))
	require.False(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, encodedShellRoot(t, s.r.proof)), "no origin during held final output")
	final, err := s.w.ReadResourceShell(s.ctx, s.id, a.Attachment)
	require.NoError(t, err)
	require.Equal(t, shellEnded, final.State)
	require.Equal(t, "first-second", string(final.Data))
	gone, err := s.w.ReadResourceShell(s.ctx, s.id, a.Attachment)
	require.NoError(t, err)
	require.Equal(t, shellDetached, gone.State)
	require.Empty(t, gone.Data)
	require.Empty(t, s.window.events, "no private data or signal reached the global event transport")
}

func TestResourceShellPrivateBufferFailsClosedAtBound(t *testing.T) {
	s := newShellTest(t)
	a := s.launch()
	pid := s.p.session.ID
	s.p.closed = make(chan struct{})
	buf := make([]byte, resourceShellPendingLimit)
	buf[len(buf)-1] = '!'
	s.frame(endedFixturePlugin, sdkexec.StreamOutput{SessionID: pid, Data: buf})
	s.frame(endedFixturePlugin, aStdoutFrame(pid, "one byte too many"))
	// The failure, not a successful truncated replay, tells the page that the stream was lost.
	frame, err := s.w.ReadResourceShell(s.ctx, s.id, a.Attachment)
	require.NoError(t, err)
	require.Equal(t, shellFailed, frame.State)
	require.Len(t, frame.Data, resourceShellPendingLimit)
	require.Equal(t, byte('!'), frame.Data[len(frame.Data)-1])
	require.False(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, encodedShellRoot(t, s.r.proof)))
	require.Error(t, s.w.WriteResourceShell(s.ctx, s.id, a.Attachment, []byte("late")))
	require.Empty(t, s.window.events)
	select {
	case <-s.p.closed:
	case <-time.After(time.Second):
		t.Fatal("overflow did not close the provider process")
	}
}

func TestResourceShellDiagnosticRemainsPrivate(t *testing.T) {
	s := newShellTest(t)
	a := s.launch()
	s.frame(endedFixturePlugin, sdkexec.StreamOutput{SessionID: s.p.session.ID, Target: sdkexec.StreamTargetStdErr, Signal: sdkexec.StreamSignalError, Data: []byte("denied")})
	frame, err := s.w.ReadResourceShell(s.ctx, s.id, a.Attachment)
	require.NoError(t, err)
	wire, err := json.Marshal(frame)
	require.NoError(t, err)
	require.JSONEq(t, `{"state":"failed","data":"ZGVuaWVk"}`, string(wire))
	require.Empty(t, s.window.events)
}

func TestResourceShellMenuRequiresCurrentMemberAndGetPolicyAcrossProviderRead(t *testing.T) {
	s := newShellTest(t)
	a := s.launch()
	check := func(root string) bool { return s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, root) }
	root := encodedShellRoot(t, s.r.proof)
	before := s.p.gets
	for _, invalid := range []string{" ", "null", "[]", "{}", "{", root + root, strings.TrimSuffix(root, "}") + `,"body":{}}`,
		strings.TrimSuffix(root, "}") + `,"owner":"another"}`, strings.Repeat(" ", resourceShellRequestLimit+1)} {
		require.False(t, check(invalid), "invalid proof must not fall back to attachment-only inspection")
	}
	s.r.rootCurrent = false
	require.False(t, check(root), "resource.Get denial is independent of exec permission")
	s.r.rootCurrent = true
	s.permitted = false
	require.False(t, check(root), "native row membership cannot grant exec")
	require.Equal(t, before, s.p.gets)
	s.permitted = true
	s.p.getHook = func() { s.r.proof.ViewGeneration += ":next" }
	require.False(t, check(root), "same UID changed member revision during GetSession")
	s.p.getHook = nil
	require.Equal(t, before+1, s.p.gets)
	require.False(t, check(root), "the obsolete proof cannot begin another provider read")
	require.Equal(t, before+1, s.p.gets)
	fresh := encodedShellRoot(t, s.r.proof)
	s.p.getHook = func() { s.r.rootCurrent = false }
	require.False(t, check(fresh), "loss of Get permission during process observation also revokes delivery")
	s.p.getHook = nil
	s.r.rootCurrent = true
	require.True(t, check(fresh), "a new witness for the original resource works")
	require.Equal(t, 1, s.p.creates)
	require.Empty(t, s.ctrl.inChans[endedFixturePlugin])
	require.Empty(t, s.p.closes)
}

func TestResourceShellMenuBindsEntireAdmittedReferenceAndRoute(t *testing.T) {
	s := newShellTest(t)
	a := s.launch()
	original := s.r.proof
	root := encodedShellRoot(t, original)
	before := s.p.gets
	for _, field := range []string{"provider", "authority", "type", "id", "scope", "incarnation", "route"} {
		t.Run(field, func(t *testing.T) {
			changed := original
			switch field {
			case "provider":
				changed.Reference.Address.Provider += "-other"
			case "authority":
				changed.Reference.Address.Authority += "-other"
			case "type":
				changed.Reference.Address.Type += "-other"
			case "id":
				changed.Reference.Address.ID += "-other"
			case "scope":
				changed.Reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "other"}}
			case "incarnation":
				uid := "replacement-at-same-address"
				changed.Reference.Incarnation = &uid
			case "route":
				changed.Connection += "-other"
			}
			s.r.admitted = &changed // do not trust matching caller-supplied fields over the native result
			require.False(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, root))
			s.r.admitted = nil
			require.False(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, encodedShellRoot(t, changed)))
			require.Equal(t, before, s.p.gets)
		})
	}
	require.True(t, s.w.CheckResourceShell(s.ctx, s.id, a.Attachment, root))
}
