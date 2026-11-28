package extensionread

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	json "encoding/json/v2"
	"errors"
	"math/big"
	"net"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/types/known/wrapperspb"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

func wireRequest() Request {
	uid := "root-uid"
	route := resourcev2.AccessRoute{Connection: "selected"}
	ns := []string{"blue"}
	return Request{Operation: "owner/edges@1", Route: route,
		Root: resourcev2.ResourceReference{Incarnation: &uid, Address: resourcev2.ResourceAddress{
			Provider: "canonical", Authority: "root-authority", Type: "root/type", ID: "root", Scope: []resourcev2.ScopeEntry{{Dimension: "space", Value: "blue"}},
		}}, Sources: []resourcev2.ReadTarget{{Provider: "canonical", Authority: "edge-authority", Type: "edge/type", Representation: "doc", Route: route,
			Scope: resourcev2.QueryScope{{Dimension: "space", Match: resourcev2.ScopeOneOf, Values: &ns}, {Dimension: "name", Match: resourcev2.ScopeAny}}}},
	}
}

func wireContext(ctx context.Context, in Request) context.Context {
	return resourcev2.WithCatalogRevision(resourcev2.WithSession(ctx, resourcev2.Session{PluginID: "owner", Connection: &types.Connection{ID: in.Route.Connection},
		RequestID: "request", RequesterID: "78a70d51-92ab-4aeb-a231-d30ef7b7347b"}), "catalog-1")
}

const edgeRef = `{"address":{"provider":"canonical","authority":"edge-authority","type":"edge/type","scope":[{"dimension":"space","value":"blue"}],"id":"other"},"incarnation":"edge-uid"}`
const edgeRow = `{"row":{"name":"visible","weight":-2.5},"evidence":[` + edgeRef + `],"neighbor":` + edgeRef + `}`
const edgePrefix = `{"sources":["edge/type"],"coverage":"complete","rows":[`
const wirePage = edgePrefix + edgeRow + `]}`

func ownerTestTLS(t *testing.T) credentials.TransportCredentials {
	t.Helper()
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), IsCA: true, BasicConstraintsValid: true,
		DNSNames: []string{"owner"}, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, template, template, pub, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(cert)
	return credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS13, ServerName: "owner", RootCAs: roots,
		ClientCAs: roots, ClientAuth: tls.RequireAndVerifyClientCert, Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}})
}

func loopback(t *testing.T, server *grpc.Server, creds credentials.TransportCredentials) *Client {
	t.Helper()
	listener := bufconn.Listen(64 << 10)
	go func() { _ = server.Serve(listener) }()
	conn, err := grpc.NewClient("passthrough:///owner", grpc.WithTransportCredentials(creds),
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(); server.Stop(); _ = listener.Close() })
	return NewClient(conn)
}

func serveOwnerRead(stream grpc.ServerStream) error {
	ctx := stream.Context()
	md, _ := metadata.FromIncomingContext(ctx)
	for k, want := range map[string]string{"omniview-extension-owner-bin": "owner", "omniview-extension-connection-bin": "selected",
		"omniview-request-id-bin": "request", "omniview-requester-id-bin": "78a70d51-92ab-4aeb-a231-d30ef7b7347b", "omniview-resource-catalog-revision-bin": "catalog-1"} {
		if !slices.Equal(md.Get(k), []string{want}) {
			return status.Error(codes.PermissionDenied, "wrong metadata")
		}
	}
	if end, ok := ctx.Deadline(); !ok || time.Until(end) > 5*time.Second+50*time.Millisecond {
		return status.Error(codes.DeadlineExceeded, "missing deadline")
	}
	var frame wrapperspb.BytesValue
	if err := stream.RecvMsg(&frame); err != nil {
		return err
	}
	var fields map[string]any
	if err := json.Unmarshal(frame.GetValue(), &fields); err != nil || fields["operation"] != "owner/edges@1" || fields["root"] == nil || fields["route"] == nil {
		return status.Error(codes.InvalidArgument, "wrong request")
	}
	method, _ := grpc.MethodFromServerStream(stream)
	switch method {
	case "/omniview.extension.v1.Owner/RelatedSourcesV1":
		if len(fields) == 3 {
			return stream.SendMsg(wrapperspb.Bytes([]byte(`{"sources":["edge/type"]}`)))
		}
	case "/omniview.extension.v1.Owner/ReadRelatedV1":
		if len(fields) == 4 && fields["sources"] != nil {
			return stream.SendMsg(wrapperspb.Bytes([]byte(wirePage)))
		}
	}
	return status.Error(codes.Unimplemented, "wrong method")
}

func TestOwnerReadNativeTransport(t *testing.T) {
	var calls atomic.Int32
	creds := ownerTestTLS(t)
	c := loopback(t, grpc.NewServer(grpc.Creds(creds), grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		calls.Add(1)
		return serveOwnerRead(stream)
	})), creds)
	in := wireRequest()
	ctx := wireContext(t.Context(), in)
	discovery := in
	discovery.Sources = nil
	ids, err := c.RelatedSourcesV1(ctx, discovery)
	if err != nil || !slices.Equal(ids, []string{"edge/type"}) {
		t.Fatalf("source declaration = %v, %v", ids, err)
	}
	p, err := c.ReadRelatedV1(ctx, in)
	if err != nil || len(p.Rows) != 1 || p.Rows[0].Row["weight"] != float64(-2.5) || p.Rows[0].Neighbor.Address.Authority != "edge-authority" {
		t.Fatalf("related page = %+v, %v", p, err)
	}
	for _, bad := range []context.Context{t.Context(), resourcev2.WithCatalogRevision(ctx, ""),
		resourcev2.WithSession(ctx, resourcev2.Session{PluginID: "other"}), metadata.AppendToOutgoingContext(ctx, ownerMetadata, "owner")} {
		if _, err = c.ReadRelatedV1(bad, in); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("unbound session: %v", err)
		}
	}
	stale := in
	stale.Route.Connection = "other"
	if _, err = c.ReadRelatedV1(ctx, stale); err == nil {
		t.Fatal("replayed source target on another connection")
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = c.ReadRelatedV1(canceled, in); !errors.Is(err, context.Canceled) || calls.Load() != 2 {
		t.Fatalf("rejected admission dispatched: calls=%d err=%v", calls.Load(), err)
	}
}

// The unmodified v0.23.0 server has no owner service. The host adds the new
// trait without losing negotiated catalog discovery or a single ordinary Get.
type ordinaryOwner struct{}

func (ordinaryOwner) Catalog(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
	return resourcev2.Catalog{Provider: "canonical", Revision: "catalog-1", Coverage: resourcev2.Coverage{Kind: "complete", Paths: []string{}}, Types: []resourcev2.ResourceType{{
		Type: "root/type", Representations: []resourcev2.Representation{{ID: "doc", Revision: "1"}},
		IdentityDimensions: []resourcev2.Dimension{{Name: "space"}}, QueryDimensions: []resourcev2.Dimension{{Name: "space"}},
		Capabilities: []resourcev2.Capability{{Operation: resourcev2.OperationGet, Scope: resourcev2.QueryScope{{Dimension: "space", Match: resourcev2.ScopeAny}}}},
	}}}, nil
}

func (ordinaryOwner) Get(_ context.Context, in resourcev2.GetRequest) (resourcev2.Record, error) {
	return resourcev2.Record{Reference: in.Reference, Representation: resourcev2.Representation{ID: "doc", Revision: "1"},
		Body:     resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"payload": {Kind: "string", String: strings.Repeat("s", 2048)}}},
		Coverage: resourcev2.Coverage{Kind: "complete", Paths: []string{}}}, nil
}

func TestOldOwnerAndReservedGetReply(t *testing.T) {
	creds := ownerTestTLS(t)
	s := grpc.NewServer(append(resourceplugin.ServerOptions(), grpc.Creds(creds))...)
	resourceplugin.RegisterServer(s, ordinaryOwner{})
	c := loopback(t, s, creds)
	in := wireRequest()
	ctx := wireContext(t.Context(), in)
	if _, err := c.ReadRelatedV1(ctx, in); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("old owner: %v", err)
	}
	in.Sources = nil
	if _, err := c.RelatedSourcesV1(ctx, in); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("old owner declaration: %v", err)
	}
	catalog, err := c.Catalog(WithReplyLimit(t.Context(), 1), resourcev2.CatalogRequest{Route: in.Route})
	if err != nil || catalog.Provider != "canonical" {
		t.Fatalf("ordinary catalog affected by Get limit: %v", err)
	}
	ctx = resourcev2.WithCatalogRevision(ctx, catalog.Revision)
	get := resourcev2.GetRequest{Route: in.Route, Reference: in.Root, Representation: "doc"}
	if _, err = c.Get(WithReplyLimit(WithReplyLimit(ctx, 64), 4096), get); err == nil {
		t.Fatal("Get received a reply larger than the reserved budget")
	}
	if got, getErr := c.Get(ctx, get); getErr != nil || len(got.Body.Map["payload"].String) != 2048 {
		t.Fatalf("ordinary Get lost: %v", getErr)
	}
}

func TestUntrustedOwnerReplyAndSafeErrors(t *testing.T) {
	for _, tc := range []struct {
		name string
		fail error
		out  *wrapperspb.BytesValue
		want error
	}{
		{"denied", status.Error(codes.PermissionDenied, "private-provider-text"), nil, ErrUnavailable},
		{"failed", status.Error(codes.Internal, "private-provider-text"), nil, errFailed},
		{"oversize", nil, wrapperspb.Bytes(make([]byte, 512<<10)), errFailed},
		{"missing coverage", nil, wrapperspb.Bytes([]byte(`{"sources":["edge/type"],"rows":[]}`)), errWire},
		{"duplicate protobuf field", nil, func() *wrapperspb.BytesValue {
			v := wrapperspb.Bytes([]byte(wirePage))
			v.ProtoReflect().SetUnknown(protowire.AppendBytes([]byte{0x0a}, []byte(wirePage)))
			return v
		}(), errWire},
	} {
		t.Run(tc.name, func(t *testing.T) {
			creds := ownerTestTLS(t)
			c := loopback(t, grpc.NewServer(grpc.Creds(creds), grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
				if err := stream.RecvMsg(new(wrapperspb.BytesValue)); err != nil {
					return err
				}
				if tc.fail != nil {
					return tc.fail
				}
				return stream.SendMsg(tc.out)
			})), creds)
			in := wireRequest()
			p, err := c.ReadRelatedV1(wireContext(t.Context(), in), in)
			if !errors.Is(err, tc.want) || len(p.Rows) != 0 || strings.Contains(err.Error(), "private-provider-text") {
				t.Fatalf("page=%+v err=%v", p, err)
			}
		})
	}
}

func TestRelatedDecoderRejectsAmbiguousOrUnboundedFacts(t *testing.T) {
	in := wireRequest()
	for _, edit := range [][2]string{
		{`"rows":`, `"truncated":true,"rows":`}, {`"rows":`, `"Rows":`}, {`"sources":`, `"unknown":[],"sources":`},
		{`["edge/type"]`, `["edge/type","edge/type"]`}, {`"edge/type"`, `"unadmitted/type"`}, {`"complete"`, `null`},
		{`"weight":-2.5`, `"weight":0,"\u0077eight":-2.5`}, {`-2.5`, `true`}, {`-2.5`, `null`}, {`-2.5`, `1e9999`},
		{`-2.5`, `{"nested":"data"}`}, {`-2.5`, `[]`}, {`"name"`, `"__proto__"`}, {`"visible"`, `"\ud800"`},
		{`"visible"`, `"` + strings.Repeat("𐐷", 2049) + `"`}, {`"incarnation":"edge-uid"`, `"incarnation":null`},
		{`"space","value":"blue"`, `"space","value":"red"`}, {`"authority":"edge-authority"`, `"authority":"root-authority"`},
		{`"neighbor":` + edgeRef, `"neighbor":null`}, {`"evidence":[` + edgeRef + `]`, `"evidence":[]`},
		{`"evidence":[` + edgeRef + `]`, `"evidence":[` + strings.Repeat(edgeRef+`,`, 4) + edgeRef + `]`},
	} {
		bad := strings.Replace(wirePage, edit[0], edit[1], 1)
		if bad == wirePage {
			t.Fatalf("test did not alter %q", edit[0])
		}
		if _, err := decodePage([]byte(bad), in); err == nil {
			t.Errorf("accepted invalid replacement for %q", edit[0])
		}
	}
	if _, err := decodePage(append([]byte(wirePage), []byte(`{}`)...), in); err == nil {
		t.Fatal("trailing JSON accepted")
	}
	for count := 128; count <= 130; count++ {
		body := edgePrefix + strings.Repeat(edgeRow+",", count-1) + edgeRow + `]}`
		p, err := decodePage([]byte(body), in)
		if (err == nil) != (count <= 129) || err == nil && len(p.Rows) != count {
			t.Fatalf("%d candidates: %v", count, err)
		}
	}
	for _, fields := range []int{64, 65} {
		var row bytes.Buffer
		for i := range fields {
			if i != 0 {
				row.WriteByte(',')
			}
			row.WriteString(`"v` + strconv.Itoa(i) + `":0`)
		}
		data := strings.Replace(wirePage, `"name":"visible","weight":-2.5`, row.String(), 1)
		if _, err := decodePage([]byte(data), in); (err == nil) != (fields == 64) {
			t.Fatalf("%d fields: %v", fields, err)
		}
	}
}

func TestOwnerCredentialsNeverReachPlaintext(t *testing.T) {
	var calls atomic.Int32
	server := grpc.NewServer(grpc.UnknownServiceHandler(func(any, grpc.ServerStream) error {
		calls.Add(1)
		return status.Error(codes.Unimplemented, "unexpected plaintext invocation")
	}))
	client := loopback(t, server, insecure.NewCredentials())
	in := wireRequest()
	if _, err := client.ReadRelatedV1(wireContext(t.Context(), in), in); !errors.Is(err, ErrUnavailable) || calls.Load() != 0 {
		t.Fatalf("insecure channel admitted: %v, calls=%d", err, calls.Load())
	}
}
