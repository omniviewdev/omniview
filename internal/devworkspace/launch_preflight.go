package devworkspace

import (
	"context"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

// LaunchPreflight reports launch inputs without installing dependencies or starting processes.
// Readiness here does not replace source trust, composition or runtime checks at launch.
type LaunchPreflight struct {
	Ready            bool                   `json:"ready"`
	Issues           []*devcontract.Error   `json:"issues"`
	OwnershipChecked bool                   `json:"ownershipChecked"`
	Ownership        *devoutputs.Inspection `json:"ownership,omitempty"`
	// SDK reports the plugin SDK selection the manifest decides and each Go
	// consumer's declared requirement. Preflight resolves nothing: every consumer
	// is "unresolved" until a launch verifies its effective SDK.
	SDK *SDKStatus `json:"sdk,omitempty"`
}

// PreflightLaunch checks all independent launch prerequisites, retaining the normal gates.
// It reads checked-out module files only: no installs, no network, no writes, no process. In
// published mode it also reads the Go environment file, so a GOFLAGS refusal shows here.
// Issue order: evidence, declaration, Go environment, mode,
// MCP, plugin runtime. policy judges each consumer's declared published SDK version the way
// a launch would.
func PreflightLaunch(ctx context.Context, w Workspace, o LaunchOptions, policy devsdk.Policy) LaunchPreflight {
	return preflightLaunch(ctx, w.Manifest, o, worktreeModuleFiles(w), policy)
}

func preflightLaunch(ctx context.Context, manifest devcontract.WorkspaceManifest, o LaunchOptions, read moduleFileSource, policy devsdk.Policy) LaunchPreflight {
	report := LaunchPreflight{Issues: []*devcontract.Error{}}
	if o.LinkEvidence.Protocol == "" {
		report.Issues = append(report.Issues, devcontract.Fail(3, "link_evidence_required", "provide --link-evidence with the actual successful pinned protocol probe report"))
	} else if err := o.LinkEvidence.validate(); err != nil {
		report.Issues = append(report.Issues, err.(*devcontract.Error))
	}
	status, issues := inspectSDK(ctx, manifest, read, policy)
	report.SDK = &status
	report.Issues = append(report.Issues, issues...)
	if issue := inspectGoEnvironment(status); issue != nil {
		report.Issues = append(report.Issues, issue)
	}
	if o.Mode != "browser" && o.Mode != "native" {
		report.Issues = append(report.Issues, devcontract.Fail(2, "invalid_mode", "mode must be browser or native"))
	} else if status.Mode == devsdk.ModePublished && o.Mode == "native" {
		report.Issues = append(report.Issues, publishedNativeUnsupported())
	}
	if o.MCP && o.Mode != "native" {
		report.Issues = append(report.Issues, devcontract.Fail(2, "invalid_mcp_mode", "native MCP requires --mode native"))
	}
	if err := o.validatePluginRuntime(); err != nil {
		report.Issues = append(report.Issues, err.(*devcontract.Error))
	}
	report.Ready = len(report.Issues) == 0
	return report
}
