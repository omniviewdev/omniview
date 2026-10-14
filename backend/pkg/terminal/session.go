package terminal

// Session represents an individual terminal session.
type Session struct {
	ID string
}

// SessionOptions contains options for creating a new terminal session.
type SessionOptions struct {
	ID string `json:"id"`
	// Labels are arbitrary key-value pairs for the session that can be used to filter sessions, or
	// to provide additional information about the session.
	Labels map[string]string `json:"labels"`
	// Kubeconfig is the path to the kubeconfig file.
	Kubeconfig string `json:"kubeconfig"`
	// Context is the name of the context to use.
	Context string `json:"context"`
}

// SessionDetails contains details about a terminal session.
type SessionDetails struct {
	// Labels are key-value pairs for the session.
	Labels map[string]string `json:"labels"`
	// ID is the unique identifier for the session.
	ID string `json:"id"`
	// Command is the command being run in the session.
	Command string `json:"command"`
	// Attached indicates if the session is currently broadcasting output.
	Attached bool `json:"attached"`
}
