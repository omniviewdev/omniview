package devworkspace

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// IsPinnedRef identifies hexadecimal commit selections, including common
// abbreviated object IDs. Branch and tag selections remain named refs.
func IsPinnedRef(ref string) bool {
	if len(ref) < 7 || len(ref) > 64 {
		return false
	}
	for _, c := range ref {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// resolveSelectedCommit refreshes an explicitly named remote-tracking branch
// before resolving it. Local branches, tags and pinned commits need no fetch.
// Fetching only the requested branch also supports bare repositories without a
// remote fetch refspec. The workspace records both the selection and this SHA.
func resolveSelectedCommit(ctx context.Context, common, ref string) (string, error) {
	if strings.TrimSpace(ref) == "" || strings.ContainsAny(ref, "\x00\r\n") {
		return "", devcontract.Fail(2, "invalid_ref", "source ref must be nonempty single-line text")
	}
	if IsPinnedRef(ref) {
		return resolveCommit(ctx, common, ref)
	}
	remoteRef := strings.TrimPrefix(ref, "refs/remotes/")
	// Explicit refs/heads and refs/tags must never be mistaken for remotes.
	if strings.HasPrefix(remoteRef, "refs/") {
		return resolveCommit(ctx, common, ref)
	}
	remotes, err := git(ctx, common, "", "remote")
	if err != nil {
		return "", err
	}
	for _, remote := range strings.Split(remotes, "\n") {
		branch, ok := strings.CutPrefix(remoteRef, remote+"/")
		if remote == "" || !ok {
			continue
		}
		if _, err = git(ctx, common, "", "check-ref-format", "refs/heads/"+branch); err != nil {
			return "", devcontract.Fail(2, "invalid_ref", "remote branch selection is invalid")
		}
		tracking := "refs/remotes/" + remote + "/" + branch
		if err = fetchSelectedBranch(ctx, common, remote, branch, tracking); err != nil {
			return "", err
		}
		return resolveCommit(ctx, common, tracking)
	}
	return resolveCommit(ctx, common, ref)
}

// fetchSelectedBranch imports only credential helper settings from global
// configuration. All other Git configuration remains isolated by git().
func fetchSelectedBranch(ctx context.Context, common, remote, branch, tracking string) error {
	fetchArgs := []string{"fetch", "--no-tags", "--no-recurse-submodules", "--", remote, "+refs/heads/" + branch + ":" + tracking}
	remoteURL, err := git(ctx, common, "", "remote", "get-url", remote)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(strings.ToLower(remoteURL), "https://") && !strings.HasPrefix(strings.ToLower(remoteURL), "http://") {
		_, err = git(ctx, common, "", fetchArgs...)
		return err
	}
	query := exec.CommandContext(ctx, "git", "-C", common, "config", "--global", "--null", "--includes", "--get-regexp", `^credential(\..*)?\.helper$`)
	// Global scope excludes local values while retaining gitdir include matching.
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if !strings.HasPrefix(key, "GIT_") && key != "GOWORK" {
			query.Env = append(query.Env, entry)
		}
	}
	query.Env = append(query.Env, "GIT_TERMINAL_PROMPT=0", "GOWORK=off")
	raw, err := query.Output()
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 1 {
			return devcontract.Fail(5, "git_credentials", "cannot read credential helper configuration; repair Git configuration before fetching the selected source")
		}
	}
	args := []string{}
	for _, record := range strings.Split(string(raw), "\x00") {
		if record == "" {
			continue
		}
		key, value, ok := strings.Cut(record, "\n")
		if !ok {
			return devcontract.Fail(5, "git_credentials", "cannot read credential helper configuration")
		}
		args = append(args, "-c", key+"="+value)
	}
	args = append(args, fetchArgs...)
	_, err = git(ctx, common, "", args...)
	if err != nil && ctx.Err() == nil {
		return devcontract.Fail(5, "git_failed", "cannot fetch selected source; check remote access and configured Git credential helpers")
	}
	return err
}
