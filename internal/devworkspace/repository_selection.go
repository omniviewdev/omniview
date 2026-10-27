package devworkspace

import (
	"context"
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
		if _, err = git(ctx, common, "", "fetch", "--no-tags", "--no-recurse-submodules", "--", remote, "+refs/heads/"+branch+":"+tracking); err != nil {
			return "", err
		}
		return resolveCommit(ctx, common, tracking)
	}
	return resolveCommit(ctx, common, ref)
}
