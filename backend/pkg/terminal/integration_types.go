package terminal

// IntegrationState is what the host says of a terminal's shell integration.
type IntegrationState string

// The states of the fact. A terminal has exactly one.
const (
	// IntegrationOn: the shell was started with the integration and said it loaded it.
	IntegrationOn IntegrationState = "on"
	// IntegrationOff: the user turned the integration off in Settings.
	IntegrationOff IntegrationState = "off"
	// IntegrationSkipped: the host did not try (Reason says why).
	IntegrationSkipped IntegrationState = "skipped"
	// IntegrationFailed: the host tried and the shell did not come up with it (Reason says why); the shell that runs
	// has none.
	IntegrationFailed IntegrationState = "failed"
)

// IntegrationReason is why an integration is skipped or failed: a token, never free text, so that no path or
// message of the user's reaches the answer.
type IntegrationReason string

// The reasons of a skipped integration and of a failed one.
const (
	// SkipCommand: the shell was asked to run a command (`-c`), not to be a terminal.
	SkipCommand IntegrationReason = "command"
	// SkipArguments: the shell was given arguments the host does not know (the user's profile is not broken for it).
	SkipArguments IntegrationReason = "arguments"
	// SkipPosix: the shell was started in POSIX mode, which does not read the startup files the integration uses.
	SkipPosix IntegrationReason = "posix"
	// SkipPowerlevel10k: powerlevel10k is loaded (P9K_VERSION): it draws its own prompt and marks.
	SkipPowerlevel10k IntegrationReason = "powerlevel10k"
	// SkipMultiplexer: the host itself runs inside tmux or screen.
	SkipMultiplexer IntegrationReason = "multiplexer"
	// SkipUnsupportedShell: the integration has no script for this shell yet.
	SkipUnsupportedShell IntegrationReason = "unsupported-shell"
	// FailSetup: the host could not make what the integration needs (its directory, its channel, its nonce); the
	// shell started without it.
	FailSetup IntegrationReason = "setup"
	// FailExitedEarly: the shell ended within moments of its start with the integration and was started once more
	// without it.
	FailExitedEarly IntegrationReason = "exited-early"
)

// Integration is the typed fact of the create answer. Reason is set for skipped and failed only. The nonce of the
// session is not in it: the host keeps the nonce and the page never needs it.
type Integration struct {
	State  IntegrationState  `json:"state"`
	Reason IntegrationReason `json:"reason,omitempty"`
}
