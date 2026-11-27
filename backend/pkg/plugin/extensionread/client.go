package extensionread

import (
	"context"
	json "encoding/json/v2"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/types/known/wrapperspb"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/resource/v2"
)

// Provider is the optional native owner operation, never a renderer API.
type Provider interface {
	ReadRelatedV1(context.Context, Request) (Page, error)
}

// SourceProvider supplies the fixed declaration before any data acquisition.
type SourceProvider interface {
	RelatedSourcesV1(context.Context, Request) ([]string, error)
}

type Request struct {
	Operation string                       `json:"operation"`
	Root      resourcev2.ResourceReference `json:"root"`
	Route     resourcev2.AccessRoute       `json:"route"`
	Sources   []resourcev2.ReadTarget      `json:"sources,omitzero"`
}

type Page struct {
	Sources  []string    `json:"sources"`
	Coverage string      `json:"coverage"`
	Rows     []Candidate `json:"rows"`
}

type Candidate struct {
	Row      map[string]any                 `json:"row"`
	Evidence []resourcev2.ResourceReference `json:"evidence"`
	Neighbor *resourcev2.ResourceReference  `json:"neighbor,omitempty"`
}

var (
	ErrUnavailable = errors.New("related read unavailable")
	errWire        = errors.New("invalid related read frame")
	errFailed      = errors.New("related read failed")
)

const (
	ownerService      = "/omniview.extension.v1.Owner/"
	readMethod        = ownerService + "ReadRelatedV1"
	sourcesMethod     = ownerService + "RelatedSourcesV1"
	requestBytes      = 16 << 10
	responseBytes     = 512 << 10
	maxGetReplyBytes  = 2 << 20
	readTimeout       = 5 * time.Second
	ownerMetadata     = "omniview-extension-owner-bin"
	connectionMeta    = "omniview-extension-connection-bin"
	requestMetadata   = "omniview-request-id-bin"
	requesterMetadata = "omniview-requester-id-bin"
	revisionMetadata  = "omniview-resource-catalog-revision-bin"
)

// Client promotes the complete published resource client. An old owner returns
// Unimplemented on the optional method without losing any resource operation.
type Client struct {
	*resourceplugin.Client
	conn grpc.ClientConnInterface
}

func NewClient(conn grpc.ClientConnInterface) *Client {
	return &Client{Client: resourceplugin.NewClient(getLimitConn{conn}), conn: conn}
}

type getLimitKey struct{}

// WithReplyLimit spends a caller-reserved wire byte limit on an exact resource
// Get. Ordinary Get calls, catalog discovery and other RPCs are unaffected.
func WithReplyLimit(ctx context.Context, maxBytes int) context.Context {
	if previous, ok := ctx.Value(getLimitKey{}).(int); ok {
		maxBytes = min(maxBytes, previous)
	}
	return context.WithValue(ctx, getLimitKey{}, min(maxBytes, maxGetReplyBytes))
}

type getLimitConn struct{ grpc.ClientConnInterface }

func (c getLimitConn) Invoke(ctx context.Context, method string, args, reply any, opts ...grpc.CallOption) error {
	if limit, ok := ctx.Value(getLimitKey{}).(int); ok && method == resourcepb.ResourceProvider_Call_FullMethodName {
		if req, isRequest := args.(*resourcepb.Request); isRequest && req.GetGet() != nil {
			if limit <= 0 {
				return status.Error(codes.ResourceExhausted, "No resource reply budget.")
			}
			opts = append(opts, grpc.MaxCallRecvMsgSize(limit)) // after the SDK-wide limit
		}
	}
	return c.ClientConnInterface.Invoke(ctx, method, args, reply, opts...)
}

func (c *Client) RelatedSourcesV1(ctx context.Context, in Request) ([]string, error) {
	return ownerCall(ctx, c, sourcesMethod, in, requestBytes, decodeSources)
}

func (c *Client) ReadRelatedV1(ctx context.Context, in Request) (Page, error) {
	return ownerCall(ctx, c, readMethod, in, responseBytes, decodePage)
}

func ownerCall[T any](ctx context.Context, c *Client, method string, in Request, limit int, decode func([]byte, Request) (T, error)) (T, error) {
	var zero T
	ctx, cancel := context.WithTimeout(ctx, readTimeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	if !validRequest(in, method == readMethod) {
		return zero, errWire
	}
	ctx, admission, err := ownerAdmission(ctx, in)
	if err != nil {
		return zero, err
	}
	payload, err := json.Marshal(in)
	if err != nil || !frameFits(len(payload), requestBytes) {
		return zero, errWire
	}
	out := new(wrapperspb.BytesValue)
	frame := resourceplugin.NewUtilityTransportEnvelope(out, func(b []byte) error { return validateFrame(b, limit) })
	err = c.conn.Invoke(ctx, method, wrapperspb.Bytes(payload), frame, grpc.PerRPCCredentials(admission), grpc.MaxCallSendMsgSize(requestBytes), grpc.MaxCallRecvMsgSize(limit))
	if canceled := ctx.Err(); canceled != nil {
		return zero, canceled
	}
	if _, _, ok := admittedSession(ctx, in); !ok {
		return zero, ErrUnavailable
	}
	if err != nil {
		return zero, ownerCallError(err)
	}
	if frame.AdmissionError() != nil || !frameFits(len(out.GetValue()), limit) {
		return zero, errWire
	}
	result, err := decode(out.GetValue(), in)
	if canceled := ctx.Err(); canceled != nil {
		return zero, canceled
	}
	if err != nil {
		return zero, errWire // never pass parser, provider or status text to callers
	}
	return result, nil
}

func ownerAdmission(ctx context.Context, in Request) (context.Context, ownerCredentials, error) {
	session, revision, ok := admittedSession(ctx, in)
	if !ok {
		return ctx, nil, ErrUnavailable
	}
	md, _ := metadata.FromOutgoingContext(ctx)
	for k := range md {
		if strings.HasPrefix(k, "omniview-") {
			return ctx, nil, ErrUnavailable // Never layer an admission over wire credentials.
		}
	}
	// Only diagnostics may survive a legacy plugin context. Never serialize a
	// profile or resource body through the SDK's ordinary unary interceptor.
	if pc := types.PluginContextFromContext(ctx); pc != nil {
		if pc.RequestID != session.RequestID || pc.RequesterID != session.RequesterID || pc.Connection != nil && pc.Connection.ID != in.Route.Connection {
			return ctx, nil, ErrUnavailable
		}
		var diagnostics types.PluginContext
		diagnostics.RequestID, diagnostics.RequesterID = session.RequestID, session.RequesterID
		ctx = types.WithPluginContext(ctx, &diagnostics)
	}
	return metadata.NewOutgoingContext(ctx, nil), ownerCredentials{
		ownerMetadata: session.PluginID, connectionMeta: in.Route.Connection,
		requestMetadata: session.RequestID, requesterMetadata: session.RequesterID, revisionMetadata: revision,
	}, nil
}

func ownerCallError(err error) error {
	switch status.Code(err) {
	case codes.PermissionDenied, codes.Unauthenticated, codes.Unimplemented, codes.NotFound, codes.FailedPrecondition, codes.Unavailable:
		return ErrUnavailable
	case codes.Canceled:
		return context.Canceled
	case codes.DeadlineExceeded:
		return context.DeadlineExceeded
	case codes.OK, codes.Unknown, codes.InvalidArgument, codes.AlreadyExists, codes.ResourceExhausted, codes.Aborted, codes.OutOfRange, codes.Internal, codes.DataLoss:
		// These and unknown status codes do not disclose provider text.
	}
	return errFailed
}

func admittedSession(ctx context.Context, in Request) (resourcev2.Session, string, bool) {
	s, ok := resourcev2.SessionFromContext(ctx)
	owner, _, _ := strings.Cut(in.Operation, "/")
	revision, pinned := resourcev2.CatalogRevisionForRouteFromContext(ctx, in.Root.Address.Provider, in.Route)
	return s, revision, ok && pinned && resourcev2.ValidateCatalogRevision(revision) == nil && s.PluginID == owner &&
		s.Connection != nil && s.Connection.ID == in.Route.Connection && s.RequestID != "" && s.RequesterID != "" &&
		len(s.RequestID) <= 256 && len(s.RequesterID) <= 256 && utf8.ValidString(s.RequestID) && utf8.ValidString(s.RequesterID)
}

func frameFits(n, limit int) bool { return n > 0 && n <= limit && 1+protowire.SizeBytes(n) <= limit }

func validateFrame(b []byte, limit int) error {
	if len(b) < 3 || len(b) > limit || b[0] != 0x0a {
		return errWire
	}
	v, n := protowire.ConsumeBytes(b[1:])
	if len(v) == 0 || n != len(b)-1 || n != protowire.SizeBytes(len(v)) {
		return errWire
	}
	return nil
}

// Do not send even private root metadata to an unverified peer. go-plugin's
// managed AutoMTLS channel verifies the installation-specific leaf at dial.
type ownerCredentials map[string]string

func (ownerCredentials) RequireTransportSecurity() bool { return true }

func (md ownerCredentials) GetRequestMetadata(ctx context.Context, _ ...string) (map[string]string, error) {
	info, ok := credentials.RequestInfoFromContext(ctx)
	tls, verified := info.AuthInfo.(credentials.TLSInfo)
	if !ok || !verified || len(tls.State.VerifiedChains) == 0 {
		return nil, status.Error(codes.Unauthenticated, "Related channel unavailable.")
	}
	return md, nil
}
