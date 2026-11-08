package devworkspace

import (
	"context"
	"errors"

	"github.com/omniviewdev/omniview/internal/devbaseline"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// sdkReleaseUntrustedCode classifies a selected SDK the release trust policy
// does not admit: a refusal that needs an explicit operator decision (exit 4).
const sdkReleaseUntrustedCode = "sdk_release_untrusted"

// typedErrors returns every *devcontract.Error in err's chain in the order
// errors.As visits them (depth first, joined errors in join order).
func typedErrors(err error) []*devcontract.Error {
	var found []*devcontract.Error
	var walk func(error)
	walk = func(current error) {
		if current == nil {
			return
		}
		if typed, ok := current.(*devcontract.Error); ok && typed != nil {
			found = append(found, typed)
		}
		switch wrapped := current.(type) {
		case interface{ Unwrap() error }:
			walk(wrapped.Unwrap())
		case interface{ Unwrap() []error }:
			for _, inner := range wrapped.Unwrap() {
				walk(inner)
			}
		}
	}
	walk(err)
	return found
}

// typedErrorRank orders typed errors carried by one chain by consequence, not
// by exit number. A failed build joined with a publication conflict, or a trust
// refusal beside a failed command, is reported as the one that needs an
// operator's decision:
//
//	2  exit 4: conflicts, ownership and trust refusals
//	1  exit 5: failed commands and internal failures
//	0  everything else: usage (2), unmet prerequisites (3), authorization (6)
//	   and timeouts (7)
//
// A rebuilt error that lost its exit (Error.Exit is not serialized) ranks by the
// exit its code restores.
func typedErrorRank(typed *devcontract.Error) int {
	exit := typed.Exit
	if exit == 0 {
		exit = workspaceExitCode(typed.Code)
	}
	switch exit {
	case 4:
		return 2
	case 5:
		return 1
	default:
		return 0
	}
}

// classifyingTypedError picks the typed error that classifies a chain: the
// highest rank wins, and within a rank the first in chain order, so a chain with
// one typed error behaves exactly as errors.As did. A bare devsdk.ErrNotAccepted
// competes as a synthesized exit-4 sdk_release_untrusted, ordered after the
// chain's own typed errors.
func classifyingTypedError(err error) *devcontract.Error {
	candidates := typedErrors(err)
	if errors.Is(err, devsdk.ErrNotAccepted) {
		candidates = append(candidates, devcontract.Fail(4, sdkReleaseUntrustedCode,
			"the selected plugin SDK is not accepted by the release trust policy; select an SDK source repository that is"))
	}
	var best *devcontract.Error
	bestRank := -1
	for _, candidate := range candidates {
		if rank := typedErrorRank(candidate); rank > bestRank {
			best, bestRank = candidate, rank
		}
	}
	return best
}

func workspaceError(err error) *devcontract.Error {
	if err == nil {
		return nil
	}
	var conflict *devoutputs.Conflict
	if errors.As(err, &conflict) {
		// Only library-typed ownership fields cross the compiler diagnostic
		// boundary. Arbitrary compiler text is never copied into Details.
		payload := devcontract.Fail(4, "ownership_conflict", conflict.Error())
		payload.Details = map[string]any{"ownershipConflict": conflict}
		return payload
	}
	if typed := classifyingTypedError(err); typed != nil {
		copy := *typed
		if copy.Exit == 0 {
			copy.Exit = workspaceExitCode(copy.Code)
		}
		return &copy
	}
	var mismatch *devsession.ProcessIdentityMismatch
	if errors.As(err, &mismatch) {
		return devcontract.Fail(4, "stale_target", mismatch.Error())
	}
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return devcontract.Fail(7, "timeout", "workspace operation was interrupted or exceeded its deadline")
	case errors.Is(err, devsession.ErrPortConflict):
		return devcontract.Fail(4, "port_conflict", "the assigned strict listener could not bind; no process owning that port was stopped")
	case errors.Is(err, devsession.ErrAttemptsExhausted):
		return devcontract.Fail(4, "port_attempts_exhausted", "bounded sticky-port bind attempts were exhausted")
	case errors.Is(err, devsession.ErrOwnership):
		return devcontract.Fail(4, "stale_target", "session ownership does not match the selected workspace generation")
	case errors.Is(err, devbaseline.ErrSourceBusy):
		return devcontract.Fail(4, "baseline_source_busy", "stop the explicit baseline source before copying settings")
	case errors.Is(err, devbaseline.ErrDestinationExists):
		return devcontract.Fail(4, "baseline_destination_exists", "baseline seed requires a new absent state root; initialized state was not overwritten")
	default:
		return devcontract.Fail(5, "launch_failed", err.Error())
	}
}

// workspaceExitCode restores the exit class of an error rebuilt from JSON.
// devcontract.Error.Exit is deliberately not serialized, so an error that
// crossed the supervisor status or response boundary arrives with only its
// code. Codes missing from workspaceExitCodes are failures (exit 5).
func workspaceExitCode(code string) int {
	if exit, listed := workspaceExitCodes[code]; listed {
		return exit
	}
	return 5
}

// workspaceExitCodes lists every typed code whose constructor assigns an exit
// other than 5, so the code keeps its exit after crossing the supervisor
// boundary. TestWorkspaceExitCodesCoverEveryTypedConstructor scans the
// constructors and fails when a code is missing or disagrees; add new codes
// here with the exit their devcontract.Fail call uses. Codes whose code or exit
// is computed (profile-contract codes, the native removal child's exit status)
// cannot be scanned: that test also requires each such constructor to be listed
// by hand with the exits it can produce. A code that different constructors give
// different exits lists the blocking exit (4) here and is acknowledged in the
// test's ambiguous set.
var workspaceExitCodes = map[string]int{
	// Exit 2.
	"archive_runtime_options":   2,
	"duplicate_selection":       2,
	"extensions_unsupported":    2,
	"invalid_command":           2,
	"invalid_configuration":     2,
	"invalid_endpoint":          2,
	"invalid_follow_interval":   2,
	"invalid_identity":          2,
	"invalid_link":              2,
	"invalid_manifest":          2,
	"invalid_mcp_mode":          2,
	"invalid_mode":              2,
	"invalid_name":              2,
	"invalid_package":           2,
	"invalid_params":            2,
	"invalid_plugin":            2,
	"invalid_plugin_metadata":   2,
	"invalid_plugin_runtime":    2,
	"invalid_port":              2,
	"invalid_port_policy":       2,
	"invalid_process_override":  2,
	"invalid_profile":           2,
	"invalid_profile_binding":   2,
	"invalid_ref":               2,
	"invalid_repository":        2,
	"invalid_repository_path":   2,
	"invalid_request":           2,
	"invalid_slug":              2,
	"invalid_source_probe":      2,
	"invalid_state_root":        2,
	"invalid_target":            2,
	"invalid_upstream":          2,
	"missing_default_ref":       2,
	"missing_host":              2,
	"missing_plugin_repository": 2,
	"missing_root":              2,
	"missing_selection":         2,
	"missing_ui":                2,
	"plugin_source_required":    2,
	"sdk_source_required":       2,
	"unknown_operation":         2,
	"unknown_repository":        2,
	"unresolved_repository":     2,
	"unselected_ref":            2,
	"unselected_repository":     2,
	"unsupported_schema":        2,
	"usage":                     2,
	"validation_failed":         2,

	// Exit 3.
	"ambiguous_plugin":            3,
	"ambiguous_workspace":         3,
	"build_links_not_applied":     3,
	"control_unreachable":         3,
	"extensions_unavailable":      3,
	"frontend_not_ready":          3,
	"host_not_ready":              3,
	"link_evidence_required":      3,
	"link_protocol_unproved":      3,
	linkResolutionFailureCode:     3,
	"local_ref_missing":           3,
	"missing_plugin":              3,
	"missing_registry":            3,
	"missing_repository":          3,
	"missing_workspace":           3,
	"not_found":                   3,
	"operation_not_found":         3,
	"peer_contract_mismatch":      3,
	"process_bridge_unreachable":  3,
	"refresh_evidence_required":   3,
	"refresh_launch_required":     3,
	"sdk_contract_mismatch":       3,
	"setting_not_found":           3,
	"source_reload_unverified":    3,
	"ui_contract_mismatch":        3,
	"unproved_pnpm_version":       3,
	"unsupported_package_manager": 3,
	"vite_not_ready":              3,

	// Exit 4.
	"ambiguous_origin":              4,
	"archive_runtime_conflict":      4,
	"archive_runtime_source_update": 4,
	"baseline_conflict":             4,
	"baseline_destination_exists":   4,
	"baseline_source_busy":          4,
	"collection_busy":               4,
	"composition_changed":           4,
	"composition_not_installed":     4,
	"conflict":                      4,
	"conflicting_state_root":        4,
	"conflicting_target":            4,
	"dependency_inputs_unreadable":  4,
	"dirty_worktree":                4,
	"duplicate_source":              4,
	"edit_pending":                  4,
	"escaping_repository":           4,
	"follow_fence_invalid":          4,
	"follow_owned":                  4,
	"foreign_files":                 4,
	"foreign_profile":               4,
	"foreign_profile_lock":          4,
	"foreign_recovery":              4,
	"foreign_registry":              4,
	"foreign_retirement":            4,
	"foreign_staging":               4,
	"foreign_workspace":             4,
	"foreign_worktree":              4,
	"generated_cleanup_pending":     4,
	"generated_conflict":            4,
	"generated_pending":             4,
	"git_state_unreadable":          4,
	"invalid_journal":               4,
	"invalid_launch_generation":     4,
	"invalid_link_journal":          4,
	"invalid_phase":                 4,
	"invalid_process_bridge":        4,
	"invalid_process_port":          4,
	"invalid_process_source":        4,
	"invalid_refresh":               4,
	"invalid_registry":              4,
	"invalid_retirement":            4,
	"invalid_source_update":         4,
	"launch_authorization_exists":   4,
	"launch_authorization_invalid":  4,
	"launch_authorization_missing":  4,
	"launch_conflict":               4,
	"link_conflict":                 4,
	"link_interrupted":              4,
	"link_merge_conflict":           4,
	"link_required":                 4,
	"manifest_changed":              4,
	"missing_build_graph":           4,
	"native_profile_conflict":       4,
	"non_fast_forward":              4,
	"occupied_branch":               4,
	"operation_capacity":            4,
	"overlapping_repositories":      4,
	"ownership_changed":             4,
	"ownership_conflict":            4,
	"plugin_identity_changed":       4,
	"port_attempts_exhausted":       4,
	"port_conflict":                 4,
	"process_conflict":              4,
	"process_output_overflow":       4,
	"profile_binding_changed":       4,
	"profile_busy":                  4,
	"profile_conflict":              4,
	"protected_state_root":          4,
	"recovery_disappeared":          4,
	"recovery_not_terminal":         4,
	"recovery_state_changed":        4,
	"refresh_intent_mismatch":       4,
	"refresh_launch_in_progress":    4,
	"refresh_not_ready":             4,
	"registry_exists":               4,
	"removal_options_changed":       4,
	"removal_pending":               4,
	"repository_in_use":             4,
	"retained_branch":               4,
	"rollback_not_allowed":          4,
	"rollback_pending":              4,
	sdkReleaseUntrustedCode:         4,
	"shutting_down":                 4,
	"source_changed":                4,
	"source_mismatch":               4,
	"source_recovery_mismatch":      4,
	"source_recovery_required":      4,
	"stale_target":                  4,
	"stale_update_plan":             4,
	"stop_check_required":           4,
	"supervisor_conflict":           4,
	"supervisor_unreachable":        4,
	"supervisor_upgrade_required":   4,
	"unknown_workspace_references":  4,
	"update_blocked":                4,
	"upstream_missing":              4,
	"user_commits":                  4,
	"vite_feedback_conflict":        4,
	"workspace_busy":                4,
	"workspace_exists":              4,
	"workspace_incomplete":          4,
	"workspace_running":             4,

	// Exit 6.
	"unauthorized": 6,

	// Exit 7.
	"timeout": 7,
}
