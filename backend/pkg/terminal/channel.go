//go:build !windows

package terminal

import "time"

// channelLimits are the numbers of a channel terminal's ring and its pacing, the manager's copy of the Channel
// constants of types.go: a test states smaller ones.
type channelLimits struct {
	ring     int
	high     int
	low      int
	inflight int
	frame    int
	stall    time.Duration
}

// stubCapability is the placeholder of the red commit: no capability is minted yet.
const stubCapability = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

func defaultChannelLimits() channelLimits {
	return channelLimits{ring: ChannelRingBytes, high: ChannelHighBytes, low: ChannelLowBytes, inflight: ChannelInflightBytes, frame: ChannelFrameBytes, stall: ChannelStall}
}

// channelStats is what the manager counted for one channel terminal.
type channelStats struct {
	start, end, kept, overwritten uint64
	held                          bool
	sent, sentBytes, acked, lost  uint64
	waits, stallReleases          uint64
	noHolderReleases              uint64
	admitted, refused             uint64
}

func (s *session) channelStats() channelStats { return channelStats{} }

// channelNudge wakes the pump, which looks again at what it waits for.
func (s *session) channelNudge() {}

// ServeChannel serves one stream.
func (m *Manager) ServeChannel(ch Channel) { _ = ch.Close() }

// CloseChannel ends the channel terminal that the capability names.
func (m *Manager) CloseChannel(_ string) error { return nil }

// ChannelBusy says whether a program other than the shell holds the foreground of a channel terminal.
func (m *Manager) ChannelBusy(_ string) (Foreground, error) { return Foreground{}, nil }

// ChannelCwd says which directory the shell of a channel terminal is in.
func (m *Manager) ChannelCwd(_ string) (Directory, error) { return Directory{}, nil }

// ListChannels lists the channel terminals of the capabilities given.
func (m *Manager) ListChannels(_ []string) ([]ChannelListed, error) { return nil, nil }

// DismissChannel forgets the end of a channel terminal that ended.
func (m *Manager) DismissChannel(_ string) error { return nil }
