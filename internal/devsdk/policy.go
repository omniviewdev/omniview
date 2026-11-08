package devsdk

import (
	"fmt"

	"golang.org/x/mod/semver"
)

const (
	// FloorVersion is the lowest released plugin SDK a published build may use:
	// the SDK this controller is itself pinned to. A published SDK is any
	// released tag at or above it; older releases and pseudo-versions are not
	// supported and never converted. TestFloorMatchesTheControllerPin fails when
	// the controller's own pin moves, so raising the floor is always a deliberate
	// edit of this constant.
	FloorVersion = "v0.17.0"

	// Capability names the SDK's per-profile state-root isolation contract. A
	// published module must provide it, observed in its verified bytes.
	Capability = "state-root-v1"
)

// ReleasePolicy is the policy production uses: it admits a published identity
// exactly when its version is a released tag at or above FloorVersion. It is a
// constructor value, never read from the environment or a global.
func ReleasePolicy() Policy { return NewPolicy(admitRelease) }

func admitRelease(published Published) error {
	if semver.Prerelease(published.Version) != "" || semver.Build(published.Version) != "" {
		return fmt.Errorf("%s is not a released tag; pseudo-versions and prereleases are not supported", published.Version)
	}
	if semver.Compare(published.Version, FloorVersion) < 0 {
		return fmt.Errorf("%s is below the accepted floor %s; older releases are not supported", published.Version, FloorVersion)
	}
	return nil
}
