package extensionpolicy

import (
	"os/exec"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPolicyWatchRejectsExtendedDarwinACL(t *testing.T) {
	watchPermissionChange(t, func(path string) {
		// A private st_mode alone is not proof: the OS grants the ACE in addition.
		out, err := exec.Command("/bin/chmod", "+a", "everyone allow read", path).CombinedOutput()
		require.NoError(t, err, "%s", out)
	})
}
