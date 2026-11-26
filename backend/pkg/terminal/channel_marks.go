//go:build !windows

package terminal

// ChannelCommands reads the record of a channel terminal: the commands the shell's integration told of, with their offsets.
func (m *Manager) ChannelCommands(presented string) (Commands, error) {
	s, err := m.liveByCapability(presented)
	if err != nil {
		return Commands{}, err
	}
	return Commands{Integration: s.info.Integration.State, Running: "", Cwd: "", CwdTrust: "", End: 0, Commands: []Command{}}, nil
}
