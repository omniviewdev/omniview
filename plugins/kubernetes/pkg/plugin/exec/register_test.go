package exec

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/exec"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClassifyExecError(t *testing.T) {
	type expected struct {
		title         string
		retryable     bool
		retryCommands []string
	}

	tests := []struct {
		name     string
		errMsg   string
		command  []string
		expected expected
	}{
		// --- Pattern: "no such file or directory" ---
		{
			name:    "no such file or directory - exact",
			errMsg:  "no such file or directory",
			command: []string{"/bin/bash"},
			expected: expected{
				title:         "Shell not found",
				retryable:     true,
				retryCommands: []string{"sh", "/bin/sh", "ash"},
			},
		},
		{
			name:    "no such file or directory - case insensitive",
			errMsg:  "NO SUCH FILE OR DIRECTORY",
			command: []string{"/bin/bash"},
			expected: expected{
				title:         "Shell not found",
				retryable:     true,
				retryCommands: []string{"sh", "/bin/sh", "ash"},
			},
		},
		{
			name:    "no such file or directory - wrapped with context",
			errMsg:  `OCI runtime exec failed: exec failed: unable to start container process: exec: "/bin/zsh": stat /bin/zsh: no such file or directory`,
			command: []string{"/bin/zsh"},
			expected: expected{
				title:         "Shell not found",
				retryable:     true,
				retryCommands: []string{"sh", "/bin/sh", "ash"},
			},
		},

		// --- Pattern: "executable file not found" ---
		{
			name:    "executable file not found - exact",
			errMsg:  "executable file not found",
			command: []string{"bash"},
			expected: expected{
				title:         "Shell not found",
				retryable:     true,
				retryCommands: []string{"sh", "/bin/sh", "ash"},
			},
		},
		{
			name:    "executable file not found - case insensitive",
			errMsg:  "EXECUTABLE FILE NOT FOUND in $PATH",
			command: []string{"bash"},
			expected: expected{
				title:         "Shell not found",
				retryable:     true,
				retryCommands: []string{"sh", "/bin/sh", "ash"},
			},
		},
		{
			name:    "executable file not found - wrapped",
			errMsg:  `exec: "bash": executable file not found in $PATH`,
			command: []string{"bash", "-c", "echo hello"},
			expected: expected{
				title:         "Shell not found",
				retryable:     true,
				retryCommands: []string{"sh", "/bin/sh", "ash"},
			},
		},

		// --- Pattern: "oci runtime exec failed" ---
		{
			name:    "oci runtime exec failed - exact",
			errMsg:  "oci runtime exec failed",
			command: []string{"sh"},
			expected: expected{
				title:         "Container runtime error",
				retryable:     true,
				retryCommands: []string{"sh", "/bin/sh"},
			},
		},
		{
			name:    "oci runtime exec failed - case insensitive",
			errMsg:  "OCI Runtime Exec Failed: something went wrong",
			command: []string{"sh"},
			expected: expected{
				title:         "Container runtime error",
				retryable:     true,
				retryCommands: []string{"sh", "/bin/sh"},
			},
		},

		// --- Pattern: "permission denied" ---
		{
			name:    "permission denied - exact",
			errMsg:  "permission denied",
			command: []string{"/bin/sh"},
			expected: expected{
				title:         "Permission denied",
				retryable:     false,
				retryCommands: nil,
			},
		},
		{
			name:    "permission denied - case insensitive",
			errMsg:  "PERMISSION DENIED",
			command: []string{"/bin/sh"},
			expected: expected{
				title:         "Permission denied",
				retryable:     false,
				retryCommands: nil,
			},
		},
		{
			name:    "permission denied - wrapped",
			errMsg:  `error: pods "my-pod" is forbidden: User "dev" cannot exec in namespace "production": permission denied`,
			command: []string{"/bin/sh"},
			expected: expected{
				title:         "Permission denied",
				retryable:     false,
				retryCommands: nil,
			},
		},

		// --- Pattern: "container not running" ---
		{
			name:    "container not running - exact",
			errMsg:  "container not running",
			command: []string{"/bin/sh"},
			expected: expected{
				title:         "Container not running",
				retryable:     false,
				retryCommands: nil,
			},
		},
		{
			name:    "container not running - case insensitive",
			errMsg:  "Container Not Running",
			command: []string{"/bin/sh"},
			expected: expected{
				title:         "Container not running",
				retryable:     false,
				retryCommands: nil,
			},
		},

		// --- Pattern: "cannot exec in a stopped" ---
		{
			name:    "cannot exec in a stopped - exact",
			errMsg:  "cannot exec in a stopped container",
			command: []string{"/bin/sh"},
			expected: expected{
				title:         "Container stopped",
				retryable:     false,
				retryCommands: nil,
			},
		},
		{
			name:    "cannot exec in a stopped - case insensitive",
			errMsg:  "CANNOT EXEC IN A STOPPED container",
			command: []string{"/bin/sh"},
			expected: expected{
				title:         "Container stopped",
				retryable:     false,
				retryCommands: nil,
			},
		},

		// --- Pattern: "container name must be specified" ---
		{
			name:    "container name must be specified - exact",
			errMsg:  "container name must be specified",
			command: []string{"/bin/sh"},
			expected: expected{
				title:         "Container not specified",
				retryable:     false,
				retryCommands: nil,
			},
		},
		{
			name:    "container name must be specified - case insensitive",
			errMsg:  "CONTAINER NAME MUST BE SPECIFIED for pod my-pod",
			command: []string{"/bin/sh"},
			expected: expected{
				title:         "Container not specified",
				retryable:     false,
				retryCommands: nil,
			},
		},

		// --- Default fallback ---
		{
			name:    "unrecognized error - default fallback",
			errMsg:  "some completely unknown error occurred",
			command: []string{"/bin/sh"},
			expected: expected{
				title:         "Exec failed",
				retryable:     true,
				retryCommands: []string{"sh", "/bin/sh"},
			},
		},
		{
			name:    "unrecognized error - network timeout",
			errMsg:  "dial tcp 10.0.0.1:443: i/o timeout",
			command: []string{"bash"},
			expected: expected{
				title:         "Exec failed",
				retryable:     true,
				retryCommands: []string{"sh", "/bin/sh"},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			origErr := errors.New(tc.errMsg)
			result := classifyExecError(origErr, tc.command)

			require.Error(t, result)

			var execErr *sdkexec.ExecError
			require.True(t, errors.As(result, &execErr), "result should be *sdkexec.ExecError, got %T", result)

			assert.Equal(t, tc.expected.title, execErr.Title)
			assert.Equal(t, tc.expected.retryable, execErr.Retryable)
			assert.Equal(t, tc.expected.retryCommands, execErr.RetryCommands)

			// Original error is preserved
			assert.Equal(t, origErr, execErr.Err)
			assert.ErrorIs(t, execErr, origErr)

			// Message contains the original error text
			assert.Equal(t, tc.errMsg, execErr.Message)

			// Error() delegates to the wrapped error
			assert.Equal(t, origErr.Error(), execErr.Error())
		})
	}
}

func TestClassifyExecError_SuggestionContent(t *testing.T) {
	t.Run("shell not found (no such file) includes the command in suggestion", func(t *testing.T) {
		command := []string{"/bin/bash"}
		origErr := errors.New("no such file or directory")
		result := classifyExecError(origErr, command)

		var execErr *sdkexec.ExecError
		require.True(t, errors.As(result, &execErr))

		assert.Contains(t, execErr.Suggestion, "/bin/bash")
		assert.Contains(t, execErr.Suggestion, "not found")
	})

	t.Run("shell not found (executable not found) includes the command in suggestion", func(t *testing.T) {
		command := []string{"zsh"}
		origErr := errors.New("executable file not found in $PATH")
		result := classifyExecError(origErr, command)

		var execErr *sdkexec.ExecError
		require.True(t, errors.As(result, &execErr))

		assert.Contains(t, execErr.Suggestion, "zsh")
		assert.Contains(t, execErr.Suggestion, "not available")
	})

	t.Run("multi-word command formats correctly in suggestion for no such file", func(t *testing.T) {
		command := []string{"/bin/sh", "-c", "echo hello"}
		joined := strings.Join(command, " ")
		origErr := errors.New("no such file or directory")
		result := classifyExecError(origErr, command)

		var execErr *sdkexec.ExecError
		require.True(t, errors.As(result, &execErr))

		// The suggestion should contain the full joined command string
		assert.Contains(t, execErr.Suggestion, joined)
	})

	t.Run("multi-word command formats correctly in suggestion for executable not found", func(t *testing.T) {
		command := []string{"bash", "-c", "ls -la"}
		joined := strings.Join(command, " ")
		origErr := errors.New("executable file not found")
		result := classifyExecError(origErr, command)

		var execErr *sdkexec.ExecError
		require.True(t, errors.As(result, &execErr))

		assert.Contains(t, execErr.Suggestion, joined)
	})

	t.Run("exact suggestion text for no such file or directory", func(t *testing.T) {
		command := []string{"/bin/zsh"}
		origErr := errors.New("no such file or directory")
		result := classifyExecError(origErr, command)

		var execErr *sdkexec.ExecError
		require.True(t, errors.As(result, &execErr))

		expectedSuggestion := fmt.Sprintf(
			"The shell %q was not found in this container. It may be a distroless or minimal image.",
			strings.Join(command, " "),
		)
		assert.Equal(t, expectedSuggestion, execErr.Suggestion)
	})

	t.Run("exact suggestion text for executable file not found", func(t *testing.T) {
		command := []string{"fish"}
		origErr := errors.New("executable file not found")
		result := classifyExecError(origErr, command)

		var execErr *sdkexec.ExecError
		require.True(t, errors.As(result, &execErr))

		expectedSuggestion := fmt.Sprintf(
			"The executable %q is not available in this container's PATH.",
			strings.Join(command, " "),
		)
		assert.Equal(t, expectedSuggestion, execErr.Suggestion)
	})

	t.Run("oci runtime error has static suggestion", func(t *testing.T) {
		origErr := errors.New("oci runtime exec failed: something")
		result := classifyExecError(origErr, []string{"sh"})

		var execErr *sdkexec.ExecError
		require.True(t, errors.As(result, &execErr))

		assert.Equal(t,
			"The container runtime could not execute the command. The container may be a distroless image.",
			execErr.Suggestion,
		)
	})

	t.Run("permission denied has static suggestion", func(t *testing.T) {
		origErr := errors.New("permission denied")
		result := classifyExecError(origErr, []string{"/bin/sh"})

		var execErr *sdkexec.ExecError
		require.True(t, errors.As(result, &execErr))

		assert.Equal(t,
			"You may not have permission to exec into this container. Check your RBAC rules.",
			execErr.Suggestion,
		)
	})

	t.Run("default fallback has static suggestion", func(t *testing.T) {
		origErr := errors.New("totally unexpected error")
		result := classifyExecError(origErr, []string{"/bin/sh"})

		var execErr *sdkexec.ExecError
		require.True(t, errors.As(result, &execErr))

		assert.Equal(t, "The exec session failed unexpectedly.", execErr.Suggestion)
	})
}

func TestClassifyExecError_PatternPriority(t *testing.T) {
	t.Run("first matching pattern wins when error contains multiple patterns", func(t *testing.T) {
		// "no such file or directory" appears before "oci runtime exec failed" in the slice,
		// but this error contains both patterns. The first match should win.
		origErr := errors.New("oci runtime exec failed: no such file or directory")
		result := classifyExecError(origErr, []string{"/bin/bash"})

		var execErr *sdkexec.ExecError
		require.True(t, errors.As(result, &execErr))

		// "no such file or directory" is checked first in the classifications slice
		assert.Equal(t, "Shell not found", execErr.Title)
		assert.Equal(t, true, execErr.Retryable)
		assert.Equal(t, []string{"sh", "/bin/sh", "ash"}, execErr.RetryCommands)
	})
}
