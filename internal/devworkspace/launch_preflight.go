package devworkspace

import "github.com/omniviewdev/omniview/internal/devcontract"

// LaunchPreflight reports launch inputs without installing dependencies or starting processes.
// Readiness here does not replace source trust, composition or runtime checks at launch.
type LaunchPreflight struct {
	Ready  bool                 `json:"ready"`
	Issues []*devcontract.Error `json:"issues"`
}

// PreflightLaunch checks all independent launch prerequisites, retaining the normal gates.
func PreflightLaunch(w Workspace, o LaunchOptions) LaunchPreflight {
	report := LaunchPreflight{Issues: []*devcontract.Error{}}
	if o.LinkEvidence.Protocol == "" {
		report.Issues = append(report.Issues, devcontract.Fail(3, "link_evidence_required", "provide --link-evidence with the actual successful pinned protocol probe report"))
	} else if err := o.LinkEvidence.validate(); err != nil {
		report.Issues = append(report.Issues, err.(*devcontract.Error))
	}
	if !reviewedSDKRevision.MatchString(o.ReviewedSDKRevision) {
		report.Issues = append(report.Issues, devcontract.Fail(2, "reviewed_sdk_required", "supply an independently reviewed full SDK commit with --reviewed-sdk-revision"))
	}
	if w.Manifest.Links.SDKRepositoryID == nil {
		report.Issues = append(report.Issues, devcontract.Fail(2, "sdk_source_required", "launch requires --repo plugin-sdk even without SDK development; add it with workspace edit --add-repo plugin-sdk"))
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
