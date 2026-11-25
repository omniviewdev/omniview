//go:build !windows

package terminal

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE VERSION OF THE STREAM (docs/ui-next/terminal-channel-protocol.md section 5). Version 2 adds the frames `applied` (0x87) and
// `released` (0x88) and the field `input_applied` of `ready`. A page of version 1 is refused with one frame of its own,
// `unsupported` (0x89, `{"v":2}`), decided from the request alone before any capability is looked at, so that it says nothing about
// whether a capability opens a terminal. The frames here are written out by hand.

// firstFrame serves a stream whose first frame is raw and returns the first frame the host sends.
func firstFrame(t *testing.T, m *Manager, raw []byte) (*fakeChannel, []byte) {
	t.Helper()
	f := newFakeChannel(t)
	go m.ServeChannel(f)
	f.pageSend(raw)
	frame, ok := f.nextFrame()
	require.True(t, ok, "the host sent nothing")
	return f, frame
}

func rawAttach(version int, capability string) []byte {
	return append([]byte{wAttach}, fmt.Sprintf(`{"v":%d,"cap":%q}`, version, capability)...)
}

func TestAnAttachOfVersionOneIsRefusedWithTheUnsupportedFrameWhateverTheCapability(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `sleep 600`, Options{})
	want := append([]byte{0x89}, `{"v":2}`...)

	for name, capability := range map[string]string{"a capability that opens a terminal": info.Cap, "one that opens nothing": "nope"} {
		f, frame := firstFrame(t, m, rawAttach(1, capability))
		assert.Equal(t, want, frame, name+": the frame that says which version the host speaks")
		assert.Eventually(t, f.isClosed, settle, 1e6, name+": and the host closes the stream")
	}
	guarded(t, "version-refusal-opens-nothing", func() {
		require.Eventually(t, func() bool { return !m.chanOf(t, info).channelStats().held }, settle, 1e6)
		assert.False(t, m.chanOf(t, info).channelStats().held, "a stream of version 1 never held the terminal")
	})
}

func TestAnAttachOfVersionTwoIsAnsweredReadyOfVersionTwo(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `sleep 600`, Options{})
	_, frame := firstFrame(t, m, rawAttach(2, info.Cap))
	require.NotEmpty(t, frame)
	assert.Equal(t, wReady, frame[0], "the first frame is ready")
	got, err := decodeHostFrame(frame)
	require.NoError(t, err)
	assert.Equal(t, 2, got.ready.V, "ready says version 2")
}
