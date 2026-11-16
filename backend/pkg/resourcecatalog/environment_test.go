package resourcecatalog

import (
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func TestCatalogClonesAndComparesDeclaredEnvironment(t *testing.T) {
	declared := resourcev2.ResourceType{Type: "t", Environment: &resourcev2.EnvironmentIdentity{Scheme: "s.v1", ID: "a"}}
	cloned := cloneResourceType(declared)
	if cloned.Environment == declared.Environment || *cloned.Environment != *declared.Environment {
		t.Fatal("the cached descriptor shares or loses the provider's environment")
	}
	cloned.Environment.ID = "changed"
	if declared.Environment.ID != "a" {
		t.Fatal("mutating the cached descriptor changed the provider's catalog")
	}
	if !sameTargetContract(declared, cloneResourceType(declared)) {
		t.Fatal("an equal environment changed the target contract")
	}
	other := cloneResourceType(declared)
	other.Environment.ID = "b"
	withdrawn := declared
	withdrawn.Environment = nil
	for name, changed := range map[string]resourcev2.ResourceType{"another target": other, "withdrawn": withdrawn} {
		if sameTargetContract(declared, changed) {
			t.Fatalf("%s kept the target contract", name)
		}
	}
}
