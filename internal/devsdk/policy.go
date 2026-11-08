package devsdk

import (
	"fmt"
	"slices"
	"strings"

	"golang.org/x/mod/semver"
)

const (
	// FloorVersion is the lowest released plugin SDK a published build may use:
	// the SDK this controller is itself pinned to. A published SDK is a released
	// tag at or above it; older releases and pseudo-versions are not supported and
	// never converted. TestFloorMatchesTheControllerPin fails when the
	// controller's own pin moves, so raising the floor is always a deliberate edit
	// of this constant.
	FloorVersion = "v0.18.0"

	// minimumFloor is the lowest value FloorVersion may ever take: the first
	// release with reviewed state-root isolation behavior. A drifting pin can
	// raise the floor, never lower it: TestFloorNeverDropsBelowTheReviewedMinimum
	// fails when FloorVersion falls below it, even if go.mod fell with it.
	minimumFloor = "v0.17.0"

	// Capability names the SDK's per-profile state-root isolation contract. A
	// published module must provide it, observed in its verified bytes.
	Capability = "state-root-v1"
)

// reviewedReleases is the append-only table of released plugin SDK tuples this
// controller anchors published builds to. A consumer's own go.sum is branch
// content: a branch could record any checksums for any version, and the module
// cache's bytes would then "verify" against them. A tuple the controller itself
// knows cannot self-attest: the checksums a branch records must equal these rows
// exactly, so the bytes that are hashed in place are the bytes that were reviewed.
//
// Rows are only ever appended, one per reviewed released tag. Older rows remain
// as review history when FloorVersion advances; admission still rejects them.
// A new tag is added with the pin bump that adopts it, or ahead of it.
// TestReviewedReleasesCoverTheControllerPin checks the pinned release's tuple.
//
// The table also subsumes retraction: a retracted release is simply never added,
// and a published build never needs `go list -retracted`, which would need the
// network. Verifying releases beyond this table against the Go checksum database
// (sumdb) is not implemented. It is how a future extension would verify a release
// the controller has not reviewed, with the caveat that GOPRIVATE and GONOSUMDB
// commonly bypass sumdb for github.com/omniviewdev/*, so it could not be the only
// anchor.
var reviewedReleases = []Published{
	{
		Module: Module, Version: "v0.17.0",
		ModuleSum: "h1:y+On5xnaevx96M744EQrwuMDdB37bjhdfhWMUpfU6xI=",
		GoModSum:  "h1:FFxi7m1H27zsC3VwMZ6Z9zVrwIytVTAkRjLT5cpv0G4=",
	},
	{
		Module: Module, Version: "v0.18.0",
		ModuleSum: "h1:DLcNbTghtD/Jc2knt+vBJAj+mJRTpuEgHx1lUOdqnso=",
		GoModSum:  "h1:7ZjIDHv7L0YEHsy3Ld2CHKGr/HHTNY4wUrzVyfYRR8E=",
	},
}

// ReviewedReleases returns a copy of the append-only table of reviewed releases.
func ReviewedReleases() []Published { return append([]Published(nil), reviewedReleases...) }

// ReleasePolicy is the policy production uses: it admits a published identity
// exactly when it is a released tag at or above FloorVersion whose module and
// go.mod checksums equal the reviewed row for that version. It is a constructor
// value, never read from the environment or a global.
//
// What an admitted, verified identity means is stated on the package: the bytes
// hash to checksums this controller reviewed, the module provides Capability,
// and the compiled binary names exactly that version and sum. It does not mean
// the SDK's behavior was reviewed for safety or sandboxing.
func ReleasePolicy() Policy { return NewReleasePolicy(FloorVersion, reviewedReleases...) }

// NewReleasePolicy is ReleasePolicy for a caller-supplied floor and table of
// reviewed releases. Production passes the compiled-in ones through
// ReleasePolicy; tests that serve synthetic releases name them here, through the
// same constructors that inject every other policy.
func NewReleasePolicy(floor string, reviewed ...Published) Policy {
	known := make(map[string]Published, len(reviewed))
	for _, release := range reviewed {
		known[release.Version] = release
	}
	return NewPolicy(func(published Published) error { return admitRelease(floor, known, published) })
}

// admitRelease states its cause alone: releaseUntrusted adds the next step.
func admitRelease(floor string, known map[string]Published, published Published) error {
	if semver.Prerelease(published.Version) != "" || semver.Build(published.Version) != "" {
		return fmt.Errorf("%s is not a released tag (pseudo-versions and prereleases are not supported)", published.Version)
	}
	if semver.Compare(published.Version, floor) < 0 {
		return fmt.Errorf("%s is below the accepted floor %s (older releases are not supported)", published.Version, floor)
	}
	reviewed, ok := known[published.Version]
	if !ok {
		versions := make([]string, 0, len(known))
		for version := range known {
			versions = append(versions, version)
		}
		slices.SortFunc(versions, semver.Compare)
		return fmt.Errorf("%s is not a release this controller has reviewed (reviewed: %s)", published.Version, strings.Join(versions, ", "))
	}
	if reviewed != published {
		return fmt.Errorf("%s records module checksums that differ from the reviewed release (a branch's go.sum cannot attest its own SDK)", published.Version)
	}
	return nil
}
