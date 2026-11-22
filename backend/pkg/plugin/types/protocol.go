package types

import (
	"errors"
	"fmt"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// MinProtocolVersion is the oldest plugin protocol this host's code can run at all.
// What a channel accepts is a floor at or above it (the pluginManager's protocolFloor).
const MinProtocolVersion = 1

// legacyProtocolWire is the resource wire of protocol 1, which is fixed for good: a
// plugin built on an SDK up to v0.21.x.
const legacyProtocolWire = 3

// currentProtocolWire is the resource wire of the SDK this host is built on, which is
// what CurrentProtocolVersion's plugins speak.
const currentProtocolWire = resourcev2.WireVersion

// ResourceWire is the resource wire the host speaks to a plugin that negotiated
// protocol, and whether the host runs that protocol at all. The SDK this host is built on
// names its own; protocol 1 is wire 3 by definition.
func ResourceWire(protocol int) (wire uint32, ok bool) {
	switch {
	case protocol == MinProtocolVersion:
		return legacyProtocolWire, true
	case protocol > MinProtocolVersion && protocol <= CurrentProtocolVersion:
		return currentProtocolWire, true
	}
	return 0, false
}

// RunsProtocol reports whether the host's code can run a plugin of this protocol.
func RunsProtocol(protocol int) bool {
	_, ok := ResourceWire(protocol)
	return ok
}

// Incompatibility is why a plugin was refused, as numbers only: public-safe values the
// window reads from the inventory record and words itself. Nothing of go-plugin's, the
// plugin's or an error's text is in it.
type Incompatibility struct {
	// PluginProtocol is the protocol the plugin's process negotiated.
	PluginProtocol int `json:"pluginProtocol"`
	// HostFloor is the oldest protocol this host's release channel accepts.
	HostFloor int `json:"hostFloor"`
	// HostNewest is the newest protocol this host runs.
	HostNewest int `json:"hostNewest"`
}

// PluginTooOld is true when the fix is to update the plugin, false when it is to update Omniview.
func (i Incompatibility) PluginTooOld() bool { return i.PluginProtocol < i.HostFloor }

// IncompatibleError is the typed decision the loader makes when a plugin speaks a
// protocol this host does not run: read by type (errors.As), never by text. Its own
// text is the host's plain sentence, composed from the numbers.
type IncompatibleError struct{ Incompatibility }

func (e *IncompatibleError) Error() string {
	if e.PluginTooOld() {
		return fmt.Sprintf("This plugin was built for plugin protocol %d. This Omniview needs %d or newer. Update the plugin.",
			e.PluginProtocol, e.HostFloor)
	}
	return fmt.Sprintf("This plugin was built for plugin protocol %d. This Omniview runs up to %d. Update Omniview.",
		e.PluginProtocol, e.HostNewest)
}

// IncompatibilityOf returns the facts of an incompatibility anywhere in err's chain.
func IncompatibilityOf(err error) (Incompatibility, bool) {
	var typed *IncompatibleError
	if errors.As(err, &typed) {
		return typed.Incompatibility, true
	}
	return Incompatibility{}, false
}
