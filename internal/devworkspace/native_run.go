package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func runNativeRemovalCommand(ctx context.Context, w Workspace, guards []GuardFile, options LaunchOptions, binary string, diagnostics io.Writer) error {
	if len(guards) == 0 {
		return devcontract.Fail(4, "native_profile_conflict", "native removal requires the canonical guarded transaction")
	}
	mapping := map[string]int{}
	files := make([]*os.File, 0, len(guards))
	for _, guard := range guards {
		if guard.File == nil || mapping[guard.Role] != 0 {
			return devcontract.Fail(4, "native_profile_conflict", "native removal guard capability is invalid")
		}
		switch guard.Role {
		case "uuid", "selected-state", "default-state":
		default:
			return devcontract.Fail(4, "native_profile_conflict", "native removal guard role is invalid")
		}
		files = append(files, guard.File)
		mapping[guard.Role] = len(files) + 2
	}
	if mapping["uuid"] == 0 {
		return devcontract.Fail(4, "native_profile_conflict", "native removal has no UUID guard")
	}
	encoded, err := json.Marshal(mapping)
	if err != nil {
		return err
	}
	deadline, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	command := exec.CommandContext(deadline, binary, "--remove-native-profile", w.ManifestPath)
	command.Env = append(workspaceEnvironment(os.Environ(), w, NewGeneration(), options), "OMNIVIEW_NATIVE_PURGE_LOCK_FDS="+string(encoded))
	command.ExtraFiles = files
	command.Stdout = diagnostics
	command.Stderr = diagnostics
	// ExtraFiles duplicates borrowed parent OFDs; this function never closes or
	// unlocks them. The native child validates/carries them through its callback.
	if err = command.Run(); err != nil {
		if deadline.Err() != nil {
			return devcontract.Fail(7, "timeout", "native removal callback did not complete before its deadline")
		}
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			code := exit.ExitCode()
			if code != 2 && code != 4 && code != 5 && code != 7 {
				code = 5
			}
			return devcontract.Fail(code, "native_profile_purge_failed", "native WebKit removal did not complete; source/state removal was not committed")
		}
		return err
	}
	return nil
}
