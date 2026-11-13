package gateway

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

func TestReadMessageCapsWithoutBuffering(t *testing.T) {
	msg, complete, err := readMessage(strings.NewReader("hello"), 10)
	if err != nil || !complete || string(msg) != "hello" {
		t.Fatalf("small message: %q %v %v", msg, complete, err)
	}
	msg, complete, err = readMessage(strings.NewReader("0123456789"), 10)
	if err != nil || !complete || len(msg) != 10 {
		t.Fatalf("message at the limit: %d bytes, complete=%v err=%v", len(msg), complete, err)
	}
	// One byte over: dropped, and the rest of the message is consumed so the
	// next message starts clean.
	reader := io.MultiReader(strings.NewReader("0123456789A"), strings.NewReader("rest of the same message"))
	msg, complete, err = readMessage(reader, 10)
	if err != nil || complete || msg != nil {
		t.Fatalf("oversized message: %q complete=%v err=%v", msg, complete, err)
	}
	if rest, _ := io.ReadAll(reader); len(rest) != 0 {
		t.Fatalf("%d bytes of the oversized message were left unread", len(rest))
	}
	boom := errors.New("boom")
	if _, _, err = readMessage(io.MultiReader(strings.NewReader("ab"), errReader{boom}), 10); !errors.Is(err, boom) {
		t.Fatalf("a read error = %v", err)
	}
}

type errReader struct{ err error }

func (e errReader) Read([]byte) (int, error) { return 0, e.err }

func TestUpgradeRequestsMustBeCleanWebSocketUpgrades(t *testing.T) {
	valid := func() http.Header {
		return http.Header{
			"Connection":            {"keep-alive, Upgrade"},
			"Upgrade":               {"WebSocket"},
			"Sec-Websocket-Version": {"13"},
			"Sec-Websocket-Key":     {"dGhlIHNhbXBsZSBub25jZQ=="},
		}
	}
	if !validUpgrade(valid()) {
		t.Fatal("a normal browser handshake was refused")
	}
	mutations := map[string]func(http.Header){
		"no connection":      func(h http.Header) { h.Del("Connection") },
		"connection close":   func(h http.Header) { h.Set("Connection", "close") },
		"no upgrade":         func(h http.Header) { h.Del("Upgrade") },
		"other upgrade":      func(h http.Header) { h.Set("Upgrade", "h2c") },
		"two upgrades":       func(h http.Header) { h.Add("Upgrade", "websocket") },
		"old version":        func(h http.Header) { h.Set("Sec-Websocket-Version", "8") },
		"no key":             func(h http.Header) { h.Del("Sec-Websocket-Key") },
		"two keys":           func(h http.Header) { h.Add("Sec-Websocket-Key", "dGhlIHNhbXBsZSBub25jZQ==") },
		"short key":          func(h http.Header) { h.Set("Sec-Websocket-Key", "c2hvcnQ=") },
		"key not base64":     func(h http.Header) { h.Set("Sec-Websocket-Key", "!!!!") },
		"empty key":          func(h http.Header) { h.Set("Sec-Websocket-Key", "") },
		"upgrade in a token": func(h http.Header) { h.Set("Connection", "notupgrade") },
	}
	for name, mutate := range mutations {
		header := valid()
		mutate(header)
		if validUpgrade(header) {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestHeaderTokens(t *testing.T) {
	header := http.Header{"Connection": {"keep-alive", " UPGRADE , close"}}
	if !headerHasToken(header, "Connection", "upgrade") {
		t.Fatal("token not found across values and spacing")
	}
	if headerHasToken(http.Header{"Connection": {"upgrades"}}, "Connection", "upgrade") {
		t.Fatal("a longer token matched")
	}
}

// The adapter carries the page's facts to the evaluator and the evaluator's
// answer back; the rules themselves are the evaluator's, tested there. These
// tests pin what the adapter must pass, because a missing field would deny
// every call or, worse, skip a check.
func TestAdapterPassesTheSessionFactsToTheEvaluator(t *testing.T) {
	policy, err := auditgate.Default()
	if err != nil {
		t.Fatal(err)
	}
	allow := policyAllowlist{policy: policy}
	call := func(clientID, headerClientID, prefix string, extra http.Header) runtimeDecision {
		header := http.Header{"Content-Type": {"application/json"}}
		if headerClientID != "" {
			header.Set("X-Wails-Client-Id", headerClientID)
		}
		for name, values := range extra {
			header[name] = values
		}
		return allow.evaluate(runtimeCall{
			method: http.MethodPost, path: "/wails/runtime", rawQuery: "", header: header,
			body:     []byte(`{"object":6,"method":18}`),
			clientID: clientID, callIDPrefix: prefix,
		})
	}
	if got := call("page", "page", "p.", nil); !got.allowed || string(got.forward) != `{"object":6,"method":18}` {
		t.Fatalf("bound client = %+v", got)
	}
	for name, got := range map[string]runtimeDecision{
		"another client's ID in the header": call("page", "other", "p.", nil),
		"no client ID header":               call("page", "", "p.", nil),
		"no client ID bound":                call("", "page", "p.", nil),
	} {
		if got.allowed || got.reason != auditgate.ReasonClientID {
			t.Errorf("%s = %+v, want client_id", name, got)
		}
	}
	for _, prefix := range []string{"", "p", "p..", "p.q.", "p/ ", strings.Repeat("a", 40) + "."} {
		if got := call("page", "page", prefix, nil); got.allowed || got.reason != auditgate.ReasonCallIDPrefix {
			t.Errorf("prefix %q = %+v, want call_id_prefix", prefix, got)
		}
	}
	for _, name := range []string{"X-Wails-Window-Name", "X-Wails-Window-Id", "x-wails-window-anything"} {
		got := call("page", "page", "p.", http.Header{name: {"main"}})
		if got.allowed || got.reason != auditgate.ReasonWindowHeader {
			t.Errorf("header %s = %+v, want the evaluator's window_header_forbidden", name, got)
		}
	}
}

func TestEventFilterAdapterPassesTheMessageKind(t *testing.T) {
	policy, err := auditgate.Default()
	if err != nil {
		t.Fatal(err)
	}
	allow := policyAllowlist{policy: policy}
	allowed := []byte(`{"name":"plugin/state_change","data":null}`)
	if !allow.filter(auditgate.MessageText, allowed).forward {
		t.Fatal("an allowed text event was dropped")
	}
	for name, got := range map[string]eventDecision{
		"the same bytes as binary": allow.filter(auditgate.MessageBinary, allowed),
		"an unknown kind":          allow.filter(0, allowed),
		"a denied event":           allow.filter(auditgate.MessageText, []byte(`{"name":"core/exec/stream/x","data":null}`)),
		"invalid JSON":             allow.filter(auditgate.MessageText, []byte(`{`)),
		"nothing":                  allow.filter(auditgate.MessageText, nil),
	} {
		if got.forward {
			t.Errorf("%s was forwarded", name)
		}
	}
	if got := allow.filter(auditgate.MessageBinary, allowed); got.reason != auditgate.EventNotText {
		t.Errorf("binary reason = %q, want not_text", got.reason)
	}
}

func TestMessageKindMapsOnlyTheTwoWebSocketTypes(t *testing.T) {
	if messageKind(1) != auditgate.MessageText || messageKind(2) != auditgate.MessageBinary || messageKind(3) != 0 {
		t.Fatal("the library's message types are not mapped to the allowlist's")
	}
}

func TestBrowserWindowNamesAreRecognized(t *testing.T) {
	for _, name := range []string{"browser-1", "browser-42", " browser-7\n", `"browser-3"`} {
		if !isBrowserWindowName(name) {
			t.Errorf("%q not recognized", name)
		}
	}
	for _, name := range []string{
		"", "main", "browser-", "browser-x", "browser-1x", "Browser-1", "xbrowser-1", "browser--1", "browser-1 2",
	} {
		if isBrowserWindowName(name) {
			t.Errorf("%q recognized", name)
		}
	}
}

func TestTunnelQueueIsBoundedInBytesAndAge(t *testing.T) {
	now := time.Now()
	ctx := context.Background()

	// A message costs its payload and the fixed overhead: this bound holds
	// the first two messages below and exactly 10 bytes of payload.
	byBytes := newTunnelQueue(2*perMessageOverhead+10, time.Hour)
	if !byBytes.push([]byte("123456"), now) || byBytes.push([]byte("12345"), now) {
		t.Fatal("the byte bound is not enforced exactly")
	}
	if !byBytes.push([]byte("1234"), now) {
		t.Fatal("a message that fits was refused")
	}
	if got, _, ok := byBytes.pop(ctx); !ok || string(got) != "123456" {
		t.Fatalf("pop = %q %v, want the oldest first", got, ok)
	}
	if !byBytes.push([]byte("12345"), now) {
		t.Fatal("a popped message did not free its place")
	}

	byAge := newTunnelQueue(1<<20, time.Second)
	if !byAge.push([]byte("old"), now) {
		t.Fatal("first push refused")
	}
	if !byAge.push([]byte("fresh"), now.Add(time.Second)) {
		t.Fatal("a push within the age bound was refused")
	}
	if byAge.push([]byte("late"), now.Add(1500*time.Millisecond)) {
		t.Fatal("a push while the oldest message has waited past the bound was accepted")
	}
	if got, at, ok := byAge.pop(ctx); !ok || string(got) != "old" || !at.Equal(now) {
		t.Fatalf("pop = %q %v %v", got, at, ok)
	}
}

// The filter admits events far larger than any sensible queue bound, and one
// broadcast reaches every tunnel. A queue that refused such a message even when
// empty would cut every page off for the same event.
func TestAnEmptyQueueTakesOneMessageOfAnySize(t *testing.T) {
	now := time.Now()
	ctx := context.Background()
	queue := newTunnelQueue(1000, time.Hour)
	big := make([]byte, 50_000)
	if !queue.push(big, now) {
		t.Fatal("an empty queue refused a message larger than its bound")
	}
	if queue.push([]byte("a"), now) {
		t.Fatal("a queue past its bound took another message")
	}
	if got, _, ok := queue.pop(ctx); !ok || len(got) != len(big) {
		t.Fatalf("pop returned %d bytes, ok=%v", len(got), ok)
	}
	if !queue.push(big, now) {
		t.Fatal("the queue, empty again, refused an oversized message")
	}
}

// A burst of small events is bounded by the memory it takes and not by how
// many there are: a page that keeps up with more than a few thousand of them
// must not be cut off for it.
func TestManySmallMessagesAreBoundedByTheirMemoryNotTheirCount(t *testing.T) {
	const bound = 16 << 20
	queue := newTunnelQueue(bound, time.Hour)
	now := time.Now()
	accepted := 0
	for queue.push(make([]byte, 10), now) {
		accepted++
		if accepted > bound {
			t.Fatal("the queue never filled")
		}
	}
	if accepted <= 4096 {
		t.Fatalf("only %d small messages fit: a count cap is cutting a page that keeps up", accepted)
	}
	// Each message is charged well over the 10 bytes it carries, so what
	// bounds the queue is memory and not payload size. The bound is a literal
	// and not perMessageOverhead, so that a charge of zero cannot pass.
	if accepted*(10+64) > bound {
		t.Fatalf("%d small messages fit in %d bytes: the per-message overhead is not charged", accepted, bound)
	}
}

// Compacting the queue must not leave the payloads of messages already sent
// reachable in the slots it vacated.
func TestPoppingAndCompactingKeepNoPayloadAlive(t *testing.T) {
	queue := newTunnelQueue(1<<30, time.Hour)
	now := time.Now()
	for range 10 {
		queue.push(make([]byte, 1000), now)
	}
	for range 7 {
		if _, _, ok := queue.pop(context.Background()); !ok {
			t.Fatal("pop failed")
		}
	}
	queue.mu.Lock()
	defer queue.mu.Unlock()
	all := queue.items[:cap(queue.items)]
	for i, item := range all {
		live := i >= queue.head && i < len(queue.items)
		if !live && item.payload != nil {
			t.Fatalf("slot %d outside the live range still holds a payload of %d bytes", i, len(item.payload))
		}
	}
}

func TestTunnelQueueWakesAndEnds(t *testing.T) {
	queue := newTunnelQueue(1<<20, time.Hour)
	got := make(chan string, 1)
	go func() {
		payload, _, ok := queue.pop(context.Background())
		if ok {
			got <- string(payload)
		} else {
			got <- "closed"
		}
	}()
	time.Sleep(20 * time.Millisecond)
	queue.push([]byte("hello"), time.Now())
	if v := <-got; v != "hello" {
		t.Fatalf("waiting pop got %q", v)
	}

	// A canceled context ends a wait; a closed queue refuses pushes, drops what
	// it held and ends pops.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, ok := queue.pop(ctx); ok {
		t.Fatal("pop succeeded on a canceled context with nothing queued")
	}
	queue.push([]byte("left"), time.Now())
	queue.close()
	if queue.push([]byte("more"), time.Now()) {
		t.Fatal("push succeeded on a closed queue")
	}
	if _, _, ok := queue.pop(context.Background()); ok {
		t.Fatal("pop returned a message from a closed queue")
	}
	queue.mu.Lock()
	held, bytes := len(queue.items), queue.bytes
	queue.mu.Unlock()
	if held != 0 || bytes != 0 {
		t.Fatalf("closed queue holds %d messages, %d bytes", held, bytes)
	}
}
