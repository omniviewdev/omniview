package terminal

import (
	"context"
	"os"
	"os/exec"
)

// Session represents an individual terminal session.
type Session struct {
	cmd      *exec.Cmd          // The command being run in this session.
	ptyFile  *os.File           // File descriptor for the pseudo-terminal device.
	buffer   *OutputBuffer      // Stores session output for retrieval upon reattachment.
	labels   map[string]string  // Labels for the session.
	ctx      context.Context    // Context to control the lifetime of the session.
	cancel   context.CancelFunc // Function to cancel the context, terminating the session.
	ID       string
	attached bool // Indicates if the session is currently broadcasting output.
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
