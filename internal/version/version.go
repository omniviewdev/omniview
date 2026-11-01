package version

// CompatibilityVersion is the minimum host compatibility release line supported
// by this source. Build labels (including nightly and PR versions) are separate.
const CompatibilityVersion = "0.14.0"

var (
	Version     = "0.0.0-dev"
	GitCommit   = "unknown"
	BuildDate   = "unknown"
	Development = "true" // string; ldflags can only inject strings
)

func IsDevelopment() bool {
	return Development != "false"
}
