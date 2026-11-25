package resourcecatalog

import (
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func environmentFingerprint(scheme, id string, exclusive bool) resourcev2.EnvironmentIdentity {
	return resourcev2.EnvironmentIdentity{Scheme: scheme, ID: id, Strength: resourcev2.EnvironmentStrong, Exclusive: exclusive}
}

func TestCatalogClonesAndComparesDeclaredEnvironment(t *testing.T) {
	admin := []resourcev2.EnvironmentIdentity{
		environmentFingerprint("fixture.cluster-uid.v1", "uid-A", true),
		environmentFingerprint("fixture.root-ca.v1", "ca-1", false),
	}
	declared := resourcev2.ResourceType{Type: "t", Environment: admin}
	cloned := cloneResourceType(declared)
	if len(cloned.Environment) != 2 || cloned.Environment[0] != admin[0] {
		t.Fatal("the cached descriptor loses the provider's environment")
	}
	cloned.Environment[0].ID = "changed"
	if declared.Environment[0].ID != "uid-A" {
		t.Fatal("mutating the cached descriptor changed the provider's catalog")
	}
	if cloneResourceType(resourcev2.ResourceType{Type: "t"}).Environment != nil {
		t.Fatal("an undeclared environment became a declared one")
	}

	// A declaration that gains or loses fingerprints while it keeps one in common
	// is the same target. One that moves to another environment is another target.
	with := func(environment ...resourcev2.EnvironmentIdentity) resourcev2.ResourceType {
		return resourcev2.ResourceType{Type: "t", Environment: environment}
	}
	for name, tc := range map[string]struct {
		changed resourcev2.ResourceType
		same    bool
	}{
		"unchanged":                   {with(admin...), true},
		"a viewer reads only the CA":  {with(admin[1]), true},
		"another cluster":             {with(environmentFingerprint("fixture.cluster-uid.v1", "uid-B", true), environmentFingerprint("fixture.root-ca.v1", "ca-2", false)), false},
		"shared CA, another UID":      {with(environmentFingerprint("fixture.cluster-uid.v1", "uid-B", true), admin[1]), false},
		"every fingerprint withdrawn": {with(), false},
	} {
		if got := sameTargetContract(declared, tc.changed); got != tc.same {
			t.Errorf("%s: sameTargetContract = %v, want %v", name, got, tc.same)
		}
	}
}
