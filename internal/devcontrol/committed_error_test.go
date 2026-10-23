//go:build devcontrol

package devcontrol

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

func TestCommittedCleanupErrorPreservesCommitFactWithoutPrivateDiagnostics(t *testing.T) {
	for _, test := range []struct {
		name, kind string
		committed  bool
	}{
		{"committed backup maintenance", "omniview:plugin/committed-cleanup-pending", true},
		{"unclassified plugin failure", "omniview:plugin/unclassified", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			failure := apperror.Wrap(errors.New("private-cause-secret"), test.kind, http.StatusInternalServerError, "private-title-secret")
			failure.Detail = "/private/profile-secret/backup token=private-token-secret"
			failure.Instance = "private-instance-secret"
			failure.Suggestions = []string{"private-suggestion-secret"}
			public := safeError(fmt.Errorf("private-wrapper-secret: %w", failure))
			if public.Exit != 5 {
				t.Fatalf("wrong maintenance failure exit: %d", public.Exit)
			}
			if test.committed {
				if public.Code != "committed_cleanup_pending" || public.Details["committed"] != true || public.Details["recoveryRequired"] != true {
					t.Fatalf("committed candidate was hidden as an ordinary rejected operation: %+v", public)
				}
			} else if public.Code == "committed_cleanup_pending" || public.Details["committed"] == true {
				t.Fatalf("unknown error falsely claimed a committed installation: %+v", public)
			}
			data, err := json.Marshal(public)
			if err != nil {
				t.Fatal(err)
			}
			for _, private := range []string{"private-cause-secret", "private-title-secret", "profile-secret", "private-token-secret", "private-instance-secret", "private-suggestion-secret", "private-wrapper-secret"} {
				if strings.Contains(string(data), private) {
					t.Fatalf("control leaked private diagnostics: %s", data)
				}
			}
		})
	}
}

func TestUncertainCommitErrorRequiresRecoveryWithoutClaimingCommit(t *testing.T) {
	failure := apperror.Wrap(errors.New("private-sync-cause"), "omniview:plugin/commit-uncertain", http.StatusInternalServerError, "private-title")
	failure.Detail = "/private/uncertain-backup token=private-uncertain-token"
	public := safeError(failure)
	if public.Exit != 5 || public.Code != "commit_uncertain" || public.Details["recoveryRequired"] != true || public.Details["commitUncertain"] != true || public.Details["committed"] == true {
		t.Fatalf("uncertain publication lost its recovery boundary: %+v", public)
	}
	public = safeError(public)
	if public.Code != "commit_uncertain" || public.Details["commitUncertain"] != true || public.Details["committed"] == true {
		t.Fatalf("repeated sanitization invented commit or discarded uncertainty: %+v", public)
	}
	data, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"private-sync-cause", "private-title", "uncertain-backup", "private-uncertain-token"} {
		if strings.Contains(string(data), private) {
			t.Fatalf("uncertain commit leaked private diagnostics: %s", data)
		}
	}
}
