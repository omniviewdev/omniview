package devsource

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
)

// VerifyUpstreamCommit checks a captured SDK commit without changing its checkout.
// It preserves the reviewed baseline and explicit isolation-source authorization.
func VerifyUpstreamCommit(ctx context.Context, directory, reviewedRevision, target string, opts VerifyOptions) error {
	if !fullRevision.MatchString(reviewedRevision) || !fullRevision.MatchString(target) {
		return errors.New("reviewed SDK baseline and upstream target require full commit identities")
	}
	for _, revision := range []string{reviewedRevision, target} {
		kind, err := command(ctx, directory, "cat-file", "-t", revision)
		if err != nil {
			return err
		}
		if strings.TrimSpace(string(kind)) != "commit" {
			return errors.New("SDK source identity must name a commit")
		}
	}
	if _, err := command(ctx, directory, "merge-base", "--is-ancestor", reviewedRevision, target); err != nil {
		return errors.New("SDK upstream does not descend from reviewed baseline")
	}
	if opts.AllowIsolationCoreChanges {
		return nil
	}
	for _, relative := range protectedFiles {
		if err := verifyUpstreamProtectedFile(ctx, directory, reviewedRevision, target, relative); err != nil {
			return err
		}
	}
	return nil
}

func verifyUpstreamProtectedFile(ctx context.Context, directory, reviewedRevision, target, relative string) error {
	baseline, err := command(ctx, directory, "show", reviewedRevision+":"+relative)
	if err != nil {
		return err
	}
	upstream, err := command(ctx, directory, "show", target+":"+relative)
	if err != nil {
		return err
	}
	mode, err := command(ctx, directory, "ls-tree", target, "--", relative)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(string(mode), "100644 ") && !strings.HasPrefix(string(mode), "100755 ") {
		return fmt.Errorf("SDK upstream isolation source is not a regular file: %s", relative)
	}
	if !bytes.Equal(baseline, upstream) {
		return fmt.Errorf("SDK upstream changes reviewed isolation boundary: %s", relative)
	}
	return nil
}
