// Package releasechannel defines host release channel identities and versions.
package releasechannel

import (
	"regexp"
	"strings"

	"golang.org/x/mod/semver"
)

const (
	Stable  = "stable"
	Nightly = "nightly"
)

var featurePattern = regexp.MustCompile(`^feature-[a-z][a-z0-9-]{0,30}[a-z0-9]$`)
var nightlyVersion = regexp.MustCompile(`^0\.0\.0-nightly\.[0-9]{8}\.[0-9]+\.[0-9]+$`)
var versionCore = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`)
var versionSequence = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)$`)

func IsFeature(name string) bool { return featurePattern.MatchString(name) }
func Valid(name string) bool     { return name == Stable || name == Nightly || IsFeature(name) }

func ValidVersion(channel, v string) bool {
	if !Valid(channel) || !semver.IsValid("v"+v) || semver.Canonical("v"+v) != "v"+strings.TrimSuffix(v, semver.Build("v"+v)) {
		return false
	}
	switch channel {
	case Stable:
		return semver.Prerelease("v"+v) == ""
	case Nightly:
		return nightlyVersion.MatchString(v)
	default:
		core, suffix, ok := strings.Cut(v, "-")
		if !ok || !versionCore.MatchString(core) {
			return false
		}
		sequence, ok := strings.CutPrefix(suffix, channel+".")
		return ok && versionSequence.MatchString(sequence)
	}
}

func StateLabel(channel string) string {
	if channel == Stable {
		return ".omniview"
	}
	return ".omniview-" + channel
}

func DisplayName(channel string) string {
	switch channel {
	case Stable:
		return "Omniview"
	case Nightly:
		return "Omniview Nightly"
	default:
		return "Omniview (" + channel + ")"
	}
}

func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] += 'a' - 'A'
		}
	}
	return string(b)
}

func ReservedByOther(label, own string) bool {
	label = asciiLower(label)
	if label == asciiLower(StateLabel(own)) {
		return false
	}
	return label == ".omniview" || label == ".omniview-nightly" || strings.HasPrefix(label, ".omniview-feature-")
}
