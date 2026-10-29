package transportjson

import (
	"encoding/json"
	"math"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/resource/v2"
	"google.golang.org/protobuf/proto"
)

func TestCanonicalUtilityRequestsRetainScalarKinds(t *testing.T) {
	body := &resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{
		"nested": {Kind: "list", List: []resourcev2.Value{
			{Kind: "uint64", Uint: "18446744073709551615"},
			{Kind: "double", Double: math.Copysign(0, -1)},
		}},
	}}
	reference := &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "test", Authority: "cluster", Type: "pods", ID: "pod", Scope: []resourcev2.ScopeEntry{}}}
	route := &resourcev2.AccessRoute{Connection: "connection"}
	assertBody := func(t *testing.T, value *resourcev2.Value) {
		t.Helper()
		if value == nil {
			t.Fatal("canonical body absent")
		}
		encoded, err := resourcev2.ToProtoValue(*value)
		if err != nil {
			t.Fatal(err)
		}
		wire, err := proto.Marshal(encoded)
		if err != nil {
			t.Fatal(err)
		}
		var received resourcepb.Value
		if err := proto.Unmarshal(wire, &received); err != nil {
			t.Fatal(err)
		}
		decoded, err := resourcev2.FromProtoValue(&received)
		if err != nil {
			t.Fatal(err)
		}
		values := decoded.Map["nested"].List
		if values[0].Kind != "uint64" || values[0].Uint != "18446744073709551615" || values[1].Kind != "double" || !math.Signbit(values[1].Double) {
			t.Fatalf("scalar intent changed: %#v", values)
		}
	}
	t.Run("logs", func(t *testing.T) {
		request := logs.CreateSessionOptions{ResourceKey: "pods", ResourceID: "pod", ResourceData: body, Reference: reference, Route: route}
		data, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		var decoded logs.CreateSessionOptions
		if err := Decode(string(data), &decoded, "test", "connection"); err != nil {
			t.Fatal(err)
		}
		assertBody(t, decoded.ResourceData)
		if decoded.Reference == nil || decoded.Reference.Address.ID != "pod" || decoded.Route == nil || decoded.Route.Connection != "connection" {
			t.Fatal("canonical routing missing")
		}
	})
	t.Run("metrics", func(t *testing.T) {
		request := metric.QueryRequest{ResourceKey: "pods", ResourceID: "pod", ResourceData: body, Reference: reference, Route: route}
		data, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		var decoded metric.QueryRequest
		if err := Decode(string(data), &decoded, "test", "connection"); err != nil {
			t.Fatal(err)
		}
		assertBody(t, decoded.ResourceData)
		if decoded.Reference == nil || decoded.Route == nil {
			t.Fatal("canonical routing missing")
		}
	})
	t.Run("networker", func(t *testing.T) {
		request := networker.PortForwardSessionOptions{ConnectionType: networker.PortForwardConnectionTypeResource, Protocol: networker.PortForwardProtocolTCP, RemotePort: 80, Connection: &networker.PortForwardResourceConnection{ResourceKey: "pods", ResourceID: "pod", PluginID: "test", ConnectionID: "connection", ResourceData: body, Reference: reference, Route: route}}
		data, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		var decoded networker.PortForwardSessionOptions
		if err := Decode(string(data), &decoded, "test", "connection"); err != nil {
			t.Fatal(err)
		}
		switch connection := decoded.Connection.(type) {
		case networker.PortForwardResourceConnection:
			assertBody(t, connection.ResourceData)
		case *networker.PortForwardResourceConnection:
			assertBody(t, connection.ResourceData)
		default:
			t.Fatalf("resource connection changed: %T", decoded.Connection)
		}
	})
}
