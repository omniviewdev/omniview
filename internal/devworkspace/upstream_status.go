package devworkspace

import (
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devsession"
)

// addUpstreamStatus reads diagnostics only; it never fetches or creates authority.
func (m *Manager) addUpstreamStatus(status *Status) {
	base, err := upstreamRecoveryDirectory(m, status.Workspace)
	if err != nil {
		return
	}
	var followed FollowStatus
	if devsession.ReadPrivateJSON(filepath.Join(base, "follow-status.json"), &followed) == nil &&
		followed.WorkspaceID == status.Manifest.WorkspaceID {
		owner := devsession.ProcessOwner{
			WorkspaceID: followed.WorkspaceID, Generation: followed.Owner, Role: "follower", Source: status.Root,
		}
		if followed.Enabled && devsession.VerifyOwnedProcess(followed.Process, owner) != nil {
			followed.Enabled = false
			followed.Result = "owner_exited"
		}
		status.Follow = &followed
	}
	var intent refreshIntent
	if devsession.ReadPrivateJSON(filepath.Join(base, "refresh.json"), &intent) == nil &&
		intent.WorkspaceID == status.Manifest.WorkspaceID && intent.Root == status.Root {
		status.Update = intent.Plan
		status.RecoveryCommand = "omniview-dev workspace recover " +
			shellArgument(status.Manifest.Slug) + " --root " + shellArgument(m.Root)
	}
	if sourceIntent, sourceErr := readSourceUpdate(m, status.Workspace); sourceErr == nil {
		status.Update = &sourceIntent.Plan
		status.RecoveryCommand = shellCommand([]string{
			"omniview-dev", "workspace", "recover", status.Manifest.Slug, "--root", m.Root,
		})
	}
}

func shellArgument(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func shellCommand(arguments []string) string {
	quoted := make([]string, len(arguments))
	for i, argument := range arguments {
		quoted[i] = shellArgument(argument)
	}
	return strings.Join(quoted, " ")
}
