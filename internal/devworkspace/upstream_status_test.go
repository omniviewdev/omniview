package devworkspace

import (
	"os/exec"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNextCommandQuotesLiteralShellMetacharacters(t *testing.T) {
	values := []string{"space path", "$(exit 29)", "`exit 31`", "quote'path", "$HOME", "semi;colon"}
	for _, value := range values {
		command := "printf '%s' " + shellArgument(value)
		raw, err := exec.Command("/bin/sh", "-c", command).CombinedOutput()
		require.NoError(t, err)
		require.Equal(t, value, string(raw))
	}
	command := shellCommand([]string{"printf", "%s", "a b", "$HOME", "`exit 1`"})
	raw, err := exec.Command("/bin/sh", "-c", command).CombinedOutput()
	require.NoError(t, err)
	require.Equal(t, strings.Join([]string{"a b", "$HOME", "`exit 1`"}, ""), string(raw))
}
