// Code generated by protoc-gen-go-grpc. DO NOT EDIT.
// versions:
// - protoc-gen-go-grpc v1.3.0
// - protoc             (unknown)
// source: proto/exec.proto

package proto

import (
	context "context"
	grpc "google.golang.org/grpc"
	codes "google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
	emptypb "google.golang.org/protobuf/types/known/emptypb"
)

// This is a compile-time assertion to ensure that this generated file
// is compatible with the grpc package it is being compiled against.
// Requires gRPC-Go v1.32.0 or later.
const _ = grpc.SupportPackageIsVersion7

const (
	ExecPlugin_GetSupportedResources_FullMethodName = "/com.omniview.pluginsdk.ExecPlugin/GetSupportedResources"
	ExecPlugin_GetSession_FullMethodName            = "/com.omniview.pluginsdk.ExecPlugin/GetSession"
	ExecPlugin_ListSessions_FullMethodName          = "/com.omniview.pluginsdk.ExecPlugin/ListSessions"
	ExecPlugin_CreateSession_FullMethodName         = "/com.omniview.pluginsdk.ExecPlugin/CreateSession"
	ExecPlugin_AttachSession_FullMethodName         = "/com.omniview.pluginsdk.ExecPlugin/AttachSession"
	ExecPlugin_DetachSession_FullMethodName         = "/com.omniview.pluginsdk.ExecPlugin/DetachSession"
	ExecPlugin_CloseSession_FullMethodName          = "/com.omniview.pluginsdk.ExecPlugin/CloseSession"
	ExecPlugin_ResizeSession_FullMethodName         = "/com.omniview.pluginsdk.ExecPlugin/ResizeSession"
	ExecPlugin_Stream_FullMethodName                = "/com.omniview.pluginsdk.ExecPlugin/Stream"
)

// ExecPluginClient is the client API for ExecPlugin service.
//
// For semantics around ctx use and closing/ending streaming RPCs, please refer to https://pkg.go.dev/google.golang.org/grpc/?tab=doc#ClientConn.NewStream.
type ExecPluginClient interface {
	GetSupportedResources(ctx context.Context, in *emptypb.Empty, opts ...grpc.CallOption) (*GetSupportedResourcesResponse, error)
	GetSession(ctx context.Context, in *GetSessionRequest, opts ...grpc.CallOption) (*GetSessionResponse, error)
	ListSessions(ctx context.Context, in *emptypb.Empty, opts ...grpc.CallOption) (*ListSessionsResponse, error)
	CreateSession(ctx context.Context, in *SessionOptions, opts ...grpc.CallOption) (*CreateSessionResponse, error)
	AttachSession(ctx context.Context, in *AttachSessionRequest, opts ...grpc.CallOption) (*AttachSessionResponse, error)
	DetachSession(ctx context.Context, in *AttachSessionRequest, opts ...grpc.CallOption) (*AttachSessionResponse, error)
	CloseSession(ctx context.Context, in *CloseSessionRequest, opts ...grpc.CallOption) (*CloseSessionResponse, error)
	ResizeSession(ctx context.Context, in *ResizeSessionRequest, opts ...grpc.CallOption) (*ResizeSessionResponse, error)
	// Multiplexed stream for input and output
	Stream(ctx context.Context, opts ...grpc.CallOption) (ExecPlugin_StreamClient, error)
}

type execPluginClient struct {
	cc grpc.ClientConnInterface
}

func NewExecPluginClient(cc grpc.ClientConnInterface) ExecPluginClient {
	return &execPluginClient{cc}
}

func (c *execPluginClient) GetSupportedResources(ctx context.Context, in *emptypb.Empty, opts ...grpc.CallOption) (*GetSupportedResourcesResponse, error) {
	out := new(GetSupportedResourcesResponse)
	err := c.cc.Invoke(ctx, ExecPlugin_GetSupportedResources_FullMethodName, in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *execPluginClient) GetSession(ctx context.Context, in *GetSessionRequest, opts ...grpc.CallOption) (*GetSessionResponse, error) {
	out := new(GetSessionResponse)
	err := c.cc.Invoke(ctx, ExecPlugin_GetSession_FullMethodName, in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *execPluginClient) ListSessions(ctx context.Context, in *emptypb.Empty, opts ...grpc.CallOption) (*ListSessionsResponse, error) {
	out := new(ListSessionsResponse)
	err := c.cc.Invoke(ctx, ExecPlugin_ListSessions_FullMethodName, in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *execPluginClient) CreateSession(ctx context.Context, in *SessionOptions, opts ...grpc.CallOption) (*CreateSessionResponse, error) {
	out := new(CreateSessionResponse)
	err := c.cc.Invoke(ctx, ExecPlugin_CreateSession_FullMethodName, in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *execPluginClient) AttachSession(ctx context.Context, in *AttachSessionRequest, opts ...grpc.CallOption) (*AttachSessionResponse, error) {
	out := new(AttachSessionResponse)
	err := c.cc.Invoke(ctx, ExecPlugin_AttachSession_FullMethodName, in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *execPluginClient) DetachSession(ctx context.Context, in *AttachSessionRequest, opts ...grpc.CallOption) (*AttachSessionResponse, error) {
	out := new(AttachSessionResponse)
	err := c.cc.Invoke(ctx, ExecPlugin_DetachSession_FullMethodName, in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *execPluginClient) CloseSession(ctx context.Context, in *CloseSessionRequest, opts ...grpc.CallOption) (*CloseSessionResponse, error) {
	out := new(CloseSessionResponse)
	err := c.cc.Invoke(ctx, ExecPlugin_CloseSession_FullMethodName, in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *execPluginClient) ResizeSession(ctx context.Context, in *ResizeSessionRequest, opts ...grpc.CallOption) (*ResizeSessionResponse, error) {
	out := new(ResizeSessionResponse)
	err := c.cc.Invoke(ctx, ExecPlugin_ResizeSession_FullMethodName, in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *execPluginClient) Stream(ctx context.Context, opts ...grpc.CallOption) (ExecPlugin_StreamClient, error) {
	stream, err := c.cc.NewStream(ctx, &ExecPlugin_ServiceDesc.Streams[0], ExecPlugin_Stream_FullMethodName, opts...)
	if err != nil {
		return nil, err
	}
	x := &execPluginStreamClient{stream}
	return x, nil
}

type ExecPlugin_StreamClient interface {
	Send(*StreamInput) error
	Recv() (*StreamOutput, error)
	grpc.ClientStream
}

type execPluginStreamClient struct {
	grpc.ClientStream
}

func (x *execPluginStreamClient) Send(m *StreamInput) error {
	return x.ClientStream.SendMsg(m)
}

func (x *execPluginStreamClient) Recv() (*StreamOutput, error) {
	m := new(StreamOutput)
	if err := x.ClientStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}

// ExecPluginServer is the server API for ExecPlugin service.
// All implementations should embed UnimplementedExecPluginServer
// for forward compatibility
type ExecPluginServer interface {
	GetSupportedResources(context.Context, *emptypb.Empty) (*GetSupportedResourcesResponse, error)
	GetSession(context.Context, *GetSessionRequest) (*GetSessionResponse, error)
	ListSessions(context.Context, *emptypb.Empty) (*ListSessionsResponse, error)
	CreateSession(context.Context, *SessionOptions) (*CreateSessionResponse, error)
	AttachSession(context.Context, *AttachSessionRequest) (*AttachSessionResponse, error)
	DetachSession(context.Context, *AttachSessionRequest) (*AttachSessionResponse, error)
	CloseSession(context.Context, *CloseSessionRequest) (*CloseSessionResponse, error)
	ResizeSession(context.Context, *ResizeSessionRequest) (*ResizeSessionResponse, error)
	// Multiplexed stream for input and output
	Stream(ExecPlugin_StreamServer) error
}

// UnimplementedExecPluginServer should be embedded to have forward compatible implementations.
type UnimplementedExecPluginServer struct {
}

func (UnimplementedExecPluginServer) GetSupportedResources(context.Context, *emptypb.Empty) (*GetSupportedResourcesResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method GetSupportedResources not implemented")
}
func (UnimplementedExecPluginServer) GetSession(context.Context, *GetSessionRequest) (*GetSessionResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method GetSession not implemented")
}
func (UnimplementedExecPluginServer) ListSessions(context.Context, *emptypb.Empty) (*ListSessionsResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method ListSessions not implemented")
}
func (UnimplementedExecPluginServer) CreateSession(context.Context, *SessionOptions) (*CreateSessionResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method CreateSession not implemented")
}
func (UnimplementedExecPluginServer) AttachSession(context.Context, *AttachSessionRequest) (*AttachSessionResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method AttachSession not implemented")
}
func (UnimplementedExecPluginServer) DetachSession(context.Context, *AttachSessionRequest) (*AttachSessionResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method DetachSession not implemented")
}
func (UnimplementedExecPluginServer) CloseSession(context.Context, *CloseSessionRequest) (*CloseSessionResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method CloseSession not implemented")
}
func (UnimplementedExecPluginServer) ResizeSession(context.Context, *ResizeSessionRequest) (*ResizeSessionResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method ResizeSession not implemented")
}
func (UnimplementedExecPluginServer) Stream(ExecPlugin_StreamServer) error {
	return status.Errorf(codes.Unimplemented, "method Stream not implemented")
}

// UnsafeExecPluginServer may be embedded to opt out of forward compatibility for this service.
// Use of this interface is not recommended, as added methods to ExecPluginServer will
// result in compilation errors.
type UnsafeExecPluginServer interface {
	mustEmbedUnimplementedExecPluginServer()
}

func RegisterExecPluginServer(s grpc.ServiceRegistrar, srv ExecPluginServer) {
	s.RegisterService(&ExecPlugin_ServiceDesc, srv)
}

func _ExecPlugin_GetSupportedResources_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(emptypb.Empty)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(ExecPluginServer).GetSupportedResources(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: ExecPlugin_GetSupportedResources_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(ExecPluginServer).GetSupportedResources(ctx, req.(*emptypb.Empty))
	}
	return interceptor(ctx, in, info, handler)
}

func _ExecPlugin_GetSession_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetSessionRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(ExecPluginServer).GetSession(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: ExecPlugin_GetSession_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(ExecPluginServer).GetSession(ctx, req.(*GetSessionRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _ExecPlugin_ListSessions_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(emptypb.Empty)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(ExecPluginServer).ListSessions(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: ExecPlugin_ListSessions_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(ExecPluginServer).ListSessions(ctx, req.(*emptypb.Empty))
	}
	return interceptor(ctx, in, info, handler)
}

func _ExecPlugin_CreateSession_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(SessionOptions)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(ExecPluginServer).CreateSession(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: ExecPlugin_CreateSession_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(ExecPluginServer).CreateSession(ctx, req.(*SessionOptions))
	}
	return interceptor(ctx, in, info, handler)
}

func _ExecPlugin_AttachSession_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(AttachSessionRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(ExecPluginServer).AttachSession(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: ExecPlugin_AttachSession_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(ExecPluginServer).AttachSession(ctx, req.(*AttachSessionRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _ExecPlugin_DetachSession_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(AttachSessionRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(ExecPluginServer).DetachSession(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: ExecPlugin_DetachSession_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(ExecPluginServer).DetachSession(ctx, req.(*AttachSessionRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _ExecPlugin_CloseSession_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(CloseSessionRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(ExecPluginServer).CloseSession(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: ExecPlugin_CloseSession_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(ExecPluginServer).CloseSession(ctx, req.(*CloseSessionRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _ExecPlugin_ResizeSession_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ResizeSessionRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(ExecPluginServer).ResizeSession(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: ExecPlugin_ResizeSession_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(ExecPluginServer).ResizeSession(ctx, req.(*ResizeSessionRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _ExecPlugin_Stream_Handler(srv interface{}, stream grpc.ServerStream) error {
	return srv.(ExecPluginServer).Stream(&execPluginStreamServer{stream})
}

type ExecPlugin_StreamServer interface {
	Send(*StreamOutput) error
	Recv() (*StreamInput, error)
	grpc.ServerStream
}

type execPluginStreamServer struct {
	grpc.ServerStream
}

func (x *execPluginStreamServer) Send(m *StreamOutput) error {
	return x.ServerStream.SendMsg(m)
}

func (x *execPluginStreamServer) Recv() (*StreamInput, error) {
	m := new(StreamInput)
	if err := x.ServerStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}

// ExecPlugin_ServiceDesc is the grpc.ServiceDesc for ExecPlugin service.
// It's only intended for direct use with grpc.RegisterService,
// and not to be introspected or modified (even as a copy)
var ExecPlugin_ServiceDesc = grpc.ServiceDesc{
	ServiceName: "com.omniview.pluginsdk.ExecPlugin",
	HandlerType: (*ExecPluginServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "GetSupportedResources",
			Handler:    _ExecPlugin_GetSupportedResources_Handler,
		},
		{
			MethodName: "GetSession",
			Handler:    _ExecPlugin_GetSession_Handler,
		},
		{
			MethodName: "ListSessions",
			Handler:    _ExecPlugin_ListSessions_Handler,
		},
		{
			MethodName: "CreateSession",
			Handler:    _ExecPlugin_CreateSession_Handler,
		},
		{
			MethodName: "AttachSession",
			Handler:    _ExecPlugin_AttachSession_Handler,
		},
		{
			MethodName: "DetachSession",
			Handler:    _ExecPlugin_DetachSession_Handler,
		},
		{
			MethodName: "CloseSession",
			Handler:    _ExecPlugin_CloseSession_Handler,
		},
		{
			MethodName: "ResizeSession",
			Handler:    _ExecPlugin_ResizeSession_Handler,
		},
	},
	Streams: []grpc.StreamDesc{
		{
			StreamName:    "Stream",
			Handler:       _ExecPlugin_Stream_Handler,
			ServerStreams: true,
			ClientStreams: true,
		},
	},
	Metadata: "proto/exec.proto",
}
