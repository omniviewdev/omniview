package version

var (
	Version     = "0.0.0-dev"
	GitCommit   = "unknown"
	BuildDate   = "unknown"
	Development = "true" // string; ldflags can only inject strings
)

func IsDevelopment() bool {
	return Development != "false"
}
