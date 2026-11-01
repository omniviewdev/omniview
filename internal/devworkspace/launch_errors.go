package devworkspace

import (
	"context"
	"errors"

	"github.com/omniviewdev/omniview/internal/devbaseline"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func workspaceError(err error) *devcontract.Error {
	if err == nil {
		return nil
	}
	var typed *devcontract.Error
	if errors.As(err, &typed) {
		copy := *typed
		if copy.Exit == 0 {
			switch copy.Code {
			case "usage", "invalid_mode", "invalid_mcp_mode", "reviewed_sdk_required":
				copy.Exit = 2
			case "missing_workspace", "link_evidence_required", linkResolutionFailureCode, "host_not_ready", "sdk_contract_mismatch", "ui_contract_mismatch":
				copy.Exit = 3
			case "stale_target", "workspace_running", "workspace_busy", "launch_conflict", "generated_conflict", "generated_pending", "port_conflict", "port_attempts_exhausted", "sdk_source_untrusted", "native_profile_conflict", "edit_pending", "baseline_conflict":
				copy.Exit = 4
			case "unauthorized":
				copy.Exit = 6
			case "timeout":
				copy.Exit = 7
			default:
				copy.Exit = 5
			}
		}
		return &copy
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
