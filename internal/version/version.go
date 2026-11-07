package version

import (
	"strings"

	"golang.org/x/mod/semver"
)

// sourceCompatibilityVersion describes capabilities in development and nightly builds.
const sourceCompatibilityVersion = "0.31.0"

var (
	Version     = "0.0.0-dev"
	GitCommit   = "unknown"
	BuildDate   = "unknown"
	Development = "true" // string; ldflags can only inject strings

	compatibilityVersion = resolveCompatibilityVersion(Version, IsDevelopment())
)

func IsDevelopment() bool {
	return Development != "false"
}

// CompatibilityVersion returns the stable release version or the source baseline
// for development and prerelease builds. Linker-stamped identity is resolved once.
func CompatibilityVersion() string {
	return compatibilityVersion
}

func resolveCompatibilityVersion(build string, development bool) string {
	if !development {
		release := strings.TrimPrefix(build, "v")
		core, _, _ := strings.Cut(release, "+")
		semantic := "v" + release
		if strings.Count(core, ".") == 2 && semver.IsValid(semantic) && semver.Prerelease(semantic) == "" {
			return core
		}
	}
	return sourceCompatibilityVersion
}
