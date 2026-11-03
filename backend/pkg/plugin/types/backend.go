package types

// CurrentProtocolVersion is the latest SDK protocol version supported by the engine.
// Bump this when adding a new protocol version.
const CurrentProtocolVersion = 1

// PluginBackend abstracts access to a plugin's capability providers.
// ExternalBackend uses a subprocess; InProcessBackend dispatches directly.
type PluginBackend interface {
	// Dispense returns a capability client by name (e.g. "resource", "exec").
	Dispense(name string) (interface{}, error)

	// Healthy returns true if the plugin is alive and serving.
	Healthy() bool

	// Stop closes external RPC access or waits for direct resource shutdown.
	Stop() error

	// Kill forcefully terminates external backends. Direct backends wait for Stop.
	Kill()

	// Exited reports process exit or completion of direct backend shutdown.
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
