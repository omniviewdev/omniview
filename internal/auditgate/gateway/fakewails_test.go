package gateway_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

// fakeWails stands in for the host's loopback Wails server. It reproduces the
// behavior the gateway depends on, from the Wails v3 server-mode sources the
// host pins and the host's own request policy:
//
//   - the outer Host guard (requireAllowedHost, host_guard_server.go);
//   - the host's development request policy, which needs a loopback local
//     address, a Host naming that port, no cross-site Fetch Metadata, an
//     Origin that is absent or exactly http://<Host>, and a nonempty
//     x-wails-client-id on runtime calls (development_server_request_policy_server.go);
//   - POST /wails/runtime with Wails' origin rule (authorizeRuntimeOrigin), its
//     lenient decoder (case-insensitive keys, last duplicate wins) and its
//     window choice: the events socket's browser window for the client ID,
//     else x-wails-window-name, else the first window ("main");
//   - Window.Name answered as plain text, the way Wails' transport answers a
//     string (text/plain, no quotes);
//   - /wails/events as a coder/websocket server that sends its 101 first and
//     only then registers one browser window per connection under the clientId
//     query parameter, never retires the window, drops the mapping when the
//     socket closes, and broadcasts to every client.
//
// It also records everything it receives, so tests can assert what the
// gateway sent and what it did not.
type fakeWails struct {
	t      *testing.T
	server *httptest.Server
	addr   netip.AddrPort

	hits atomic.Int64

	mu        sync.Mutex
	paths     map[string]int
	runtime   []runtimeRecord
	probes    int
	lastStat  map[string]http.Header
	nextID    int
	opened    int
	windows   map[string]*fakeWindow
	sockets   map[*websocket.Conn]*fakeWindow
	dangerous int
	// canceledAt is when each blocked call saw its request canceled.
	canceledAt []time.Time

	verifyErr atomic.Pointer[error]
	// failEvents makes the events endpoint refuse upgrades.
	failEvents atomic.Bool
	// mappingDelay is how long the events endpoint waits after its 101 before
	// it registers the window: the real host does so with no delay worth
	// naming, which is the gap the gateway's mapping probe closes.
	mappingDelay atomic.Int64
	// stallEvents makes the events endpoint stop reading its socket, so it
	// never answers a close or a ping.
	stallEvents atomic.Bool
	stalled     chan struct{}
	// blockCalls makes GetInstanceInfo calls wait until their request is
	// canceled, which is how a call stays in flight.
	blockCalls  atomic.Bool
	callStarted chan struct{}

	slowStarted chan struct{}
	slowCancels atomic.Int64
	hugeSize    int
	// hugeChunks counts the chunks of the streamed response the fake has
	// written, so a test can tell when a client that reads nothing has made
	// the stream stall.
	hugeChunks atomic.Int64
}

type fakeWindow struct {
	id       int
	name     string
	clientID string
}

// runtimeRecord is one page call, /wails/runtime as the host received it. The
// gateway's own mapping probes are counted apart.
type runtimeRecord struct {
	Body   []byte
	Header http.Header
	Window string
	FQN    string
	CallID string
	At     time.Time
}

const bootDocument = `<!doctype html><html><head><script>window.__OMNIVIEW_INSTANCE__={"id":"fake"};</script></head>` +
	`<body><div id="root"></div><script src="/wails/custom.js"></script></body></html>`

func newFakeWails(t *testing.T) *fakeWails {
	t.Helper()
	f := &fakeWails{
		t:           t,
		paths:       make(map[string]int),
		lastStat:    make(map[string]http.Header),
		windows:     make(map[string]*fakeWindow),
		sockets:     make(map[*websocket.Conn]*fakeWindow),
		stalled:     make(chan struct{}),
		callStarted: make(chan struct{}, 64),
		slowStarted: make(chan struct{}, 16),
		hugeSize:    2 << 20,
	}
	f.server = httptest.NewServer(http.HandlerFunc(f.serve))
	var release sync.Once
	t.Cleanup(func() {
		release.Do(func() { close(f.stalled) })
		f.server.Close()
	})
	f.addr = tcpAddr(f.server.Listener.Addr()).AddrPort()
	return f
}

func (f *fakeWails) Address() netip.AddrPort { return f.addr }

func (f *fakeWails) Verify(context.Context) error {
	if err := f.verifyErr.Load(); err != nil {
		return *err
	}
	return nil
}

// failVerification makes every later Verify return err.
func (f *fakeWails) failVerification(err error) { f.verifyErr.Store(&err) }

// Hits is every request that reached the server, whatever it did with it.
func (f *fakeWails) Hits() int64 { return f.hits.Load() }

func (f *fakeWails) pathHits(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.paths[path]
}

// runtimeRecords are the page calls the host received, probes excluded.
func (f *fakeWails) runtimeRecords() []runtimeRecord {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]runtimeRecord(nil), f.runtime...)
}

// probeCount is how many mapping probes the host received.
func (f *fakeWails) probeCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.probes
}

// dangerousCalls counts calls that reached a method the allowlist denies.
func (f *fakeWails) dangerousCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.dangerous
}

// callsAsMain counts page calls the host ran as a window other than a browser
// window, which is what a call under an unknown client ID gets.
func (f *fakeWails) callsAsMain() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, record := range f.runtime {
		if !strings.HasPrefix(record.Window, "browser-") {
			n++
		}
	}
	return n
}

func (f *fakeWails) headerFor(path string) http.Header {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastStat[path].Clone()
}

// windowsOpened is how many browser windows the host created: one per events
// socket connection, never retired.
func (f *fakeWails) windowsOpened() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.opened
}

// clientIDs are the client IDs of the open events sockets.
func (f *fakeWails) clientIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var ids []string
	for _, window := range f.sockets {
		ids = append(ids, window.clientID)
	}
	return ids
}

// callsCanceledAt are the times blocked calls saw their request canceled.
func (f *fakeWails) callsCanceledAt() []time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]time.Time(nil), f.canceledAt...)
}

func (f *fakeWails) openSockets() []*websocket.Conn {
	f.mu.Lock()
	defer f.mu.Unlock()
	conns := make([]*websocket.Conn, 0, len(f.sockets))
	for conn := range f.sockets {
		conns = append(conns, conn)
	}
	return conns
}

// broadcast sends one message to every open events socket.
func (f *fakeWails) broadcast(kind websocket.MessageType, data []byte) {
	for _, conn := range f.openSockets() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = conn.Write(ctx, kind, data)
		cancel()
	}
}

// flood sends count messages of about size bytes each, one after another and
// pause apart, to every open events socket, giving each write at most
// perWrite. It fails when a write stalls, which is what a gateway that stopped
// reading the host would cause: the real host queues without a bound, and this
// write is where that queue's consumer would block. A socket that has gone
// away is not a failure, and ends the flood.
func (f *fakeWails) flood(name string, count, size int, perWrite, pause time.Duration) error {
	message := event(name, strings.Repeat("x", size))
	for range count {
		sockets := f.openSockets()
		if len(sockets) == 0 {
			return nil
		}
		for _, conn := range sockets {
			ctx, cancel := context.WithTimeout(context.Background(), perWrite)
			err := conn.Write(ctx, websocket.MessageText, message)
			cancel()
			if errors.Is(err, context.DeadlineExceeded) {
				return err
			}
			if err != nil {
				return nil //nolint:nilerr // A socket that is gone ends the flood; only a stalled write is a failure.
			}
		}
		if pause > 0 {
			time.Sleep(pause)
		}
	}
	return nil
}

// closeEventSockets closes every events socket from the host's side.
func (f *fakeWails) closeEventSockets() {
	for _, conn := range f.openSockets() {
		go func() { _ = conn.Close(websocket.StatusGoingAway, "") }()
	}
}

// event builds a Wails custom event frame.
func event(name string, data any) []byte {
	frame, err := json.Marshal(map[string]any{"name": name, "data": data, "sender": ""})
	if err != nil {
		panic(err)
	}
	return frame
}

func (f *fakeWails) serve(w http.ResponseWriter, r *http.Request) {
	f.hits.Add(1)
	f.mu.Lock()
	f.paths[r.URL.Path]++
	f.lastStat[r.URL.Path] = r.Header.Clone()
	f.mu.Unlock()
	if !hostAllowed(r.Host) {
		http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
		return
	}
	switch r.URL.Path {
	case "/health":
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	case "/wails/custom.js":
		w.Header().Set("Content-Type", "application/javascript")
		_, _ = w.Write([]byte("/* custom */"))
	case "/wails/events":
		if f.failEvents.Load() {
			http.Error(w, "events unavailable", http.StatusServiceUnavailable)
			return
		}
		f.events(w, r)
	default:
		f.assets(w, r)
	}
}

// hostAllowed is requireAllowedHost for a loopback bind: localhost and IP
// literals pass, any other name is a rebinding attempt.
func hostAllowed(requestHost string) bool {
	host, _, err := net.SplitHostPort(requestHost)
	if err != nil {
		host = strings.Trim(requestHost, "[]")
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	_, err = netip.ParseAddr(host)
	return err == nil
}

// developmentRequestAllowed is developmentServerRequestAllowed, which guards
// everything behind the asset chain, including runtime calls.
func developmentRequestAllowed(r *http.Request) bool {
	local, ok := r.Context().Value(http.LocalAddrContextKey).(*net.TCPAddr)
	if !ok || !local.IP.IsLoopback() {
		return false
	}
	host, port, err := net.SplitHostPort(r.Host)
	if err != nil {
		return false
	}
	if host != "localhost" {
		if addr, parseErr := netip.ParseAddr(host); parseErr != nil || !addr.IsLoopback() {
			return false
		}
	}
	if port != strconv.Itoa(local.Port) {
		return false
	}
	for _, site := range r.Header.Values("Sec-Fetch-Site") {
		if strings.EqualFold(site, "cross-site") || strings.EqualFold(site, "same-site") {
			return false
		}
	}
	if origins := r.Header.Values("Origin"); len(origins) != 0 {
		if len(origins) != 1 || origins[0] != "http://"+r.Host {
			return false
		}
	}
	if r.URL.Path == "/wails/runtime" && strings.TrimSpace(r.Header.Get("x-wails-client-id")) == "" {
		return false
	}
	return true
}

func (f *fakeWails) assets(w http.ResponseWriter, r *http.Request) {
	if !developmentRequestAllowed(r) {
		http.Error(w, "development server request forbidden", http.StatusForbidden)
		return
	}
	w.Header().Set("X-Frame-Options", "DENY")
	switch p := r.URL.Path; {
	case p == "/wails/runtime":
		f.runtimeCall(w, r)
	case p == "/":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, bootDocument)
	case p == "/wails/runtime.js" || p == "/wails/transport.js":
		w.Header().Set("Content-Type", "application/javascript")
		_, _ = io.WriteString(w, "/* wails */")
	case p == "/assets/app.js":
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		_, _ = io.WriteString(w, "console.log('app');")
	case p == "/assets/leaky.js":
		f.leaky(w)
	case p == "/assets/redirect.js":
		http.Redirect(w, r, "https://evil.example/x", http.StatusMovedPermanently)
	case p == "/assets/huge.js":
		f.huge(w, true)
	case p == "/assets/stream.js":
		f.huge(w, false)
	case p == "/assets/slow.js":
		f.slow(w, r)
	case p == "/_/plugins/demo/assets/entry.js":
		w.Header().Set("Content-Type", "application/javascript")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_, _ = io.WriteString(w, "/* demo plugin */")
	case strings.HasPrefix(p, "/wails/stream/") || strings.HasPrefix(p, "/wails/eventpayload/"):
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, "reached an upstream-only route")
	default:
		http.NotFound(w, r)
	}
}

// leaky answers with every header the gateway must not pass on, and with a
// content type that is not one.
func (f *fakeWails) leaky(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Content-Type", "application/javascript")
	h.Add("Set-Cookie", "sid=upstream-session; Path=/")
	h.Set("WWW-Authenticate", `Basic realm="upstream"`)
	h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	h.Set("Location", "https://evil.example/")
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("X-Powered-By", "fake")
	h.Set("Cache-Control", "public, max-age=86400")
	_, _ = io.WriteString(w, "leak")
}

func (f *fakeWails) huge(w http.ResponseWriter, withLength bool) {
	w.Header().Set("Content-Type", "application/javascript")
	if withLength {
		w.Header().Set("Content-Length", strconv.Itoa(f.hugeSize))
	}
	chunk := make([]byte, 32<<10)
	for written := 0; written < f.hugeSize; written += len(chunk) {
		if _, err := w.Write(chunk); err != nil {
			return
		}
		f.hugeChunks.Add(1)
		if !withLength {
			_ = http.NewResponseController(w).Flush()
		}
	}
}

// waitHugeStalled waits until the streamed response stops making progress:
// the fake's writes are blocked by a client that does not read, all the way
// back through the gateway. A fixed sleep would only guess that the socket
// buffers have filled, and on a busy machine they may not have.
func (f *fakeWails) waitHugeStalled(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	last, unchanged := int64(-1), 0
	for time.Now().Before(deadline) {
		now := f.hugeChunks.Load()
		if now > 0 && now == last {
			if unchanged++; unchanged >= 3 {
				return
			}
		} else {
			unchanged = 0
		}
		last = now
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("the streamed response never stalled")
}

func (f *fakeWails) slow(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript")
	w.WriteHeader(http.StatusOK)
	_ = http.NewResponseController(w).Flush()
	f.slowStarted <- struct{}{}
	<-r.Context().Done()
	f.slowCancels.Add(1)
}

// authorizeRuntimeOrigin is Wails' runtime origin rule.
func authorizeRuntimeOrigin(r *http.Request) error {
	origin := r.Header.Get("Origin")
	if origin == "" {
		switch r.Header.Get("Sec-Fetch-Site") {
		case "cross-site", "same-site":
			return errors.New("cross-origin runtime request")
		}
		return nil
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || !strings.EqualFold(r.Host, u.Host) {
		return errors.New("runtime request origin not permitted")
	}
	return nil
}

// runtimeCall is Wails' POST /wails/runtime. Its decoder is the lenient one the
// gateway's strict parsing exists to outrun.
func (f *fakeWails) runtimeCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if authorizeRuntimeOrigin(r) != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<20))
	if err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	var request struct {
		Object *int            `json:"object"`
		Method *int            `json:"method"`
		Args   json.RawMessage `json:"args"`
	}
	if json.Unmarshal(body, &request) != nil || request.Object == nil || request.Method == nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	record := runtimeRecord{
		Body: body, Header: r.Header.Clone(), Window: f.targetWindow(r), FQN: "", CallID: "", At: time.Now(),
	}
	if r.Header.Get("X-Omniview-Audit-Probe") != "" {
		f.mu.Lock()
		f.probes++
		f.mu.Unlock()
		f.answerRuntime(w, r, &record, request.Object, request.Method, request.Args, false)
		return
	}
	f.answerRuntime(w, r, &record, request.Object, request.Method, request.Args, true)
}

func (f *fakeWails) answerRuntime(
	w http.ResponseWriter, r *http.Request, record *runtimeRecord, object, method *int, args json.RawMessage, remember bool,
) {
	switch {
	case *object == 0 && *method == 0:
		f.boundCall(w, r, record, args)
	case *object == 6 && *method == 18:
		if remember {
			f.remember(*record)
		}
		// Wails answers a string result as text/plain, with no quoting.
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, record.Window)
	case *object == 10 && *method == 0:
		f.remember(*record)
		writeJSON(w, http.StatusOK, "")
	default:
		f.remember(*record)
		http.Error(w, "unknown runtime method", http.StatusBadRequest)
	}
}

// targetWindow is getTargetWindow: the events socket's window for the client ID
// first, then a named window, then the first window.
func (f *fakeWails) targetWindow(r *http.Request) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if window := f.windows[r.Header.Get("x-wails-client-id")]; window != nil {
		return window.name
	}
	if name := r.Header.Get("x-wails-window-name"); name != "" {
		return name
	}
	return "main"
}

func (f *fakeWails) remember(record runtimeRecord) {
	f.mu.Lock()
	f.runtime = append(f.runtime, record)
	f.mu.Unlock()
}

func (f *fakeWails) boundCall(w http.ResponseWriter, r *http.Request, record *runtimeRecord, rawArgs json.RawMessage) {
	var args map[string]json.RawMessage
	_ = json.Unmarshal(rawArgs, &args)
	_ = json.Unmarshal(args["call-id"], &record.CallID)
	var name string
	_ = json.Unmarshal(args["methodName"], &name)
	if name == "" {
		var id uint32
		_ = json.Unmarshal(args["methodID"], &id)
		name = knownMethods()[id]
	}
	record.FQN = name
	f.remember(*record)
	if name == "" {
		http.Error(w, "unknown method", http.StatusBadRequest)
		return
	}
	policy := mustPolicy()
	if rule, ok := policy.Method(name); ok && rule.Decision == auditgate.Deny {
		f.mu.Lock()
		f.dangerous++
		f.mu.Unlock()
	}
	if name == "main.AppService.GetInstanceInfo" && f.blockCalls.Load() {
		f.callStarted <- struct{}{}
		<-r.Context().Done()
		f.mu.Lock()
		f.canceledAt = append(f.canceledAt, time.Now())
		f.mu.Unlock()
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "method": name, "window": record.Window})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

var (
	policyOnce  sync.Once         //nolint:gochecknoglobals // Test fixture, built once.
	policyValue *auditgate.Policy //nolint:gochecknoglobals // Test fixture, built once.
	idsValue    map[uint32]string //nolint:gochecknoglobals // Test fixture, built once.
)

func mustPolicy() *auditgate.Policy {
	policyOnce.Do(func() {
		policy, err := auditgate.Default()
		if err != nil {
			panic(err)
		}
		policyValue = policy
		idsValue = make(map[uint32]string)
		for _, rule := range policy.Methods() {
			idsValue[auditgate.MethodID(rule.FQN)] = rule.FQN
		}
	})
	return policyValue
}

func knownMethods() map[uint32]string {
	mustPolicy()
	return idsValue
}

// events is the /wails/events broadcaster: one browser window per connection,
// registered under the clientId query parameter after the 101 has been sent,
// and never retired.
func (f *fakeWails) events(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{})
	if err != nil {
		return
	}
	clientID := r.URL.Query().Get("clientId")
	if delay := time.Duration(f.mappingDelay.Load()); delay > 0 {
		time.Sleep(delay)
	}
	f.mu.Lock()
	f.nextID++
	f.opened++
	window := &fakeWindow{id: f.nextID, name: fmt.Sprintf("browser-%d", f.nextID), clientID: clientID}
	if clientID != "" {
		f.windows[clientID] = window
	}
	f.sockets[conn] = window
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		delete(f.sockets, conn)
		if clientID != "" && f.windows[clientID] == window {
			delete(f.windows, clientID)
		}
		f.mu.Unlock()
		if f.stallEvents.Load() {
			_ = conn.CloseNow()
			return
		}
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}()
	if f.stallEvents.Load() {
		// Read nothing: no pong, no answer to a close.
		<-f.stalled
		return
	}
	for {
		if _, _, err = conn.Read(r.Context()); err != nil {
			return
		}
	}
}
