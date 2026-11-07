package main

import (
	"bytes"
	"testing"

	"github.com/omniviewdev/omniview/internal/devworkspace"
	"github.com/stretchr/testify/require"
)

// Only an interrupted unlink points at unlink/remove; an interrupted first
// launch must not send the user to a transaction that is not in progress.
func TestResetModulesOutputNamesTheInterruptedOperation(t *testing.T) {
	var unlinking, applying bytes.Buffer
	printWorkspaceValue(&unlinking, devworkspace.ResetModulesReport{WorkspaceID: "w", Phase: "unlinking"})
	printWorkspaceValue(&applying, devworkspace.ResetModulesReport{WorkspaceID: "w", Phase: "applying"})
	require.Contains(t, unlinking.String(), "workspace unlink")
	require.NotContains(t, applying.String(), "workspace unlink")
	require.NotContains(t, applying.String(), "workspace remove")
	require.Contains(t, applying.String(), "applying")
}
