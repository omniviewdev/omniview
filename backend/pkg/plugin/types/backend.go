package types

// CurrentProtocolVersion is the latest SDK protocol version supported by the engine.
// Bump this when adding a new protocol version.
const CurrentProtocolVersion = 1

// PluginBackend abstracts the communication channel to a plugin process.
// The primary implementation wraps go-plugin (ExternalBackend), but this
// interface also enables in-process backends for tests and future bundled
// plugins.
type PluginBackend interface {
	// Dispense returns a capability client by name (e.g. "resource", "exec").
	Dispense(name string) (interface{}, error)

	// Healthy returns true if the plugin is alive and serving.
	Healthy() bool

	// Stop performs a graceful shutdown of the plugin.
	Stop() error

	// Kill forcefully terminates the plugin.
	Kill()

	// Exited returns true if the plugin process has exited.
	Exited() bool

	// NegotiatedVersion returns the SDK protocol version negotiated with this plugin.
	// For InProcessBackend, returns CurrentProtocolVersion.
	// For ExternalBackend, returns the go-plugin negotiated version.
	NegotiatedVersion() int
}

// CapabilityDetector is an optional interface that backends can implement
// to report which capabilities they support.
type CapabilityDetector interface {
	DetectCapabilities() ([]string, error)
}
