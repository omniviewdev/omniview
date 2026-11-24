//go:build !windows

package terminal

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// THE CAPABILITY OF A CHANNEL TERMINAL, AND WHAT IT KEEPS OUT (docs/ui-next/terminal-channel-protocol.md).
//
// A channel terminal is reached by 32 random bytes the host minted and answered once, as the first frame of its stream and
// as the first argument of five calls. It is invisible to every call that names a terminal by its id (they answer what an id
// that never was gets), a capability that opens nothing gets one answer whatever the reason, and no answer repeats what it was
// given. The page of the events lane is untouched: these tests start channel terminals beside it.

// requireNotFound says an error is what a call answers for an id that never was, in the same words.
func requireNotFound(t *testing.T, err error, id string) {
	t.Helper()
	require.Error(t, err)
	assert.Equal(t, apperror.SessionNotFound(id).Error(), err.Error(), "the words of an id that never was")
}

// requireNoCapabilityFor says an error is the one answer of a capability that opens nothing, which holds nothing the caller sent.
func requireNoCapabilityFor(t *testing.T, err error, presented string) {
	t.Helper()
	require.Error(t, err)
	assert.Equal(t, ChannelNotFound().Error(), err.Error(), "one answer, whatever the reason")
	if presented != "" {
		assert.NotContains(t, err.Error(), presented, "the answer never repeats what it was given")
	}
	app := appErr(t, err)
	assert.Equal(t, apperror.TypeSessionNotFound, app.Type)
	assert.Equal(t, 404, app.Status)
}

func requireACapability(t *testing.T, capability string) {
	t.Helper()
	require.Len(t, capability, 43, "32 bytes as base64url with no padding")
	raw, err := base64.RawURLEncoding.DecodeString(capability)
	require.NoError(t, err)
	require.Len(t, raw, 32)
}

// A terminal opened with launch.channel is answered a capability, one for each terminal, 32 random bytes as base64url; the
// answer of a terminal that is not a channel terminal has none. Nothing the host says afterwards holds it: not a list, not
// the stream's ready frame.
func TestAChannelTerminalIsAnsweredItsCapabilityOnceAndNothingElseShowsIt(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	a := m.startChannel(t, `sleep 600`, Options{})
	b := m.startChannel(t, `sleep 600`, Options{})
	plain, err := m.Start(Options{Command: []string{sh(t), "-c", "sleep 600"}}, "wA")
	require.NoError(t, err)

	requireACapability(t, a.Cap)
	requireACapability(t, b.Cap)
	assert.NotEqual(t, a.Cap, b.Cap, "one capability for each terminal")
	assert.Empty(t, plain.Cap, "a terminal of the events lane has none")
	assert.Equal(t, m.channel.ring, a.Limits.ChannelRingBytes, "the answer states the limits that apply")
	assert.Equal(t, m.channel.high, a.Limits.ChannelHighBytes)
	assert.Equal(t, m.channel.low, a.Limits.ChannelLowBytes)
	assert.Equal(t, int(m.channel.stall/time.Millisecond), a.Limits.ChannelStallMs)
	assert.Equal(t, m.channel.inflight, a.Limits.ChannelInflightBytes)
	assert.Equal(t, ChannelMaxInputBytes, a.Limits.ChannelMaxInputBytes)
	assert.Equal(t, int(LeaseDefault/time.Millisecond), a.LeaseMs, "a channel terminal is kept for its lease once its stream ends")

	listed, err := m.ListChannels([]string{a.Cap, b.Cap})
	require.NoError(t, err)
	require.Len(t, listed, 2)
	page := m.attach(t, a.Cap, nil)
	page.waitReady()
	raw := make([]any, 0, 8)
	raw = append(raw, listed, m.ListSessions(), m.List("wA", ""), m.List(nil, testKey))
	for _, frame := range page.f.allFrames() {
		raw = append(raw, string(frame))
	}
	for _, thing := range raw {
		encoded, marshalErr := json.Marshal(thing)
		require.NoError(t, marshalErr)
		assert.NotContains(t, string(encoded), a.Cap, "no list and no frame holds a capability")
		assert.NotContains(t, string(encoded), b.Cap)
	}
}

// A channel terminal is reached by its capability, not by a page key: asking for both is refused, naming the field, and
// nothing starts. Its lease is the one a page key's terminal has: the default, the most, a lease out of range refused.
func TestAChannelTerminalTakesALeaseAndRefusesAPageKey(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)

	_, err := m.Start(Options{Command: []string{sh(t), "-c", "sleep 600"}, Channel: true, PageKey: testKey}, nil)
	app := appErr(t, err)
	assert.Equal(t, "INVALID_REQUEST", app.Code)
	assert.Contains(t, app.Detail, "page_key", "the refusal names the field")
	assert.Empty(t, m.running(), "nothing started")

	for _, ms := range []int{-1, int(LeaseMax/time.Millisecond) + 1} {
		_, err = m.Start(Options{Command: []string{sh(t), "-c", "sleep 600"}, Channel: true, LeaseMs: ms}, nil)
		assert.Equal(t, "INVALID_REQUEST", appErr(t, err).Code)
		assert.Contains(t, appErr(t, err).Detail, "lease_ms")
	}
	assert.Empty(t, m.running())

	one := m.startChannel(t, `sleep 600`, Options{LeaseMs: 1500})
	assert.Equal(t, 1500, one.LeaseMs)
	most := m.startChannel(t, `sleep 600`, Options{LeaseMs: int(LeaseMax / time.Millisecond)})
	assert.Equal(t, int(LeaseMax/time.Millisecond), most.LeaseMs)

	_, err = m.Start(Options{Command: []string{sh(t), "-c", "sleep 600"}, LeaseMs: 1000}, nil)
	assert.Equal(t, "INVALID_REQUEST", appErr(t, err).Code, "a lease means something only for a terminal that is kept")
}

// A channel terminal is invisible to the events lane: every call that takes a terminal by its id answers what an id that
// never was gets, in the same words, for whoever calls and whatever it passes as a key, nothing of it is listed, and none of
// the calls touches it. This holds for a terminal that ended and is kept, too: nobody dismisses it by its id.
func TestAChannelTerminalIsInvisibleToEveryCallThatNamesATerminalByItsId(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `stty -echo; printf 'up\n'; cat`, Options{})
	dev := newGatedDevice()
	dev.openAll()
	m.chanOf(t, info).useDevice(dev)
	id := info.ID

	calls := map[string]func(id string) error{
		"GetSession":       func(id string) error { _, err := m.GetSession(id); return err },
		"Write":            func(id string) error { return m.Write(id, 0, []byte("x")) },
		"Write (numbered)": func(id string) error { return m.Write(id, 1, []byte("x")) },
		"Resize":           func(id string) error { return m.Resize(id, 0, 30, 90) },
		"Ack":              func(id string) error { return m.Ack(id, 1) },
		"Busy":             func(id string) error { _, err := m.Busy(id); return err },
		"Cwd":              func(id string) error { _, err := m.Cwd(id); return err },
		"AttachSession":    func(id string) error { _, _, err := m.AttachSession(id); return err },
		"DetachSession":    func(id string) error { _, err := m.DetachSession(id); return err },
		"CloseSession":     func(id string) error { return m.CloseSession(id) },
		"Attach, no key":   func(id string) error { _, err := m.Attach(id, "wA", AttachRequest{}); return err },
		"Attach, a key":    func(id string) error { _, err := m.Attach(id, "wA", AttachRequest{PageKey: testKey}); return err },
		"Attach, no one":   func(id string) error { _, err := m.Attach(id, nil, AttachRequest{PageKey: testKey}); return err },
		"Detach, no key":   func(id string) error { _, err := m.Detach(id, "wA", DetachRequest{}); return err },
		"Detach, a key":    func(id string) error { _, err := m.Detach(id, nil, DetachRequest{PageKey: testKey}); return err },
	}
	guarded(t, "legacy-invisible", func() {
		for name, call := range calls {
			requireNotFound(t, call(id), id)
			require.ErrorContains(t, call("no-such-session"), "no-such-session", name)
		}
		assert.False(t, m.CloseUnlessTakenOver(id, "wA"), "a window that did not make it cannot end it")
		for _, listed := range m.ListSessions() {
			assert.NotEqual(t, id, listed.ID, "a channel terminal is not a session of the events lane")
		}
		for _, key := range []string{"", testKey, otherTestKey} {
			for _, owner := range []Owner{nil, "wA"} {
				assert.Empty(t, m.List(owner, key), "no page lists it, whatever it passes")
			}
		}
	})

	assert.False(t, gone(info.PID), "none of the calls touched the shell")
	assert.Empty(t, dev.log(), "and none of them typed or resized")
	stats := m.chanOf(t, info).channelStats()
	assert.False(t, stats.held)
	assert.Zero(t, m.chanOf(t, info).queue.expects()-1, "no numbered input was taken")

	// A channel terminal that ended and is kept is dismissed by its capability and by nothing that names its id.
	ended := m.startChannel(t, `printf 'x\n'; exit 0`, Options{})
	require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, settle, 5*time.Millisecond, "the end of a channel terminal is kept")
	guarded(t, "legacy-invisible", func() {
		requireNotFound(t, m.CloseSession(ended.ID), ended.ID)
		_, err := m.Attach(ended.ID, "wA", AttachRequest{PageKey: testKey})
		requireNotFound(t, err, ended.ID)
		assert.Empty(t, m.List(nil, ""), "an empty key matches the key of no tombstone of a channel")
		assert.Empty(t, m.List("wA", testKey))
		assert.Equal(t, 1, m.tombstoneCount(), "the end is still there for its capability")
	})
	require.NoError(t, m.DismissChannel(ended.Cap))
	assert.Zero(t, m.tombstoneCount())
}

// Every call that names a channel terminal by its capability answers it, and answers the one not-found for a capability that
// opens nothing, whatever the reason: missing, malformed, wrong by one byte, the id of a terminal, one that was dismissed, one
// that is closing. The answer holds nothing the caller sent. A list answers only for the capabilities it is given, in the order
// it is given them, and never enumerates.
func TestEveryCallThatNamesAChannelTerminalByItsCapabilityAnswersTheOneNotFoundForAnyThatOpensNothing(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	a := m.startChannel(t, `stty -echo; printf 'up\n'; cat`, Options{})
	b := m.startChannel(t, `sleep 600`, Options{})
	dismissed := m.startChannel(t, `printf 'x\n'; exit 0`, Options{})
	require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, settle, 5*time.Millisecond)
	require.NoError(t, m.DismissChannel(dismissed.Cap))
	closing := m.startChannel(t, `trap '' HUP; stty -echo; printf 'up\n'; sleep 600`, Options{})
	closingEnded := make(chan error, 1)
	closingPage := m.attach(t, closing.Cap, nil)
	closingPage.waitBytes(len("up\n"))
	go func() { closingEnded <- m.CloseChannel(closing.Cap) }()
	require.Eventually(t, func() bool { return m.chanOf(t, closing).ending.Load() }, settle, time.Millisecond, "the close began")

	flipped := []byte(a.Cap)
	flipped[len(flipped)-1] ^= 1
	presented := map[string]string{
		"empty":               "",
		"not base64":          "!!not-a-capability!!",
		"too short":           a.Cap[:42],
		"too long":            a.Cap + "A",
		"right length, wrong": strings.Repeat("A", 43),
		"one byte wrong":      string(flipped),
		"the id":              a.ID,
		"a dismissed one":     dismissed.Cap,
		"one that is closing": closing.Cap,
	}
	calls := map[string]func(capability string) error{
		"CloseChannel":   func(c string) error { return m.CloseChannel(c) },
		"ChannelBusy":    func(c string) error { _, err := m.ChannelBusy(c); return err },
		"ChannelCwd":     func(c string) error { _, err := m.ChannelCwd(c); return err },
		"DismissChannel": func(c string) error { return m.DismissChannel(c) },
	}
	for reason, capability := range presented {
		guarded(t, "wrong-cap-opens-nothing", func() {
			for name, call := range calls {
				if name == "CloseChannel" && reason == "one that is closing" {
					continue // the terminal is closing: its own close is the one in flight
				}
				requireNoCapabilityFor(t, call(capability), capability)
			}
			got, err := m.ListChannels([]string{capability})
			require.NoError(t, err)
			assert.Empty(t, got, "a list answers for the capabilities that open something, %s", reason)
		})
	}

	guarded(t, "the-answer-holds-nothing-sent", func() {
		for _, capability := range presented {
			if capability == "" {
				continue
			}
			assert.NotContains(t, m.DismissChannel(capability).Error(), capability)
		}
	})

	// The capability that opens a terminal gets its answers, and a list names it by its id.
	// The shell starts cat after it printed, and the foreground is the shell's own until cat has been given the terminal: wait
	// for the shell to hand it over, and do not ask before.
	require.Eventually(t, func() bool {
		busy, err := m.ChannelBusy(a.Cap)
		return err == nil && busy.State == StateBusy
	}, settle, 5*time.Millisecond, "the shell runs cat in the foreground")
	cwd, err := m.ChannelCwd(a.Cap)
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(cwd.Path, a.Cwd), "where the shell is: its physical path ends with the one it started in (%q, %q)", cwd.Path, a.Cwd)
	got, err := m.ListChannels([]string{b.Cap, "no-such-capability", a.Cap, b.Cap})
	require.NoError(t, err)
	require.Len(t, got, 3, "only for the capabilities that open a terminal, in the order given")
	assert.Equal(t, []string{b.ID, a.ID, b.ID}, []string{got[0].ID, got[1].ID, got[2].ID})
	assert.False(t, got[0].Attached)
	assert.NotZero(t, got[0].LeaseExpiresUnixMs, "a terminal that is not held has a lease running")
	assert.Equal(t, b.PID, got[0].PID)
	_, err = m.ListChannels(make([]string, MaxListedCaps+1))
	assert.Equal(t, "INVALID_REQUEST", appErr(t, err).Code, "a list of more capabilities than a page holds is refused")
	empty, err := m.ListChannels(nil)
	require.NoError(t, err)
	assert.Empty(t, empty, "a list that is given nothing answers nothing")

	require.NoError(t, <-closingEnded)
	requireNoCapabilityFor(t, m.CloseChannel(closing.Cap), closing.Cap)
	require.NoError(t, m.CloseChannel(a.Cap), "the capability that opens a terminal closes it")
	requireNoCapabilityFor(t, m.CloseChannel(a.Cap), a.Cap)
}

// What a stream's first frame must be, and what the host does with a frame that is not: the first frame is the attach
// request and nothing is read before it. A wrong, missing or malformed capability, a request of another version, a frame of
// another type, a frame that is too big: the one not-found, a frame by itself and the same bytes whatever the reason, and the
// stream closes. A valid attach that was queued behind the bad frame is not read, and the terminal was never held.
func TestTheFirstFrameIsTheAttachAndAnythingElseGetsTheOneNotFoundAndTheStreamCloses(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `sleep 600`, Options{})
	wrong := strings.Repeat("A", 43)
	raw := func(typ byte, body string) []byte { return append([]byte{typ}, body...) }
	cases := map[string][]byte{
		"a wrong capability of the right length": attachFrame(wrong, nil),
		"a capability of another length":         attachFrame(info.Cap[:20], nil),
		"no capability":                          raw(wAttach, `{"v":1}`),
		"an empty capability":                    raw(wAttach, `{"v":1,"cap":""}`),
		"a request that is not JSON":             raw(wAttach, `{"v":1,"cap":`),
		"a request that is not an object":        raw(wAttach, `[1,2,3]`),
		"another version, a good capability":     raw(wAttach, `{"v":2,"cap":"`+info.Cap+`"}`),
		"no version, a good capability":          raw(wAttach, `{"cap":"`+info.Cap+`"}`),
		"an offset that is not a number":         raw(wAttach, `{"v":1,"cap":"`+info.Cap+`","from_offset":"0"}`),
		"a negative offset":                      raw(wAttach, `{"v":1,"cap":"`+info.Cap+`","from_offset":-1}`),
		"an empty frame":                         {},
		"input first":                            inputFrame("hello\n"),
		"resize first":                           resizeFrame(80, 24),
		"ack first":                              ackFrame(1),
		"detach first":                           detachFrame(),
		"a frame of a type nobody knows":         raw(0x7f, `{"v":1,"cap":"`+info.Cap+`"}`),
		"a frame of the host's type":             raw(wReady, `{"v":1,"cap":"`+info.Cap+`"}`),
		"an attach that is too big":              raw(wAttach, `{"v":1,"cap":"`+info.Cap+`","pad":"`+strings.Repeat("p", 4096)+`"}`),
	}
	var first []byte
	for name, frame := range cases {
		f := newFakeChannel(t)
		p := newChanPage(t, f, 0)
		p.served = make(chan struct{})
		go p.run()
		// The bad frame, and behind it the attach that would hold the terminal if anything were read past the first frame.
		f.pageSend(frame)
		f.pageSend(attachFrame(info.Cap, nil))
		go func() {
			defer close(p.served)
			m.ServeChannel(f)
		}()
		p.waitServed()
		st := p.waitClosed()

		guarded(t, "one-not-found", func() {
			frames := f.allFrames()
			require.Len(t, frames, 1, "%s: exactly one answer", name)
			assert.Equal(t, []byte{wNotFound}, frames[0], "%s: the not-found frame, with no payload", name)
			assert.Equal(t, 1, st.notFound, name)
			assert.Empty(t, st.faults, name)
			if first == nil {
				first = frames[0]
			}
			assert.Equal(t, first, frames[0], "%s: the same bytes whatever the reason", name)
		})
		guarded(t, "attach-reads-only-the-first-frame", func() {
			assert.False(t, m.chanOf(t, info).channelStats().held, "%s: the terminal was never held", name)
			assert.Equal(t, 1, f.recvCalls(), "%s: nothing was read past the first frame, the valid attach behind it included", name)
		})
	}

	// And the capability that opens the terminal still does.
	page := m.attach(t, info.Cap, nil)
	assert.Equal(t, 1, page.waitReady().V)
	assert.True(t, m.chanOf(t, info).channelStats().held)
}

// A stream that has attached and then breaks the protocol is closed, cleanly: a frame too short for its type or too long,
// a size that is not one, an unknown type, a type of the host's, a second attach, a frame bigger than an input may be. Nothing
// panics, the host returns from serving the stream, the terminal is left detached with its lease running and its shell alive,
// and the capability attaches it again.
func TestAProtocolTableNeverPanicsAndAlwaysClosesCleanly(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `sleep 600`, Options{})
	s := m.chanOf(t, info)
	raw := func(b ...byte) []byte { return b }
	cases := map[string][]byte{
		"an empty frame":                       {},
		"an input bigger than an input may be": append([]byte{wInput}, make([]byte, ChannelMaxInputBytes+1)...),
		"a resize that is too short":           raw(wResize, 0, 80, 0),
		"a resize that is too long":            raw(wResize, 0, 80, 0, 24, 0),
		"a resize of no columns":               raw(wResize, 0, 0, 0, 24),
		"a resize of no rows":                  raw(wResize, 0, 80, 0, 0),
		"a resize of too many columns":         resizeFrame(MaxDimension+1, 24),
		"an ack that is too short":             raw(wAck, 0, 0, 1),
		"an ack that is too long":              raw(wAck, 0, 0, 0, 1, 0),
		"a detach with a payload":              raw(wDetach, 'x'),
		"a type of nobody's":                   raw(0x00),
		"another type of nobody's":             raw(0x7f, 1, 2, 3),
		"the largest type":                     raw(0xff),
		"a type that is the host's":            raw(wOutput, 0, 0, 0, 0, 0, 0, 0, 0, 'x'),
		"another type that is the host's":      raw(wNotFound),
		"a second attach":                      attachFrame(info.Cap, nil),
	}
	for name, frame := range cases {
		page := m.attach(t, info.Cap, nil)
		page.waitReady()
		page.send(frame)
		page.send(inputFrame("never applied\n"))
		page.waitServed()
		st := page.waitClosed()

		guarded(t, "protocol-violation-closes", func() {
			assert.True(t, page.isClosed(), "%s: the host closed the stream", name)
			assert.Empty(t, st.faults, "%s: whatever it sent was well formed", name)
			assert.Zero(t, st.notFound, "%s: a stream that has attached is not told not-found", name)
		})
		held := s.channelStats().held
		guarded(t, "stream-end-detaches", func() {
			assert.False(t, held, "%s: the terminal was let go", name)
			detached, owner, leaseRunning, _ := s.state()
			assert.True(t, detached, name)
			assert.Nil(t, owner, "no window is used for a channel terminal")
			assert.True(t, leaseRunning, "%s: its lease runs", name)
		})
		assert.False(t, gone(info.PID), "%s: the shell was not touched", name)
	}
	assert.Equal(t, 1, m.attach(t, info.Cap, nil).waitReady().V, "the capability attaches it again")
}

// Input, resize and acknowledgements travel on the stream and are applied in the order the page sent them: the same queue as
// the legacy calls, called with no sequence number, so that a channel terminal never answers a sequence error.
func TestInputResizeAndAcknowledgementsTravelOnTheStreamInTheOrderTheyWereSent(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `stty -echo -opost; printf 'up\n'; while read x; do printf 'got:%s\n' "$x"; stty size; done`, Options{})
	page := m.attach(t, info.Cap, nil)
	page.waitBytes(len("up\n"))

	// A line is typed after the answer to the one before it, so that what the shell reads is decided by the order of the host and
	// not by the speed of the shell; the resize and the line after it travel together, and the shell reads the line under the new size.
	page.input("one\n")
	page.waitBytes(len("up\ngot:one\n24 80\n"))
	page.resize(101, 33)
	page.input("two\n")
	page.ack(3)
	page.input("three\n")

	want := "up\ngot:one\n24 80\ngot:two\n33 101\ngot:three\n33 101\n"
	state := page.waitBytes(len(want))
	assert.Equal(t, want, string(state.bytes()), "the page's frames were applied in order")
	assert.Empty(t, state.faults)
	assert.False(t, state.closed, "an acknowledgement is not a violation")

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		page.detach()
	}()
	wg.Wait()
	page.waitServed()
	page.waitClosed()
	detached, _, leaseRunning, _ := m.chanOf(t, info).state()
	assert.True(t, detached, "a detach frame leaves the terminal at once")
	assert.True(t, leaseRunning)
}
