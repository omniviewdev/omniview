package devcontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func standaloneRequestFixture() StandaloneRequest {
	return StandaloneRequest{ProtocolVersion: 2, RequestID: "dd936cab-e170-4400-a7d5-f5f2726b0177", Target: StandaloneTarget{Kind: "standalone", InstanceID: "standalone-" + strings.Repeat("a", 64), Checkout: "/owned/checkout", ClaimDigest: strings.Repeat("b", 64)}, Generation: "ea9185e0-84d1-44cc-a575-d3a4b6f52008", Operation: "instance.inspect"}
}

// SCN-DEV-023/025: the new private protocol cannot change public schema1 or
// weaken managed v1. Marker/identity records do not authenticate a caller.
func TestStandalonePrivateV2PreservesPublicV1(t *testing.T) {
	r := standaloneRequestFixture()
	boot, err := PublicStandaloneIdentity(r.Target, r.Generation, "Omniview development")
	if err != nil {
		t.Fatal(err)
	}
	if boot.SchemaVersion != 1 || boot.InstanceID != r.Target.InstanceID || boot.Generation != r.Generation || boot.Kind != "development" {
		t.Fatalf("wrong projection: %+v", boot)
	}
	raw, _ := json.Marshal(boot)
	for _, field := range []string{"claimDigest", "checkout", "token", "workspaceID"} {
		if strings.Contains(string(raw), field) {
			t.Fatalf("public identity leaks %s", field)
		}
	}
	if ProtocolVersion != 1 || SchemaVersion != 1 {
		t.Fatal("managed/public version changed")
	}
	managed := Request{ProtocolVersion: 1, RequestID: "existing-v1-request", WorkspaceID: r.Target.InstanceID, Generation: r.Generation, Operation: "session.stop"}
	if managed.ValidateTarget("", r.Generation) == nil {
		t.Fatal("standalone substituted for managed identity")
	}
}

func TestStandaloneV2RejectsMixedAndMalformedEnvelopes(t *testing.T) {
	r := standaloneRequestFixture()
	raw, _ := json.Marshal(r)
	cases := map[string]string{
		"managed field":    strings.TrimSuffix(string(raw), "}") + `,"workspaceID":"ea9185e0-84d1-44cc-a575-d3a4b6f52008"}`,
		"duplicate":        strings.TrimSuffix(string(raw), "}") + `,"operation":"session.stop"}`,
		"case alias":       strings.TrimSuffix(string(raw), "}") + `,"Operation":"session.stop"}`,
		"trailing":         string(raw) + ` {}`,
		"unknown":          strings.Replace(string(raw), `"protocolVersion":2`, `"protocolVersion":3`, 1),
		"managed v1":       strings.Replace(string(raw), `"protocolVersion":2`, `"protocolVersion":1`, 1),
		"managed target":   strings.Replace(string(raw), `"kind":"standalone"`, `"kind":"managed"`, 1),
		"uuid instance":    strings.Replace(string(raw), r.Target.InstanceID, r.Generation, 1),
		"missing claim":    strings.Replace(string(raw), r.Target.ClaimDigest, "", 1),
		"path alias":       strings.Replace(string(raw), `/owned/checkout`, `/owned/../checkout`, 1),
		"nested duplicate": strings.Replace(string(raw), `"kind":"standalone"`, `"kind":"standalone","kind":"standalone"`, 1),
		"oversize":         strings.Repeat(" ", 1<<20) + string(raw),
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeStandaloneRequest(strings.NewReader(input)); err == nil {
				t.Fatal("accepted invalid envelope")
			}
		})
	}
	decoded, err := DecodeStandaloneRequest(strings.NewReader(string(raw)))
	if err != nil || decoded != r {
		t.Fatalf("valid roundtrip: %+v %v", decoded, err)
	}
}

func TestStandaloneV2ChecksTargetGenerationAndOperationBeforeEffects(t *testing.T) {
	base := standaloneRequestFixture()
	cases := map[string]func(*StandaloneRequest){
		"wrong checkout":     func(r *StandaloneRequest) { r.Target.Checkout = "/another/checkout" },
		"wrong claim":        func(r *StandaloneRequest) { r.Target.ClaimDigest = strings.Repeat("c", 64) },
		"wrong generation":   func(r *StandaloneRequest) { r.Generation = r.RequestID },
		"managed mutation":   func(r *StandaloneRequest) { r.Operation = "plugin.install-version" },
		"settings mutation":  func(r *StandaloneRequest) { r.Operation = "settings.set" },
		"unknown":            func(r *StandaloneRequest) { r.Operation = "exec" },
		"missing generation": func(r *StandaloneRequest) { r.Generation = "" },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			r := base
			change(&r)
			if r.ValidateTarget(base.Target, base.Generation, true) == nil {
				t.Fatal("accepted wrong request")
			}
		})
	}
	stop := base
	stop.Operation = "session.stop"
	if stop.ValidateTarget(base.Target, base.Generation, false) == nil {
		t.Fatal("host accepted supervisor stop")
	}
	if err := stop.ValidateTarget(base.Target, base.Generation, true); err != nil {
		t.Fatal(err)
	}
}
