package version

import "testing"

func TestResolveCompatibilityVersion(t *testing.T) {
	for _, tc := range []struct {
		name        string
		build       string
		development bool
		want        string
	}{
		{"stable patch uses release version", "0.27.3", false, "0.27.3"},
		{"stable tag prefix is normalized", "v0.27.3", false, "0.27.3"},
		{"build metadata does not alter compatibility", "0.27.3+build.9", false, "0.27.3"},
		{"development label cannot inflate capabilities", "99.0.0", true, sourceCompatibilityVersion},
		{"nightly uses source baseline", "0.0.0-nightly.20261103", false, sourceCompatibilityVersion},
		{"release candidate uses source baseline", "0.28.0-rc1", false, sourceCompatibilityVersion},
		{"PR label uses source baseline", "pr-build-macos", false, sourceCompatibilityVersion},
		{"malformed semantic version uses source baseline", "0.27.invalid", false, sourceCompatibilityVersion},
		{"incomplete version is not a stable release", "0.27", false, sourceCompatibilityVersion},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveCompatibilityVersion(tc.build, tc.development); got != tc.want {
				t.Fatalf("build=%q development=%v: compatibility=%q, want %q", tc.build, tc.development, got, tc.want)
			}
		})
	}
}
