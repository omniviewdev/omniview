package devworkspace

import (
	"testing"

	"github.com/omniviewdev/omniview/internal/devcompose"
)

func TestLaunchPreflightRequiresActualProtocolProof(t *testing.T) {
	t.Parallel()
	w := generatedFixture(t)
	sdk := "plugin-sdk"
	w.Manifest.Links.SDKRepositoryID = &sdk
	o := LaunchOptions{
		Mode: "browser",
		LinkEvidence: LinkProtocolEvidence{
			Protocol: "workspace", Versions: []string{devcompose.Version}, AtomicDist: true, Peers: true, Runtime: true,
		},
	}
	if report := PreflightLaunch(w, o); !report.Ready || len(report.Issues) != 0 {
		t.Fatalf("valid inputs refused: %+v", report)
	}
	o.LinkEvidence.Peers = false
	report := PreflightLaunch(w, o)
	if report.Ready || len(report.Issues) != 1 || report.Issues[0].Code != "link_protocol_unproved" {
		t.Fatalf("unproved evidence accepted: %+v", report)
	}
}
