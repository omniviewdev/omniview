package devworkspace

import (
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcompose"
)

func TestLaunchPreflightRequiresActualProtocolProofAndReviewedSDK(t *testing.T) {
	w := generatedFixture(t)
	sdk := "plugin-sdk"
	w.Manifest.Links.SDKRepositoryID = &sdk
	o := LaunchOptions{
		Mode:                "browser",
		ReviewedSDKRevision: strings.Repeat("a", 40),
		LinkEvidence:        LinkProtocolEvidence{Protocol: "workspace", Versions: []string{devcompose.Version}, AtomicDist: true, Peers: true, Runtime: true},
	}
	if report := PreflightLaunch(w, o); !report.Ready || len(report.Issues) != 0 {
		t.Fatalf("valid inputs refused: %+v", report)
	}
	o.LinkEvidence.Peers = false
	o.ReviewedSDKRevision = "main"
	report := PreflightLaunch(w, o)
	if report.Ready || len(report.Issues) != 2 || report.Issues[0].Code != "link_protocol_unproved" || report.Issues[1].Code != "reviewed_sdk_required" {
		t.Fatalf("unproved evidence or symbolic review accepted: %+v", report)
	}
}
