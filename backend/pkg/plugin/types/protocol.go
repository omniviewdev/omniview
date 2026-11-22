package types

import (
	"errors"
	"fmt"
	"strconv"
)

// The plugin protocols this host runs, declared once. Everything that depends on the answer is derived from these two numbers and never repeated: the protocols the loader offers go-plugin and the clients it
// gives them (backend/pkg/plugin/protocol.go), the decision it makes from the number a handshake negotiated (admitProtocol), the facts of a refusal that the window words (Incompatibility), and the host's own
// sentence for it. A step that makes the host read a second protocol edits CurrentProtocolVersion, and the step that stops reading the first edits OldestProtocolVersion: there is no third place.
const (
	// OldestProtocolVersion is the oldest plugin protocol this host runs.
	OldestProtocolVersion = 1
	// CurrentProtocolVersion is the newest plugin protocol this host runs, and the one of the plugins it hosts itself (in-process backends).
	CurrentProtocolVersion = 1
)

// ProtocolRange is a closed range of plugin protocol numbers.
type ProtocolRange struct {
	Oldest int `json:"oldest"`
	Newest int `json:"newest"`
}

// AcceptedProtocols is the range of plugin protocols this host runs: a plugin that negotiates a number outside it is refused (IncompatibleError).
func AcceptedProtocols() ProtocolRange {
	return ProtocolRange{Oldest: OldestProtocolVersion, Newest: CurrentProtocolVersion}
}

// Contains reports whether protocol is in the range.
func (r ProtocolRange) Contains(protocol int) bool {
	return protocol >= r.Oldest && protocol <= r.Newest
}

// String is the range as a person reads it: "protocol 1" for a range of one, "protocols 1 to 2" for more.
func (r ProtocolRange) String() string {
	if r.Oldest == r.Newest {
		return "protocol " + strconv.Itoa(r.Newest)
	}
	return "protocols " + strconv.Itoa(r.Oldest) + " to " + strconv.Itoa(r.Newest)
}

// IncompatibleSentence is the host's sentence for a plugin built for a protocol it does not run. It says no direction (older or newer), because the person has the same two ways out in both: the plugin or Omniview
// has to change, and the window offers neither today.
const IncompatibleSentence = "This plugin was built for a different version of Omniview."

// Incompatibility is why the host refused a plugin by protocol number, as numbers and nothing else: public-safe values that travel to the window with the event (`plugin/unloaded`) and in the plugin's inventory
// entry, where the window words them. Nothing of go-plugin's, the plugin's or an error's text is in it.
type Incompatibility struct {
	// PluginProtocol is the plugin protocol the plugin's process negotiated: the number it said in the handshake.
	PluginProtocol int `json:"pluginProtocol"`
	// Accepted is the range of plugin protocols this host runs.
	Accepted ProtocolRange `json:"accepted"`
}

// String is the host's sentence for the refusal, composed from the two numbers. It is what the log and the old shell's plugin page show; the new window words the same facts itself.
func (i Incompatibility) String() string {
	return fmt.Sprintf("%s It uses plugin protocol %d; this Omniview accepts %s.", IncompatibleSentence, i.PluginProtocol, i.Accepted)
}

// IncompatibleError is the loader's typed decision that a plugin speaks a protocol this host does not run. It is found by type (IncompatibilityOf) and never by its text; its own text is the host's sentence.
type IncompatibleError struct{ Incompatibility }

func (e *IncompatibleError) Error() string { return e.String() }

// IncompatibilityOf returns the facts of a refusal by protocol number anywhere in err's chain.
func IncompatibilityOf(err error) (Incompatibility, bool) {
	var refused *IncompatibleError
	if errors.As(err, &refused) {
		return refused.Incompatibility, true
	}
	var none Incompatibility
	return none, false
}
