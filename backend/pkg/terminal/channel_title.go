//go:build !windows

package terminal

import "encoding/json"

// THE TITLE OF A TERMINAL ON THE STREAM (issue #695 step 4; docs/ui-next/terminal-channel-protocol.md section 4b).
//
// The title is a fact of the terminal, not a position in its output: the host keeps the last one a program set (title.go), with its own word on
// whether a program runs, and a stream whose page asked for it (attach `title` 1) is sent it in a frame of its own whenever the pair changes and once
// when it attaches, whatever offset it attaches from. The word is the producer's: it is taken in the step that follows the one that appended the
// output, from the foreground group of the terminal and from the command the shell's integration vouched for (the same facts as the busy fact), and
// again after every read while a program runs under a title, so that the end of the program is said by the first output that follows it. Nothing
// polls: a terminal that is not written to, and a terminal with no title, ask the system nothing.

// titleState is the pair a terminal states and the count of its changes.
type titleState struct {
	seq     uint64
	text    string
	program bool
}

// state is the pair the tracker states now. The output lock orders the call.
func (t *titleTracker) state() titleState {
	return titleState{seq: t.seq, text: t.text, program: t.program}
}

// titleBody is the JSON of the title frame.
type titleBody struct {
	V       int    `json:"v"`
	Title   string `json:"title"`
	Program bool   `json:"program"`
}

// titleFrame is the frame that says the title a terminal states.
func titleFrame(st titleState) []byte {
	raw, err := json.Marshal(titleBody{V: titleFrameVersion, Title: st.text, Program: st.program})
	if err != nil {
		// A struct of a string and a boolean has no error to give.
		return []byte{frameTitle}
	}
	return append([]byte{frameTitle}, raw...)
}

// titleVersion is the version of the title frame this stream carries, zero for none.
func (c *channelConn) titleVersion() int {
	if c.title {
		return titleFrameVersion
	}
	return 0
}

// titleVersionFor is the version of the title frame a stream that asked for asked can be sent from ring: zero when it asked for another version or the
// ring has no title.
func titleVersionFor(ring *replayRing, asked int) int {
	if asked == titleFrameVersion && ring.title != nil {
		return titleFrameVersion
	}
	return 0
}

// programRuns is the producer's word on whether a program runs in the terminal: a command the shell's integration vouched for and that has not
// ended, or a process group other than the shell's that holds the foreground. known is false when the system could not say.
func (s *session) programRuns() (running, known bool) {
	if _, vouched := s.verifiedRunning(); vouched {
		return true, true
	}
	shell, group, known := s.groups()
	if !known {
		return false, false
	}
	return group != shell, true
}

// settleTitle is the step after the pump appended output: it states the title that output set, with the foreground fact taken now, and wakes
// the stream that holds the terminal when the pair changed. Only the pump calls it.
func (s *session) settleTitle() {
	s.outMu.Lock()
	tracker := s.ring.title
	look := tracker != nil && tracker.wantsLook()
	s.outMu.Unlock()
	if !look {
		return
	}
	running, known := s.programRuns()
	s.outMu.Lock()
	changed := tracker.settle(running, known)
	s.outMu.Unlock()
	if !changed {
		return
	}
	if holder := s.channel.holderPtr.Load(); holder != nil {
		holder.signal()
	}
}
