package devworkspace

import (
	"context"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
)

// LaunchPreflight reports launch inputs without installing dependencies or starting processes.
// Readiness here does not replace source trust, composition or runtime checks at launch.
type LaunchPreflight struct {
	Ready            bool                   `json:"ready"`
	Issues           []*devcontract.Error   `json:"issues"`
	OwnershipChecked bool                   `json:"ownershipChecked"`
	Ownership        *devoutputs.Inspection `json:"ownership,omitempty"`
}

// PreflightLaunch checks all independent launch prerequisites, retaining the normal gates.
func PreflightLaunch(ctx context.Context, w Workspace, o LaunchOptions) LaunchPreflight {
	report := LaunchPreflight{Issues: []*devcontract.Error{}}
	if o.LinkEvidence.Protocol == "" {
		report.Issues = append(report.Issues, devcontract.Fail(3, "link_evidence_required", "provide --link-evidence with the actual successful pinned protocol probe report"))
	} else if err := o.LinkEvidence.validate(); err != nil {
		report.Issues = append(report.Issues, err.(*devcontract.Error))
	}
	if w.Manifest.Links.SDKRepositoryID == nil {
		report.Issues = append(report.Issues, sdkSourceRequired(ctx, "launch requires --repo plugin-sdk even without SDK development; add it with workspace edit --add-repo plugin-sdk", workspaceSDKProbes(w), editAddSDKCommand(w)))
	}
	if o.Mode != "browser" && o.Mode != "native" {
		report.Issues = append(report.Issues, devcontract.Fail(2, "invalid_mode", "mode must be browser or native"))
	}
	if o.MCP && o.Mode != "native" {
		report.Issues = append(report.Issues, devcontract.Fail(2, "invalid_mcp_mode", "native MCP requires --mode native"))
	}
	report.Ready = len(report.Issues) == 0
	return report
}
