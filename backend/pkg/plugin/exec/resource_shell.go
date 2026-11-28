package exec

import (
	"context"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	"github.com/omniviewdev/omniview/backend/pkg/transportjson"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// The page chooses a public session ID; the host issues an attachment only after verification.
// The provider uses a private, never-reused ID so delayed frames and operations cannot migrate.
const resourceProcessPrefix = "omniview-resource-shell/"

const resourceShellInputLimit = 64 << 10

func isResourceProcessID(id string) bool { return strings.HasPrefix(id, resourceProcessPrefix) }

// ResourceShellAttachment is returned only to the launching window. Read the provider's first
// attach replay before calling ReadResourceShell for later output. Neither ID is persisted.
type ResourceShellAttachment struct {
	ID         string `json:"id"`
	Attachment string `json:"attachment"`
	Replay     []byte `json:"replay"`
}

type resourceShellRequest struct {
	ID     string                      `json:"id"`
	Root   resource.ExtensionRootProof `json:"root"`
	Params map[string]string           `json:"params"`
}

type resourceShellSources interface {
	AdmitExtensionRoot(context.Context, string, resource.ExtensionRootProof) (resourcev2.ResourceReference, resourcev2.AccessRoute, func(context.Context) error, error)
	GuardExtensionRootRoute(context.Context, string, resource.ExtensionRootProof) (func(context.Context) error, error)
}

var _ resourceShellSources = (resource.Controller)(nil)

type resourceShellController interface {
	createResourceShell(context.Context, shellOwner, string, resourceShellRequest) (*ResourceShellAttachment, error)
	checkResourceShell(context.Context, shellOwner, string, string, string) bool
	readResourceShell(context.Context, shellOwner, string, string) (*ResourceShellRead, error)
	writeResourceShell(context.Context, shellOwner, string, string, []byte) error
	resizeResourceShell(context.Context, shellOwner, string, string, uint16, uint16) error
	closeResourceShell(context.Context, shellOwner, string, string) error
	releaseResourceShells(shellOwner)
}

type shellOwner struct {
	window invocation.WindowIdentity
	scope  *invocation.Scope
}

type resourceShell struct {
	id, process, attachment string
	owner                   shellOwner
	plugin                  string
	reference               resourcev2.ResourceReference
	route                   resourcev2.AccessRoute
	guard                   func(context.Context) error // cheap route generation/authority check, independent of the launch view
	provider                Provider
	input                   chan sdkexec.StreamInput
	stream                  execProviderStream
	lifetime                context.Context
	cancel                  context.CancelFunc
	output                  shellOutput
	// created is set once, under controller.mu, when the verified attachment is published.
	// A zero value is a pending launch: that launch, not window release, owns its rollback.
	created time.Time
}

func invalidShellRequest() error {
	return resourcev2.NewError("INVALID_REQUEST", "Invalid resource shell request.")
}

func shellUnavailable() error {
	// In particular, do not distinguish a foreign window's attachment from a nonexistent one.
	return apperror.SessionNotFound("")
}

func (r resourceShellRequest) valid(owner string) bool {
	id, err := uuid.Parse(r.ID)
	if err != nil || id.Version() != 4 || id.Variant() != uuid.RFC4122 || id.String() != r.ID ||
		owner == "" || owner == localPluginID || r.Root.Owner != owner || len(r.Params) > 8 {
		return false
	}
	for k, v := range r.Params {
		if len(k) == 0 || len(k) > 64 || len(v) == 0 || len(v) > 256 ||
			strings.IndexFunc(k, unicode.IsControl) >= 0 || strings.IndexFunc(v, unicode.IsControl) >= 0 {
			return false
		}
	}
	return true
}

func (c *controller) createResourceShell(ctx context.Context, owner shellOwner, plugin string, r resourceShellRequest) (*ResourceShellAttachment, error) {
	if !r.valid(plugin) {
		return nil, invalidShellRequest()
	}
	sources, ok := c.resourceClient.(resourceShellSources)
	if !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Resource shell admission unavailable.")
	}
	ref, route, rootCurrent, err := sources.AdmitExtensionRoot(ctx, plugin, r.Root)
	if err != nil {
		return nil, err
	}
	if rootCurrent == nil || ref.Incarnation == nil || *ref.Incarnation == "" || route.Connection == "" || route.Connection != r.Root.Connection {
		return nil, invalidShellRequest()
	}
	routeCurrent, err := sources.GuardExtensionRootRoute(ctx, plugin, r.Root)
	if err != nil {
		return nil, err
	}
	if routeCurrent == nil {
		return nil, shellUnavailable()
	}
	// Root membership never grants exec. Use exactly the reference admission used by CreateSession.
	admitted, err := c.admitSessionReference(ctx, plugin, route.Connection, &ref, &route)
	if err != nil {
		return nil, err
	}
	pc := c.getConnectedCtx(admitted, plugin, route.Connection)
	if pc == nil {
		return nil, shellUnavailable()
	}
	// reserveShell binds the private ID and registered command. No legacy resource body is sent.
	opts := sdkexec.SessionOptions{
		Params:         r.Params,
		Labels:         nil,
		ID:             "",
		ResourcePlugin: "",
		ResourceKey:    "",
		ResourceData:   nil,
		Reference:      &ref,
		Route:          &route,
		Command:        nil,
		TTY:            true,
	}
	s, err := c.reserveShell(owner, plugin, r.ID, routeCurrent, &opts)
	if err != nil {
		return nil, err
	}
	return c.launchReservedResourceShell(pc, s, &opts, rootCurrent)
}

// Only the launch needs both the original row witness and the longer-lived route guard.
func (s *resourceShell) revalidateLaunch(ctx context.Context, rootCurrent func(context.Context) error) error {
	if err := rootCurrent(ctx); err != nil {
		return err
	}
	return s.guard(ctx)
}

func (c *controller) launchReservedResourceShell(
	pc *sdktypes.PluginContext, s *resourceShell, opts *sdkexec.SessionOptions, rootCurrent func(context.Context) error,
) (*ResourceShellAttachment, error) {
	launch, cancel := context.WithCancel(pc.Context)
	stop := context.AfterFunc(s.lifetime, cancel)
	defer func() { stop(); cancel() }()
	pc.Context = launch // the SDK detaches the accepted process from its creation RPC
	var created time.Time
	attempted, published := false, false
	defer func() {
		if published {
			return
		}
		c.dropResourceShell(s)
		if attempted {
			// Even an ambiguous RPC failure can leave the requested private process running.
			// Never clean up an ID supplied by the provider in a mismatched response.
			c.cleanupResourceProcess(s, created)
		}
	}()
	if err := s.revalidateLaunch(launch, rootCurrent); err != nil {
		return nil, err
	}
	attempted = true
	session, err := s.provider.CreateSession(pc, *opts)
	if err != nil {
		return nil, err
	}
	if session == nil || session.ID != s.process || session.CreatedAt.IsZero() || session.Attached {
		return nil, shellUnavailable()
	}
	created = session.CreatedAt
	if s.lifetime.Err() != nil || launch.Err() != nil {
		return nil, shellUnavailable()
	}
	replay, err := c.attachResourceProcess(pc, s, created)
	if err != nil {
		return nil, err
	}
	if err = s.revalidateLaunch(launch, rootCurrent); err != nil {
		return nil, err
	}
	c.mu.Lock()
	if c.resourceShells[s.id] == s && s.lifetime.Err() == nil && c.streams[s.plugin].done == s.stream.done && launch.Err() == nil {
		s.created = created
		published = true
	}
	c.mu.Unlock()
	if !published {
		return nil, shellUnavailable()
	}
	if replay == nil {
		replay = []byte{} // always base64 text on the wire, including an empty replay
	}
	return &ResourceShellAttachment{ID: s.id, Attachment: s.attachment, Replay: replay}, nil
}

func (c *controller) attachResourceProcess(pc *sdktypes.PluginContext, s *resourceShell, created time.Time) ([]byte, error) {
	c.mu.Lock()
	s.output.accepting = true
	c.mu.Unlock()
	attached, replay, err := s.provider.AttachSession(pc, s.process)
	if err != nil {
		return nil, err
	}
	if !s.sameProcess(attached, created) || !attached.Attached || len(replay) > sdkexec.DefaultOutputBufferSize {
		return nil, shellUnavailable()
	}
	// Attach also succeeds against the SDK's retained output after process exit. Prove the process independently.
	live, err := s.provider.GetSession(pc, s.process)
	if err != nil || !s.sameProcess(live, created) || !live.Attached {
		return nil, shellUnavailable()
	}
	return replay, nil
}

func (c *controller) reserveShell(
	owner shellOwner, plugin, id string, guard func(context.Context) error, opts *sdkexec.SessionOptions,
) (*resourceShell, error) {
	process := resourceProcessPrefix + id + "/" + uuid.NewString()
	attachment := uuid.NewString()
	// Reserve before starting the process. All index and channel-terminal lanes check this same namespace.
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.idHeldLocked(id) {
		return nil, terminal.IDInUse(id)
	}
	if len(c.resourceShells) >= resourceShellLimit {
		return nil, resourcev2.NewError("RESOURCE_LIMIT", "Too many resource shell attachments.")
	}
	provider, stream, input := c.clients[plugin], c.streams[plugin], c.inChans[plugin]
	if provider == nil || stream.ctx == nil || stream.ctx.Err() != nil || stream.inputLock == nil || input == nil {
		return nil, shellUnavailable()
	}
	address := &opts.Reference.Address
	handler, ok := c.handlerMap[plugin][address.Type]
	if !ok || handler.Plugin != address.Provider || handler.Resource != address.Type || len(handler.DefaultCommand) == 0 {
		return nil, resourcev2.NewError("UNSUPPORTED", "The resource provider did not register a default shell.")
	}
	// Provider metadata defines both the argv and the selector vocabulary. Never interpret a value
	// as an argv, accept an alternate mode, or turn frontend fields into a resource body.
	if len(opts.Params) != len(handler.TargetBuilder.Selectors) {
		return nil, invalidShellRequest()
	}
	for key := range opts.Params {
		if _, registered := handler.TargetBuilder.Selectors[key]; !registered {
			return nil, invalidShellRequest()
		}
	}
	opts.ID, opts.Command = process, handler.DefaultCommand
	wake := make(chan struct{}, 1)
	lifetime, cancel := context.WithCancel(stream.ctx)
	s := &resourceShell{
		id:         id,
		process:    process,
		attachment: attachment,
		owner:      owner,
		plugin:     plugin,
		reference:  *opts.Reference,
		route:      *opts.Route,
		guard:      guard,
		provider:   provider,
		input:      input,
		stream:     stream,
		lifetime:   lifetime,
		cancel:     cancel,
		output: shellOutput{
			wake:      wake,
			pending:   nil,
			reading:   false,
			accepting: false,
			final:     "",
			expiry:    nil,
		},
		created: time.Time{},
	}
	c.resourceShells[id] = s
	return s, nil
}

func (s *resourceShell) sameProcess(result *sdkexec.Session, created time.Time) bool {
	return result != nil && result.ID == s.process && !created.IsZero() && result.CreatedAt.Equal(created)
}

func (c *controller) shellFor(owner shellOwner, id, attachment string) *resourceShell {
	c.mu.RLock()
	defer c.mu.RUnlock()
	s := c.resourceShells[id]
	if s == nil || s.owner != owner || s.attachment != attachment || s.created.IsZero() || s.lifetime.Err() != nil || c.streams[s.plugin].done != s.stream.done {
		return nil
	}
	return s
}

func (c *controller) checkResourceShell(ctx context.Context, owner shellOwner, id, attachment, encodedRoot string) bool {
	s := c.shellFor(owner, id, attachment)
	if s == nil || s.guard(ctx) != nil {
		return false
	}
	var currentRoot func(context.Context) error
	if encodedRoot != "" {
		var proof resource.ExtensionRootProof
		if len(encodedRoot) > resourceShellRequestLimit || transportjson.Decode(encodedRoot, &proof, id, attachment) != nil ||
			proof.Owner != s.plugin || !s.matchesRoot(proof.Reference, resourcev2.AccessRoute{Connection: proof.Connection}) {
			return false
		}
		sources, ok := c.resourceClient.(resourceShellSources)
		if !ok {
			return false
		}
		ref, route, witness, err := sources.AdmitExtensionRoot(ctx, s.plugin, proof)
		if err != nil || witness == nil || !s.matchesRoot(ref, route) {
			return false
		}
		currentRoot = witness
	}
	// Membership and Get authority never substitute for ordinary exec authorization.
	admitted, err := c.admitSessionReference(ctx, s.plugin, s.route.Connection, &s.reference, &s.route)
	if err != nil {
		return false
	}
	pc := c.getConnectedCtx(admitted, s.plugin, s.route.Connection)
	if pc == nil {
		return false
	}
	live, err := s.provider.GetSession(pc, s.process)
	if currentRoot != nil && currentRoot(ctx) != nil {
		// The captured native witness rechecks the same member revision, reference and route,
		// including Get authorization, after the provider's independent attachment observation.
		return false
	}
	if err != nil || !s.sameProcess(live, s.created) || !live.Attached {
		switch {
		case sessionGone(err):
			c.resourceProcessGone(s)
		case err == nil:
			c.dropResourceShell(s) // different process or attachment: never transfer ownership
		}
		return false
	}
	return s.guard(ctx) == nil && c.shellFor(owner, id, attachment) == s
}

func (s *resourceShell) matchesRoot(ref resourcev2.ResourceReference, route resourcev2.AccessRoute) bool {
	a, b := s.reference.Address, ref.Address
	return route == s.route && a.Provider == b.Provider && a.Authority == b.Authority && a.Type == b.Type &&
		a.ID == b.ID && slices.Equal(a.Scope, b.Scope) && ref.Incarnation != nil && *ref.Incarnation == *s.reference.Incarnation
}

func (c *controller) writeResourceShell(ctx context.Context, owner shellOwner, id, attachment string, data []byte) error {
	s := c.shellFor(owner, id, attachment)
	if s == nil {
		return shellUnavailable()
	}
	if len(data) == 0 || len(data) > resourceShellInputLimit {
		return invalidShellRequest()
	}
	s.stream.inputLock.RLock()
	defer s.stream.inputLock.RUnlock()
	if s.lifetime.Err() != nil {
		return shellUnavailable()
	}
	if err := s.guard(ctx); err != nil {
		return err
	}
	select {
	case <-s.lifetime.Done():
		return shellUnavailable()
	case <-ctx.Done():
		return ctx.Err()
	case s.input <- sdkexec.StreamInput{SessionID: s.process, Data: data}:
		return nil
	}
}

func (c *controller) resizeResourceShell(ctx context.Context, owner shellOwner, id, attachment string, rows, cols uint16) error {
	s := c.shellFor(owner, id, attachment)
	if s == nil {
		return shellUnavailable()
	}
	if rows == 0 || cols == 0 {
		return invalidShellRequest()
	}
	pc := c.getConnectedCtx(ctx, s.plugin, s.route.Connection)
	if pc == nil || s.lifetime.Err() != nil {
		return shellUnavailable()
	}
	if err := s.guard(ctx); err != nil {
		return err
	}
	return s.provider.ResizeSession(pc, s.process, int32(cols), int32(rows))
}

func (c *controller) closeResourceShell(ctx context.Context, owner shellOwner, id, attachment string) error {
	c.mu.Lock()
	s := c.resourceShells[id]
	if s == nil || s.owner != owner || s.attachment != attachment || s.created.IsZero() {
		c.mu.Unlock()
		return shellUnavailable()
	}
	s.cancel() // fence writes and origin immediately, including while a failed close is retried
	created := s.created
	c.mu.Unlock()
	if err := c.closeResourceProcess(ctx, s, created); err != nil {
		return err
	}
	c.dropResourceShell(s)
	return nil
}

func (c *controller) closeResourceProcess(ctx context.Context, s *resourceShell, created time.Time) error {
	// Closing remains possible after connection loss. This addresses only our process on our
	// captured provider. It does not fetch connection credentials, start a shell, or reattach.
	pc := c.getUnconnectedCtx(ctx, s.plugin)
	live, err := s.provider.GetSession(pc, s.process)
	if sessionGone(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if live == nil || live.ID != s.process || (!created.IsZero() && !s.sameProcess(live, created)) {
		return nil // no longer our process
	}
	err = s.provider.CloseSession(pc, s.process)
	if sessionGone(err) {
		return nil
	}
	return err
}

func (c *controller) cleanupResourceProcess(s *resourceShell, created time.Time) {
	ctx := invocation.HostContext(context.Background())
	if err := c.closeResourceProcess(ctx, s, created); err != nil {
		c.logger.Warnw(ctx, "could not close retired resource shell", "pluginID", s.plugin, "errorClass", telemetryutil.ErrorClass(err))
	}
}

// Drop exactly the retiring attachment. A delayed callback must never release its replacement.
func (c *controller) dropResourceShell(s *resourceShell) {
	c.mu.Lock()
	if c.resourceShells[s.id] == s {
		c.forgetResourceShellLocked(s)
	}
	c.mu.Unlock()
}

func (c *controller) releaseResourceShells(owner shellOwner) {
	c.retireResourceShells(func(s *resourceShell) bool { return s.owner == owner })
}

func (c *controller) endResourceShellStream(plugin string, done <-chan struct{}) {
	c.retireResourceShells(func(s *resourceShell) bool { return s.plugin == plugin && s.stream.done == done })
}

// Cancel attachments before waiting for any provider to close. A pending launch cleans up on
// its own return, even if accepted during retirement. Unexpected stream loss must not orphan a PTY.
func (c *controller) retireResourceShells(retired func(*resourceShell) bool) {
	var shells []*resourceShell
	c.mu.Lock()
	for _, s := range c.resourceShells {
		if retired(s) {
			c.forgetResourceShellLocked(s)
			shells = append(shells, s)
		}
	}
	c.mu.Unlock()
	for _, s := range shells {
		if !s.created.IsZero() {
			c.cleanupResourceProcess(s, s.created)
		}
	}
}
