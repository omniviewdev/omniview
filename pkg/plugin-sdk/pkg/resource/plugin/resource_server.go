package plugin

import (
	"context"
	"errors"
	"log"

	pkgsettings "github.com/omniviewdev/settings"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/wrapperspb"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

// Here is the gRPC server that GRPCClient talks to.
type ResourcePluginServer struct {
	proto.UnimplementedResourcePluginServer
	// This is the real implementation
	Impl             types.ResourceProvider
	settingsProvider pkgsettings.Provider
}

// newPluginContext creates a PluginContext with settings injected.
// Used by non-CRUD methods (connections, informers, etc.).
func (s *ResourcePluginServer) newPluginContext(ctx context.Context) *pkgtypes.PluginContext {
	pctx := pkgtypes.NewPluginContextFromCtx(ctx)
	pctx.SetSettingsProvider(s.settingsProvider)
	return pctx
}

// newCRUDContext creates a PluginContext with settings and connection injected.
// Used by Get, List, Find, Create, Update, Delete.
func (s *ResourcePluginServer) newCRUDContext(ctx context.Context, connectionID string) (*pkgtypes.PluginContext, error) {
	pctx := s.newPluginContext(ctx)
	conn, err := s.Impl.GetConnection(pctx, connectionID)
	if err != nil {
		return nil, err
	}
	pctx.SetConnection(&conn)
	return pctx, nil
}

func metaToProtoResourceMeta(meta types.ResourceMeta) *proto.ResourceMeta {
	return &proto.ResourceMeta{
		Group:       meta.Group,
		Version:     meta.Version,
		Kind:        meta.Kind,
		Description: meta.Description,
		Category:    meta.Category,
	}
}

func groupToProtoResourceGroup(group types.ResourceGroup) *proto.ResourceGroup {
	versioned := &proto.VersionedResourceTypes{
		Versions: make(map[string]*proto.ResourceTypes),
	}
	for version, resources := range group.Resources {
		v, ok := versioned.GetVersions()[version]
		if !ok {
			v = &proto.ResourceTypes{
				Types: make([]*proto.ResourceMeta, 0, len(resources)),
			}
		}
		for _, r := range resources {
			v.Types = append(v.GetTypes(), metaToProtoResourceMeta(r))
		}
		versioned.Versions[version] = v
	}

	return &proto.ResourceGroup{
		Id:          group.ID,
		Name:        group.Name,
		Description: group.Description,
		Icon:        group.Icon,
		Resources:   versioned,
	}
}

func protoToResourceGroup(group *proto.ResourceGroup) types.ResourceGroup {
	resources := make(map[string][]types.ResourceMeta)
	for version, v := range group.GetResources().GetVersions() {
		for _, r := range v.GetTypes() {
			resources[version] = append(resources[version], protoToResourceMeta(r))
		}
	}
	return types.ResourceGroup{
		ID:          group.GetId(),
		Name:        group.GetName(),
		Description: group.GetDescription(),
		Icon:        group.GetIcon(),
		Resources:   resources,
	}
}

func connStatusToProto(status pkgtypes.ConnectionStatusCode) proto.ConnectionStatus_Status {
	switch status {
	case pkgtypes.ConnectionStatusUnknown:
		return proto.ConnectionStatus_UNKNOWN
	case pkgtypes.ConnectionStatusConnected:
		return proto.ConnectionStatus_CONNECTED
	case pkgtypes.ConnectionStatusDisconnected:
		return proto.ConnectionStatus_DISCONNECTED
	case pkgtypes.ConnectionStatusPending:
		return proto.ConnectionStatus_PENDING
	case pkgtypes.ConnectionStatusFailed:
		return proto.ConnectionStatus_FAILED
	case pkgtypes.ConnectionStatusError:
		return proto.ConnectionStatus_ERROR
	case pkgtypes.ConnectionStatusUnauthorized:
		return proto.ConnectionStatus_UNAUTHORIZED
	case pkgtypes.ConnectionStatusForbidden:
		return proto.ConnectionStatus_FORBIDDEN
	case pkgtypes.ConnectionStatusBadRequest:
		return proto.ConnectionStatus_BAD_REQUEST
	case pkgtypes.ConnectionStatusNotFound:
		return proto.ConnectionStatus_NOT_FOUND
	case pkgtypes.ConnectionStatusTimeout:
		return proto.ConnectionStatus_TIMEOUT
	case pkgtypes.ConnectionStatusUnavailable:
		return proto.ConnectionStatus_UNAVAILABLE
	case pkgtypes.ConnectionStatusRequestEntityTooLarge:
		return proto.ConnectionStatus_REQUEST_ENTITY_TOO_LARGE
	default:
		return proto.ConnectionStatus_UNKNOWN
	}
}

func (s *ResourcePluginServer) GetResourceGroups(
	_ context.Context,
	in *proto.ResourceGroupListRequest,
) (*proto.ResourceGroupListResponse, error) {
	resourceGroups := s.Impl.GetResourceGroups(in.GetConnectionId())
	mapped := make(map[string]*proto.ResourceGroup, len(resourceGroups))

	for id, g := range resourceGroups {
		mapped[id] = groupToProtoResourceGroup(g)
	}
	return &proto.ResourceGroupListResponse{
		Groups: mapped,
	}, nil
}

func (s *ResourcePluginServer) GetResourceGroup(
	_ context.Context,
	in *proto.ResourceGroupRequest,
) (*proto.ResourceGroup, error) {
	group, err := s.Impl.GetResourceGroup(in.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get resource group: %s", err.Error())
	}
	return groupToProtoResourceGroup(group), nil
}

func (s *ResourcePluginServer) GetResourceTypes(
	_ context.Context,
	in *proto.ResourceTypeListRequest,
) (*proto.ResourceTypes, error) {
	resourceTypes := s.Impl.GetResourceTypes(in.GetConnectionId())

	mapped := make([]*proto.ResourceMeta, 0, len(resourceTypes))
	for _, t := range resourceTypes {
		mapped = append(mapped, metaToProtoResourceMeta(t))
	}
	return &proto.ResourceTypes{
		Types: mapped,
	}, nil
}

func (s *ResourcePluginServer) GetResourceType(
	_ context.Context,
	in *proto.ResourceTypeRequest,
) (*proto.ResourceMeta, error) {
	resp, err := s.Impl.GetResourceType(in.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get resource type: %s", err.Error())
	}
	return metaToProtoResourceMeta(*resp), nil
}

func (s *ResourcePluginServer) HasResourceType(
	_ context.Context,
	in *proto.ResourceTypeRequest,
) (*wrapperspb.BoolValue, error) {
	resp := s.Impl.HasResourceType(in.GetId())
	return &wrapperspb.BoolValue{Value: resp}, nil
}

func (s *ResourcePluginServer) GetResourceDefinition(
	_ context.Context,
	in *proto.ResourceTypeRequest,
) (*proto.ResourceDefinition, error) {
	resp, err := s.Impl.GetResourceDefinition(in.GetId())
	if err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to get resource definition: %s",
			err.Error(),
		)
	}

	columnDefs := make([]*proto.ColumnDef, 0, len(resp.ColumnDefs))
	for _, col := range resp.ColumnDefs {
		columnDefs = append(columnDefs, col.ToProto())
	}

	ops := make([]int32, 0, len(resp.SupportedOperations))
	for _, op := range resp.SupportedOperations {
		ops = append(ops, int32(op))
	}

	return &proto.ResourceDefinition{
		IdAccessor:          resp.IDAccessor,
		NamespaceAccessor:   resp.NamespaceAccessor,
		MemoAccessor:        resp.MemoizerAccessor,
		ColumnDefs:          columnDefs,
		SupportedOperations: ops,
	}, nil
}

// classifyError resolves a raw error into a *types.ResourceOperationError.
// It checks (in order): errors.As for an already-classified error, the
// optional ResourceErrorClassifier interface on Impl, and falls back to INTERNAL.
func (s *ResourcePluginServer) classifyError(err error) *types.ResourceOperationError {
	var opErr *types.ResourceOperationError
	if errors.As(err, &opErr) {
		return opErr
	}
	if classifier, ok := s.Impl.(types.ResourceErrorClassifier); ok {
		if classified := classifier.ClassifyResourceError(err); classified != nil {
			if errors.As(classified, &opErr) {
				return opErr
			}
		}
	}
	return &types.ResourceOperationError{
		Err:     err,
		Code:    "INTERNAL",
		Title:   "Operation failed",
		Message: err.Error(),
	}
}

// toProtoError converts a ResourceOperationError to a proto ResourceError.
func toProtoError(opErr *types.ResourceOperationError) *proto.ResourceError {
	return &proto.ResourceError{
		Code:        opErr.Code,
		Title:       opErr.Title,
		Message:     opErr.Message,
		Suggestions: opErr.Suggestions,
	}
}

// ============================== Resource ============================== //

func (s *ResourcePluginServer) Get(
	ctx context.Context,
	in *proto.GetRequest,
) (*proto.GetResponse, error) {
	pluginCtx, err := s.newCRUDContext(ctx, in.GetContext())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get connection: %s", err.Error())
	}

	resp, err := s.Impl.Get(pluginCtx, in.GetKey(), types.GetInput{
		ID:        in.GetId(),
		Namespace: in.GetNamespace(),
	})
	if err != nil {
		opErr := s.classifyError(err)
		return &proto.GetResponse{Success: false, Error: toProtoError(opErr)}, nil
	}

	data, err := structpb.NewStruct(resp.Result)
	if err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to convert resource to struct: %s",
			err.Error(),
		)
	}

	return &proto.GetResponse{
		Success: true,
		Data:    data,
	}, nil
}

func (s *ResourcePluginServer) List(
	ctx context.Context,
	in *proto.ListRequest,
) (*proto.ListResponse, error) {
	pluginCtx, err := s.newCRUDContext(ctx, in.GetContext())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get connection: %s", err.Error())
	}

	resp, err := s.Impl.List(pluginCtx, in.GetKey(), types.ListInput{
		Namespaces: in.GetNamespaces(),
	})
	if err != nil {
		opErr := s.classifyError(err)
		return &proto.ListResponse{Success: false, Error: toProtoError(opErr)}, nil
	}

	data := make([]*structpb.Struct, 0, len(resp.Result))
	for _, item := range resp.Result {
		dataItem, err := structpb.NewStruct(item)
		if err != nil {
			return nil, status.Errorf(
				codes.Internal,
				"failed to convert resources to struct: %s",
				err.Error(),
			)
		}
		data = append(data, dataItem)
	}

	return &proto.ListResponse{
		Success: true,
		Data:    data,
	}, nil
}

func (s *ResourcePluginServer) Find(
	ctx context.Context,
	in *proto.FindRequest,
) (*proto.FindResponse, error) {
	pluginCtx, err := s.newCRUDContext(ctx, in.GetContext())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get connection: %s", err.Error())
	}

	resp, err := s.Impl.Find(pluginCtx, in.GetKey(), types.FindInput{
		Namespaces: in.GetNamespaces(),
	})
	if err != nil {
		opErr := s.classifyError(err)
		return &proto.FindResponse{Success: false, Error: toProtoError(opErr)}, nil
	}

	data := make([]*structpb.Struct, 0, len(resp.Result))
	for _, item := range resp.Result {
		dataItem, err := structpb.NewStruct(item)
		if err != nil {
			return nil, status.Errorf(
				codes.Internal,
				"failed to convert resources to struct: %s",
				err.Error(),
			)
		}
		data = append(data, dataItem)
	}

	return &proto.FindResponse{
		Success: true,
		Data:    data,
	}, nil
}

func (s *ResourcePluginServer) Create(
	ctx context.Context,
	in *proto.CreateRequest,
) (*proto.CreateResponse, error) {
	pluginCtx, err := s.newCRUDContext(ctx, in.GetContext())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get connection: %s", err.Error())
	}

	resp, err := s.Impl.Create(pluginCtx, in.GetKey(), types.CreateInput{
		Namespace: in.GetNamespace(),
		Input:     in.GetData().AsMap(),
	})
	if err != nil {
		opErr := s.classifyError(err)
		return &proto.CreateResponse{Success: false, Error: toProtoError(opErr)}, nil
	}

	data, err := structpb.NewStruct(resp.Result)
	if err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to convert resources to struct: %s",
			err.Error(),
		)
	}

	return &proto.CreateResponse{
		Success: true,
		Data:    data,
	}, nil
}

func (s *ResourcePluginServer) Update(
	ctx context.Context,
	in *proto.UpdateRequest,
) (*proto.UpdateResponse, error) {
	pluginCtx, err := s.newCRUDContext(ctx, in.GetContext())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get connection: %s", err.Error())
	}

	resp, err := s.Impl.Update(pluginCtx, in.GetKey(), types.UpdateInput{
		ID:        in.GetId(),
		Namespace: in.GetNamespace(),
		Input:     in.GetData().AsMap(),
	})
	if err != nil {
		opErr := s.classifyError(err)
		return &proto.UpdateResponse{Success: false, Error: toProtoError(opErr)}, nil
	}

	data, err := structpb.NewStruct(resp.Result)
	if err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to convert resources to struct: %s",
			err.Error(),
		)
	}

	return &proto.UpdateResponse{
		Success: true,
		Data:    data,
	}, nil
}

func (s *ResourcePluginServer) Delete(
	ctx context.Context,
	in *proto.DeleteRequest,
) (*proto.DeleteResponse, error) {
	pluginCtx, err := s.newCRUDContext(ctx, in.GetContext())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get connection: %s", err.Error())
	}

	resp, err := s.Impl.Delete(pluginCtx, in.GetKey(), types.DeleteInput{
		ID:        in.GetId(),
		Namespace: in.GetNamespace(),
	})
	if err != nil {
		opErr := s.classifyError(err)
		return &proto.DeleteResponse{Success: false, Error: toProtoError(opErr)}, nil
	}

	data, err := structpb.NewStruct(resp.Result)
	if err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to convert data to struct: %s",
			err.Error(),
		)
	}

	return &proto.DeleteResponse{
		Success: true,
		Data:    data,
	}, nil
}

// ============================== Informer ============================== //

func (s *ResourcePluginServer) HasInformer(
	ctx context.Context,
	in *proto.HasInformerRequest,
) (*wrapperspb.BoolValue, error) {
	pluginCtx := s.newPluginContext(ctx)
	resp := s.Impl.HasInformer(pluginCtx, in.GetConnection())
	return &wrapperspb.BoolValue{Value: resp}, nil
}

func (s *ResourcePluginServer) StartConnectionInformer(
	ctx context.Context,
	in *proto.StartConnectionInformerRequest,
) (*emptypb.Empty, error) {
	pluginCtx := s.newPluginContext(ctx)
	if err := s.Impl.StartConnectionInformer(pluginCtx, in.GetConnection()); err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to start connection informer: %s",
			err.Error(),
		)
	}
	return &emptypb.Empty{}, nil
}

func (s *ResourcePluginServer) StopConnectionInformer(
	ctx context.Context,
	in *proto.StopConnectionInformerRequest,
) (*emptypb.Empty, error) {
	pluginCtx := s.newPluginContext(ctx)
	if err := s.Impl.StopConnectionInformer(pluginCtx, in.GetConnection()); err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to start connection informer: %s",
			err.Error(),
		)
	}
	return &emptypb.Empty{}, nil
}

// Namespaceless and connectionless.
func (s *ResourcePluginServer) ListenForEvents(
	_ *emptypb.Empty,
	stream proto.ResourcePlugin_ListenForEventsServer,
) error {
	log.Printf("ListenForEvents")
	pluginCtx := s.newPluginContext(stream.Context())

	addChan := make(chan types.InformerAddPayload)
	updateChan := make(chan types.InformerUpdatePayload)
	deleteChan := make(chan types.InformerDeletePayload)
	stateChan := make(chan types.InformerStateEvent)

	go func() {
		if err := s.Impl.ListenForEvents(pluginCtx, addChan, updateChan, deleteChan, stateChan); err != nil {
			log.Printf("failed to listen for events: %s", err.Error())
			return
		}
	}()

	for {
		select {
		case <-stream.Context().Done():
			log.Printf("Context Done")
			return status.Errorf(codes.Canceled, "context canceled")
		case event := <-addChan:
			data, err := structpb.NewStruct(event.Data)
			if err != nil {
				log.Printf("failed to convert data to struct: %s", err.Error())
				continue
			}
			if err = stream.SendMsg(&proto.InformerEvent{
				Key:        event.Key,
				Connection: event.Connection,
				Id:         event.ID,
				Namespace:  event.Namespace,
				Action: &proto.InformerEvent_Add{
					Add: &proto.InformerAddEvent{
						Data: data,
					},
				},
			}); err != nil {
				log.Printf("failed to send add event: %s", err.Error())
			}
		case event := <-updateChan:
			olddata, err := structpb.NewStruct(event.OldData)
			if err != nil {
				log.Printf("failed to convert olddata to struct: %s", err.Error())
				continue
			}
			newdata, err := structpb.NewStruct(event.NewData)
			if err != nil {
				log.Printf("failed to convert newdata to struct: %s", err.Error())
				continue
			}

			if err = stream.SendMsg(&proto.InformerEvent{
				Key:        event.Key,
				Connection: event.Connection,
				Id:         event.ID,
				Namespace:  event.Namespace,
				Action: &proto.InformerEvent_Update{
					Update: &proto.InformerUpdateEvent{
						OldData: olddata,
						NewData: newdata,
					},
				},
			}); err != nil {
				log.Printf("failed to send update event: %s", err.Error())
			}
		case event := <-deleteChan:
			data, err := structpb.NewStruct(event.Data)
			if err != nil {
				log.Printf("failed to convert data to struct: %s", err.Error())
				continue
			}
			if err = stream.SendMsg(&proto.InformerEvent{
				Key:        event.Key,
				Connection: event.Connection,
				Id:         event.ID,
				Namespace:  event.Namespace,
				Action: &proto.InformerEvent_Delete{
					Delete: &proto.InformerDeleteEvent{
						Data: data,
					},
				},
			}); err != nil {
				log.Printf("failed to send delete event: %s", err.Error())
			}
		case event := <-stateChan:
			stateProto := &proto.InformerStateEvent{
				Connection:    event.Connection,
				ResourceKey:   event.ResourceKey,
				State:         proto.InformerResourceState(event.State),
				ResourceCount: int32(event.ResourceCount),
				TotalCount:    int32(event.TotalCount),
			}
			if event.Error != nil {
				stateProto.Error = toProtoError(event.Error)
			}
			if err := stream.SendMsg(&proto.InformerEvent{
				Key:        event.ResourceKey,
				Connection: event.Connection,
				Action:     &proto.InformerEvent_State{State: stateProto},
			}); err != nil {
				log.Printf("failed to send state event: %s", err.Error())
			}
		}
	}
}

func (s *ResourcePluginServer) GetInformerState(
	ctx context.Context,
	in *proto.GetInformerStateRequest,
) (*proto.InformerConnectionSummary, error) {
	pluginCtx := s.newPluginContext(ctx)

	summary, err := s.Impl.GetInformerState(pluginCtx, in.GetConnection())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get informer state: %s", err.Error())
	}
	if summary == nil {
		return &proto.InformerConnectionSummary{Connection: in.GetConnection()}, nil
	}

	resources := make(map[string]proto.InformerResourceState, len(summary.Resources))
	for k, v := range summary.Resources {
		resources[k] = proto.InformerResourceState(v)
	}
	counts := make(map[string]int32, len(summary.ResourceCounts))
	for k, v := range summary.ResourceCounts {
		counts[k] = int32(v)
	}

	return &proto.InformerConnectionSummary{
		Connection:     summary.Connection,
		Resources:      resources,
		ResourceCounts: counts,
		TotalResources: int32(summary.TotalResources),
		SyncedCount:    int32(summary.SyncedCount),
		ErrorCount:     int32(summary.ErrorCount),
	}, nil
}

func (s *ResourcePluginServer) EnsureInformerForResource(
	ctx context.Context,
	in *proto.EnsureInformerRequest,
) (*emptypb.Empty, error) {
	pluginCtx := s.newPluginContext(ctx)

	if err := s.Impl.EnsureInformerForResource(pluginCtx, in.GetConnection(), in.GetResourceKey()); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to ensure informer for resource: %s", err.Error())
	}
	return &emptypb.Empty{}, nil
}

// ============================== Layout ============================== //

func (s *ResourcePluginServer) GetLayout(
	_ context.Context,
	in *proto.GetLayoutRequest,
) (*proto.Layout, error) {
	layout, err := s.Impl.GetLayout(in.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get layout: %s", err.Error())
	}
	items := make([]*proto.LayoutItem, 0, len(layout))
	for _, item := range layout {
		items = append(items, &proto.LayoutItem{
			Id:          item.ID,
			Label:       item.Label,
			Description: item.Description,
		})
	}
	return &proto.Layout{
		Items: items,
	}, nil
}

func (s *ResourcePluginServer) GetDefaultLayout(
	_ context.Context,
	_ *emptypb.Empty,
) (*proto.Layout, error) {
	layout, err := s.Impl.GetDefaultLayout()
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get default layout: %s", err.Error())
	}
	items := make([]*proto.LayoutItem, 0, len(layout))
	for _, item := range layout {
		items = append(items, &proto.LayoutItem{
			Id:          item.ID,
			Label:       item.Label,
			Description: item.Description,
		})
	}
	return &proto.Layout{
		Items: items,
	}, nil
}

func (s *ResourcePluginServer) SetLayout(
	_ context.Context,
	in *proto.SetLayoutRequest,
) (*emptypb.Empty, error) {
	inlayout := in.GetLayout()

	layout := make([]types.LayoutItem, 0, len(inlayout.GetItems()))
	for _, item := range inlayout.GetItems() {
		layout = append(layout, protoToLayoutItem(item))
	}
	if err := s.Impl.SetLayout(in.GetId(), layout); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to set layout: %s", err.Error())
	}
	return &emptypb.Empty{}, nil
}

// ============================== Actions ============================== //

func (s *ResourcePluginServer) GetActions(
	ctx context.Context,
	in *proto.GetActionsRequest,
) (*proto.GetActionsResponse, error) {
	pluginCtx, err := s.newCRUDContext(ctx, in.GetContext())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get connection: %s", err.Error())
	}

	actions, err := s.Impl.GetActions(pluginCtx, in.GetKey())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get actions: %s", err.Error())
	}

	protoActions := make([]*proto.ActionDescriptor, 0, len(actions))
	for _, a := range actions {
		scope := proto.ActionScope_ACTION_SCOPE_INSTANCE
		if a.Scope == types.ActionScopeType {
			scope = proto.ActionScope_ACTION_SCOPE_TYPE
		}
		protoActions = append(protoActions, &proto.ActionDescriptor{
			Id:          a.ID,
			Label:       a.Label,
			Description: a.Description,
			Icon:        a.Icon,
			Scope:       scope,
			Streaming:   a.Streaming,
		})
	}

	return &proto.GetActionsResponse{Actions: protoActions}, nil
}

func (s *ResourcePluginServer) ExecuteAction(
	ctx context.Context,
	in *proto.ExecuteActionRequest,
) (*proto.ExecuteActionResponse, error) {
	pluginCtx, err := s.newCRUDContext(ctx, in.GetContext())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get connection: %s", err.Error())
	}

	input := types.ActionInput{
		ID:        in.GetId(),
		Namespace: in.GetNamespace(),
	}
	if in.GetParams() != nil {
		input.Params = in.GetParams().AsMap()
	}

	result, err := s.Impl.ExecuteAction(pluginCtx, in.GetKey(), in.GetActionId(), input)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to execute action: %s", err.Error())
	}

	var data *structpb.Struct
	if result.Data != nil {
		data, err = structpb.NewStruct(result.Data)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to convert action result: %s", err.Error())
		}
	}

	return &proto.ExecuteActionResponse{
		Success: result.Success,
		Data:    data,
		Message: result.Message,
	}, nil
}

func (s *ResourcePluginServer) StreamAction(
	in *proto.ExecuteActionRequest,
	stream proto.ResourcePlugin_StreamActionServer,
) error {
	pluginCtx, err := s.newCRUDContext(stream.Context(), in.GetContext())
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get connection: %s", err.Error())
	}

	input := types.ActionInput{
		ID:        in.GetId(),
		Namespace: in.GetNamespace(),
	}
	if in.GetParams() != nil {
		input.Params = in.GetParams().AsMap()
	}

	eventChan := make(chan types.ActionEvent)

	go func() {
		if err := s.Impl.StreamAction(pluginCtx, in.GetKey(), in.GetActionId(), input, eventChan); err != nil {
			log.Printf("failed to stream action: %s", err.Error())
		}
		close(eventChan)
	}()

	for {
		select {
		case <-stream.Context().Done():
			return status.Errorf(codes.Canceled, "context canceled")
		case event, ok := <-eventChan:
			if !ok {
				return nil // channel closed, stream complete
			}
			var data *structpb.Struct
			if event.Data != nil {
				data, err = structpb.NewStruct(event.Data)
				if err != nil {
					log.Printf("failed to convert event data: %s", err.Error())
					continue
				}
			}
			if err = stream.Send(&proto.StreamActionEvent{
				Type: event.Type,
				Data: data,
			}); err != nil {
				log.Printf("failed to send stream action event: %s", err.Error())
				return err
			}
		}
	}
}

// ============================== Schemas ============================== //

func (s *ResourcePluginServer) GetEditorSchemas(
	ctx context.Context,
	in *proto.GetEditorSchemasRequest,
) (*proto.EditorSchemaList, error) {
	pluginCtx := s.newPluginContext(ctx)

	schemas, err := s.Impl.GetEditorSchemas(pluginCtx, in.GetConnectionId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get editor schemas: %s", err.Error())
	}

	protoSchemas := make([]*proto.EditorSchema, 0, len(schemas))
	for _, s := range schemas {
		protoSchemas = append(protoSchemas, &proto.EditorSchema{
			ResourceKey: s.ResourceKey,
			FileMatch:   s.FileMatch,
			Uri:         s.URI,
			Url:         s.URL,
			Content:     s.Content,
			Language:    s.Language,
		})
	}

	return &proto.EditorSchemaList{Schemas: protoSchemas}, nil
}

// ============================== Connection ============================== //

func (s *ResourcePluginServer) StartConnection(
	ctx context.Context,
	in *proto.ConnectionRequest,
) (*proto.ConnectionStatus, error) {
	pluginCtx := s.newPluginContext(ctx)

	conn, err := s.Impl.StartConnection(pluginCtx, in.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to start connection: %s", err.Error())
	}

	protoconn, err := connectionToProto(*conn.Connection)
	if err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to convert connection to proto: %s",
			err.Error(),
		)
	}

	return &proto.ConnectionStatus{
		Connection: protoconn,
		Status:     connStatusToProto(conn.Status),
		Error:      conn.Error,
		Details:    conn.Details,
	}, nil
}

func (s *ResourcePluginServer) StopConnection(
	ctx context.Context,
	in *proto.ConnectionRequest,
) (*proto.Connection, error) {
	pluginCtx := s.newPluginContext(ctx)

	conn, err := s.Impl.StopConnection(pluginCtx, in.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to stop connection: %s", err.Error())
	}

	protoconn, err := connectionToProto(conn)
	if err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to convert connection to proto: %s",
			err.Error(),
		)
	}

	return protoconn, err
}

func (s *ResourcePluginServer) LoadConnections(
	ctx context.Context,
	_ *emptypb.Empty,
) (*proto.ConnectionList, error) {
	pluginCtx := s.newPluginContext(ctx)

	connections, err := s.Impl.LoadConnections(pluginCtx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load connections: %s", err.Error())
	}

	mappedConnections := make([]*proto.Connection, 0, len(connections))
	for _, conn := range connections {
		protoconn, err := connectionToProto(conn)
		if err != nil {
			return nil, status.Errorf(
				codes.Internal,
				"failed to convert connection to proto: %s",
				err.Error(),
			)
		}
		mappedConnections = append(mappedConnections, protoconn)
	}

	return &proto.ConnectionList{
		Connections: mappedConnections,
	}, nil
}

func (s *ResourcePluginServer) ListConnections(
	ctx context.Context,
	_ *emptypb.Empty,
) (*proto.ConnectionList, error) {
	pluginCtx := s.newPluginContext(ctx)

	connections, err := s.Impl.ListConnections(pluginCtx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load connections: %s", err.Error())
	}

	mappedConnections := make([]*proto.Connection, 0, len(connections))
	for _, conn := range connections {
		protoconn, err := connectionToProto(conn)
		if err != nil {
			return nil, status.Errorf(
				codes.Internal,
				"failed to convert connection to proto: %s",
				err.Error(),
			)
		}
		mappedConnections = append(mappedConnections, protoconn)
	}

	return &proto.ConnectionList{
		Connections: mappedConnections,
	}, nil
}

func (s *ResourcePluginServer) GetConnection(
	ctx context.Context,
	in *proto.ConnectionRequest,
) (*proto.Connection, error) {
	pluginCtx := s.newPluginContext(ctx)

	conn, err := s.Impl.GetConnection(pluginCtx, in.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get connection: %s", err.Error())
	}

	protoconn, err := connectionToProto(conn)
	if err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to convert connection to proto: %s",
			err.Error(),
		)
	}

	return protoconn, err
}

func (s *ResourcePluginServer) GetConnectionNamespaces(
	ctx context.Context,
	in *proto.ConnectionRequest,
) (*proto.ConnectionNamespacesResponse, error) {
	pluginCtx := s.newPluginContext(ctx)
	namespaces, err := s.Impl.GetConnectionNamespaces(pluginCtx, in.GetId())
	if err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to get connection namespaces: %s",
			err.Error(),
		)
	}
	return &proto.ConnectionNamespacesResponse{
		Namespaces: namespaces,
	}, nil
}

func (s *ResourcePluginServer) UpdateConnection(
	ctx context.Context,
	in *proto.UpdateConnectionRequest,
) (*proto.Connection, error) {
	pluginCtx := s.newPluginContext(ctx)

	conn := pkgtypes.Connection{
		ID: in.GetId(),
	}
	if in.GetName() != nil {
		conn.Name = in.GetName().GetValue()
	}
	if in.GetDescription() != nil {
		conn.Description = in.GetDescription().GetValue()
	}
	if in.GetAvatar() != nil {
		conn.Avatar = in.GetAvatar().GetValue()
	}

	labels := in.GetLabels()
	if labels != nil {
		conn.Labels = labels.AsMap()
	}

	conn, err := s.Impl.UpdateConnection(pluginCtx, conn)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update connection: %s", err.Error())
	}

	protoconn, err := connectionToProto(conn)
	if err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to convert connection to proto: %s",
			err.Error(),
		)
	}

	return protoconn, err
}

func (s *ResourcePluginServer) DeleteConnection(
	ctx context.Context,
	in *proto.ConnectionRequest,
) (*emptypb.Empty, error) {
	pluginCtx := s.newPluginContext(ctx)
	if err := s.Impl.DeleteConnection(pluginCtx, in.GetId()); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete connection: %s", err.Error())
	}
	return &emptypb.Empty{}, nil
}

func (s *ResourcePluginServer) WatchConnections(
	_ *emptypb.Empty,
	stream proto.ResourcePlugin_WatchConnectionsServer,
) error {
	log.Printf("WatchConnections")
	pluginCtx := s.newPluginContext(stream.Context())

	eventChan := make(chan []pkgtypes.Connection)

	go func() {
		if err := s.Impl.WatchConnections(pluginCtx, eventChan); err != nil {
			log.Printf("failed to listen for connection change events: %s", err.Error())
			return
		}
	}()

	for {
		select {
		case <-stream.Context().Done():
			log.Printf("Context Done")
			return status.Errorf(codes.Canceled, "context canceled")
		case event := <-eventChan:
			// convert and send
			connections := make([]*proto.Connection, 0, len(event))
			for _, connection := range event {
				converted, err := connectionToProto(connection)
				if err != nil {
					log.Printf("failed to convert connection: %s\n", err)
					continue
				}
				connections = append(connections, converted)
			}

			if err := stream.Send(&proto.ConnectionList{
				Connections: connections,
			}); err != nil {
				// do nothing for now
				log.Printf("failed to send add event: %s\n", err.Error())
			}
		}
	}
}
