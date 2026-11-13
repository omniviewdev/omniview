package releasechannel

import "testing"

func TestChannels(t *testing.T) {
	for _, tc := range []struct{ name string; valid, feature bool; label, display string }{
		{"stable", true, false, ".omniview", "Omniview"},
		{"nightly", true, false, ".omniview-nightly", "Omniview Nightly"},
		{"feature-abc", true, true, ".omniview-feature-abc", "Omniview (feature-abc)"},
		{"feature-x", false, false, "", ""},
		{"feature-Abc", false, false, "", ""},
		{"feature-abc-", false, false, "", ""},
	} {
		if Valid(tc.name) != tc.valid || IsFeature(tc.name) != tc.feature { t.Errorf("invalid classification for %q", tc.name) }
		if tc.valid && (StateLabel(tc.name) != tc.label || DisplayName(tc.name) != tc.display) { t.Errorf("invalid identity for %q", tc.name) }
	}
}

func TestVersions(t *testing.T) {
	for _, tc := range []struct{ channel, version string; valid bool }{
		{"stable", "1.2.3+ci.1", true}, {"stable", "1.2.3-rc.1", false},
		{"nightly", "0.0.0-nightly.20260101.1.2", true}, {"nightly", "1.0.0-nightly.20260101.1.2", false},
		{"feature-abc", "1.2.3-feature-abc.4.1", true}, {"feature-abc", "1.2.3-feature-def.4.1", false},
		{"feature-abc", "1.2.3-feature-abc.04.1", false}, {"feature-abc", "1.2.3-feature-abc.4.1+build", false},
		{"unknown", "1.2.3", false},
	} {
		if ValidVersion(tc.channel, tc.version) != tc.valid { t.Errorf("ValidVersion(%q, %q) != %v", tc.channel, tc.version, tc.valid) }
	}
}

func TestReservedByOther(t *testing.T) {
	for _, tc := range []struct{ label, own string; reserved bool }{
		{".OMNIVIEW", Stable, false}, {".Omniview-Nightly", Stable, true},
		{".OMNIVIEW-FEATURE-ABC", "feature-abc", false}, {".omniview-feature-def", "feature-abc", true},
		{".omniview", "feature-abc", true}, {".omniview-feature-", Stable, true}, {".omniview-other", Stable, false},
	} {
		if ReservedByOther(tc.label, tc.own) != tc.reserved { t.Errorf("ReservedByOther(%q, %q) != %v", tc.label, tc.own, tc.reserved) }
	}
}
