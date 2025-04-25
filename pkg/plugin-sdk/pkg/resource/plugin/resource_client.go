package plugin

import (
	"context"
	"errors"
	"log"

	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

var ErrNoConnection = errors.New("no connection provided")

// ResourcePluginClient is the real client implementation for ResourcePlugin.
type ResourcePluginClient struct {
	client proto.ResourcePluginClient
}

var _ types.ResourceProvider = (*ResourcePluginClient)(nil)

func protoToConnection(conn *proto.Connection) pkgtypes.Connection {
	return pkgtypes.Connection{
		ID:          conn.GetId(),
		UID:         conn.GetUid(),
		Name:        conn.GetName(),
		Description: conn.GetDescription(),
		Avatar:      conn.GetAvatar(),
		ExpiryTime:  conn.GetExpiryTime().AsDuration(),
		LastRefresh: conn.GetLastRefresh().AsTime(),
		Data:        conn.GetData().AsMap(),
		Labels:      conn.GetLabels().AsMap(),
	}
}

func protoToConnStatus(status proto.ConnectionStatus_Status) pkgtypes.ConnectionStatusCode {
	switch status {
	case proto.ConnectionStatus_UNKNOWN:
		return pkgtypes.ConnectionStatusUnknown
	case proto.ConnectionStatus_CONNECTED:
		return pkgtypes.ConnectionStatusConnected
	case proto.ConnectionStatus_DISCONNECTED:
		return pkgtypes.ConnectionStatusDisconnected
	case proto.ConnectionStatus_PENDING:
		return pkgtypes.ConnectionStatusPending
	case proto.ConnectionStatus_FAILED:
		return pkgtypes.ConnectionStatusFailed
	case proto.ConnectionStatus_ERROR:
		return pkgtypes.ConnectionStatusError
	case proto.ConnectionStatus_UNAUTHORIZED:
		return pkgtypes.ConnectionStatusUnauthorized
	case proto.ConnectionStatus_FORBIDDEN:
		return pkgtypes.ConnectionStatusForbidden
	case proto.ConnectionStatus_BAD_REQUEST:
		return pkgtypes.ConnectionStatusBadRequest
	case proto.ConnectionStatus_NOT_FOUND:
		return pkgtypes.ConnectionStatusNotFound
	case proto.ConnectionStatus_TIMEOUT:
		return pkgtypes.ConnectionStatusTimeout
	case proto.ConnectionStatus_UNAVAILABLE:
		return pkgtypes.ConnectionStatusUnavailable
	case proto.ConnectionStatus_REQUEST_ENTITY_TOO_LARGE:
		return pkgtypes.ConnectionStatusRequestEntityTooLarge
	default:
		return pkgtypes.ConnectionStatusUnknown
	}
}

func connectionToProto(conn pkgtypes.Connection) (*proto.Connection, error) {
	data, err := structpb.NewStruct(conn.Data)
	if err != nil {
		return nil, err
	}
	labels, err := structpb.NewStruct(conn.Labels)
	if err != nil {
		return nil, err
	}

	return &proto.Connection{
		Id:          conn.ID,
		Uid:         conn.UID,
		Name:        conn.Name,
		Description: conn.Description,
		Avatar:      conn.Avatar,
		ExpiryTime:  durationpb.New(conn.ExpiryTime),
		LastRefresh: timestamppb.New(conn.LastRefresh),
		Data:        data,
		Labels:      labels,
	}, nil
}

func protoToResourceMeta(meta *proto.ResourceMeta) types.ResourceMeta {
	return types.ResourceMeta{
		Group:       meta.GetGroup(),
		Version:     meta.GetVersion(),
		Kind:        meta.GetKind(),
		Description: meta.GetDescription(),
		Category:    meta.GetCategory(),
	}
}

func protoToLayoutItem(item *proto.LayoutItem) types.LayoutItem {
	items := make([]types.LayoutItem, 0, len(item.GetItems()))
	for _, i := range item.GetItems() {
		items = append(items, protoToLayoutItem(i))
	}

	return types.LayoutItem{
		ID:          item.GetId(),
		Label:       item.GetLabel(),
		Description: item.GetDescription(),
		Icon:        item.GetIcon(),
		Items:       items,
	}
}

// func layoutItemToProto(item types.LayoutItem) *proto.LayoutItem {
// 	items := make([]*proto.LayoutItem, 0, len(item.Items))
// 	for _, i := range item.Items {
// 		items = append(items, layoutItemToProto(i))
// 	}
// 	return &proto.LayoutItem{
// 		Id:          item.ID,
// 		Label:       item.Label,
// 		Description: item.Description,
// 		Icon:        item.Icon,
// 		Items:       items,
// 	}
// }

// ============================== Resource Types ============================== //

func (r *ResourcePluginClient) GetResourceGroups(connID string) map[string]types.ResourceGroup {
	resp, err := r.client.GetResourceGroups(context.Background(), &proto.ResourceGroupListRequest{
		ConnectionId: connID,
	})
	if err != nil {
		log.Print("err", err)
		return nil
	}
	result := make(map[string]types.ResourceGroup)

	for id, g := range resp.GetGroups() {
		versioned := g.GetResources()
		versions := make(map[string][]types.ResourceMeta)

		for _, rts := range versioned.GetVersions() {
			for _, t := range rts.GetTypes() {
				v, ok := versions[t.GetVersion()]
				if !ok {
					v = make([]types.ResourceMeta, 0, len(rts.GetTypes()))
				}
				v = append(v, protoToResourceMeta(t))
				versions[t.GetVersion()] = v
			}
		}

		result[id] = types.ResourceGroup{
			ID:          g.GetId(),
			Name:        g.GetName(),
			Description: g.GetDescription(),
			Icon:        g.GetIcon(),
			Resources:   versions,
		}
	}
	return result
}

func (r *ResourcePluginClient) GetResourceGroup(id string) (types.ResourceGroup, error) {
	panic("not implemented")
}

func (r *ResourcePluginClient) GetResourceTypes(connID string) map[string]types.ResourceMeta {
	resp, err := r.client.GetResourceTypes(context.Background(), &proto.ResourceTypeListRequest{
		ConnectionId: connID,
	})
	if err != nil {
		log.Print("err", err)
		return nil
	}
	result := make(map[string]types.ResourceMeta)
	for _, t := range resp.GetTypes() {
		result[t.GetKind()] = protoToResourceMeta(t)
	}
	return result
}

func (r *ResourcePluginClient) GetResourceType(id string) (*types.ResourceMeta, error) {
	resp, err := r.client.GetResourceType(context.Background(), &proto.ResourceTypeRequest{Id: id})
	if err != nil {
		return nil, err
	}
	result := protoToResourceMeta(resp)
	return &result, nil
}

func (r *ResourcePluginClient) HasResourceType(id string) bool {
	resp, err := r.client.HasResourceType(context.Background(), &proto.ResourceTypeRequest{Id: id})
	if err != nil {
		return false
	}
	return resp.GetValue()
}

func (r *ResourcePluginClient) GetResourceDefinition(id string) (types.ResourceDefinition, error) {
	resp, err := r.client.GetResourceDefinition(
		context.Background(),
		&proto.ResourceTypeRequest{Id: id},
	)
	if err != nil {
		return types.ResourceDefinition{}, err
	}

	protoColumnDefs := resp.GetColumnDefs()
	columndefs := make([]types.ColumnDef, 0, len(protoColumnDefs))
	for _, col := range protoColumnDefs {
		columndefs = append(columndefs, types.ColumnDefFromProto(col))
	}

	return types.ResourceDefinition{
		IDAccessor:        resp.GetIdAccessor(),
		NamespaceAccessor: resp.GetNamespaceAccessor(),
		MemoizerAccessor:  resp.GetMemoAccessor(),
		ColumnDefs:        columndefs,
	}, nil
}

// ============================== Operations ============================== //

func (r *ResourcePluginClient) Get(
	ctx *pkgtypes.PluginContext,
	key string,
	input types.GetInput,
) (*types.GetResult, error) {
	if ctx.Connection == nil {
		return nil, ErrNoConnection
	}

	resp, err := r.client.Get(ctx.Context, &proto.GetRequest{
		Key:       key,
		Context:   ctx.Connection.ID,
		Id:        input.ID,
		Namespace: input.Namespace,
	})
	if err != nil {
		return nil, err
	}

	return &types.GetResult{
		Result:  resp.GetData().AsMap(),
		Success: resp.GetSuccess(),
	}, nil
}

func (r *ResourcePluginClient) List(
	ctx *pkgtypes.PluginContext,
	key string,
	input types.ListInput,
) (*types.ListResult, error) {
	if ctx.Connection == nil {
		return nil, ErrNoConnection
	}

	resp, err := r.client.List(ctx.Context, &proto.ListRequest{
		Key:        key,
		Context:    ctx.Connection.ID,
		Namespaces: input.Namespaces,
	})
	if err != nil {
		return nil, err
	}

	data := resp.GetData()
	res := make([]map[string]interface{}, 0, len(data))
	for _, d := range data {
		res = append(res, d.AsMap())
	}

	result := &types.ListResult{
		Result:  res,
		Success: resp.GetSuccess(),
	}

	return result, nil
}

func (r *ResourcePluginClient) Find(
	ctx *pkgtypes.PluginContext,
	key string,
	input types.FindInput,
) (*types.FindResult, error) {
	if ctx.Connection == nil {
		return nil, ErrNoConnection
	}

	resp, err := r.client.Find(ctx.Context, &proto.FindRequest{
		Key:        key,
		Context:    ctx.Connection.ID,
		Namespaces: input.Namespaces,
	})
	if err != nil {
		return nil, err
	}

	data := resp.GetData()
	res := make([]map[string]interface{}, 0, len(data))
	for _, d := range data {
		res = append(res, d.AsMap())
	}

	result := &types.FindResult{
		Result:  res,
		Success: resp.GetSuccess(),
	}

	return result, nil
}

func (r *ResourcePluginClient) Create(
	ctx *pkgtypes.PluginContext,
	key string,
	input types.CreateInput,
) (*types.CreateResult, error) {
	if ctx.Connection == nil {
		return nil, ErrNoConnection
	}

	data, err := structpb.NewStruct(input.Input)
	if err != nil {
		return nil, err
	}

	resp, err := r.client.Create(ctx.Context, &proto.CreateRequest{
		Key:       key,
		Context:   ctx.Connection.ID,
		Namespace: input.Namespace,
		Data:      data,
	})
	if err != nil {
		return nil, err
	}

	return &types.CreateResult{
		Result:  resp.GetData().AsMap(),
		Success: resp.GetSuccess(),
	}, nil
}

func (r *ResourcePluginClient) Update(
	ctx *pkgtypes.PluginContext,
	key string,
	input types.UpdateInput,
) (*types.UpdateResult, error) {
	if ctx.Connection == nil {
		return nil, ErrNoConnection
	}

	data, err := structpb.NewStruct(input.Input)
	if err != nil {
		return nil, err
	}

	resp, err := r.client.Update(ctx.Context, &proto.UpdateRequest{
		Key:       key,
		Context:   ctx.Connection.ID,
		Id:        input.ID,
		Namespace: input.Namespace,
		Data:      data,
	})
	if err != nil {
		return nil, err
	}

	return &types.UpdateResult{
		Result:  resp.GetData().AsMap(),
		Success: resp.GetSuccess(),
	}, nil
}

func (r *ResourcePluginClient) Delete(
	ctx *pkgtypes.PluginContext,
	key string,
	input types.DeleteInput,
) (*types.DeleteResult, error) {
	if ctx.Connection == nil {
		return nil, ErrNoConnection
	}

	resp, err := r.client.Delete(ctx.Context, &proto.DeleteRequest{
		Key:       key,
		Context:   ctx.Connection.ID,
		Id:        input.ID,
		Namespace: input.Namespace,
	})
	if err != nil {
		return nil, err
	}

	return &types.DeleteResult{
		Result:  resp.GetData().AsMap(),
		Success: resp.GetSuccess(),
	}, nil
}

// ============================== Informer ============================== //

func (r *ResourcePluginClient) HasInformer(
	_ *pkgtypes.PluginContext,
	connectionID string,
) bool {
	resp, err := r.client.HasInformer(context.Background(), &proto.HasInformerRequest{
		Connection: connectionID,
	})
	if err != nil {
		return false
	}
	return resp.GetValue()
}

func (r *ResourcePluginClient) StartConnectionInformer(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) error {
	_, err := r.client.StartConnectionInformer(
		ctx.Context,
		&proto.StartConnectionInformerRequest{
			Connection: connectionID,
		},
	)
	return err
}

func (r *ResourcePluginClient) StopConnectionInformer(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) error {
	_, err := r.client.StopConnectionInformer(
		ctx.Context,
		&proto.StopConnectionInformerRequest{
			Connection: connectionID,
		},
	)
	return err
}

// ListenForEvents listens for events from the resource provider
// and pipes them back to the event subsystem, stopping when stopCh is closed.
// This method is blocking, and should be run as part of the resourcer
// controller's event loop.
func (r *ResourcePluginClient) ListenForEvents(
	ctx *pkgtypes.PluginContext,
	addStream chan types.InformerAddPayload,
	updateStream chan types.InformerUpdatePayload,
	deleteStream chan types.InformerDeletePayload,
) error {
	stream, err := r.client.ListenForEvents(ctx.Context, &emptypb.Empty{})
	if err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Context.Done():
			return nil
		default:
			msg, msgErr := stream.Recv()
			if msgErr != nil {
				return msgErr
			}

			switch msg.GetAction().(type) {
			case *proto.InformerEvent_Add:
				add := msg.GetAdd()
				addStream <- types.InformerAddPayload{
					Key:        msg.GetKey(),
					Connection: msg.GetConnection(),
					ID:         msg.GetId(),
					Namespace:  msg.GetNamespace(),
					Data:       add.GetData().AsMap(),
				}
			case *proto.InformerEvent_Update:
				update := msg.GetUpdate()
				updateStream <- types.InformerUpdatePayload{
					Key:        msg.GetKey(),
					Connection: msg.GetConnection(),
					ID:         msg.GetId(),
					Namespace:  msg.GetNamespace(),
					OldData:    update.GetOldData().AsMap(),
					NewData:    update.GetNewData().AsMap(),
				}
			case *proto.InformerEvent_Delete:
				del := msg.GetDelete()
				deleteStream <- types.InformerDeletePayload{
					Key:        msg.GetKey(),
					Connection: msg.GetConnection(),
					ID:         msg.GetId(),
					Namespace:  msg.GetNamespace(),
					Data:       del.GetData().AsMap(),
				}
			}
		}
	}
}

// ============================== Layout ============================== //

func (r *ResourcePluginClient) GetLayout(layoutID string) ([]types.LayoutItem, error) {
	resp, err := r.client.GetLayout(context.Background(), &proto.GetLayoutRequest{
		Id: layoutID,
	})
	if err != nil {
		return nil, err
	}
	result := make([]types.LayoutItem, 0, len(resp.GetItems()))
	for _, item := range resp.GetItems() {
		result = append(result, protoToLayoutItem(item))
	}
	return result, nil
}

func (r *ResourcePluginClient) GetDefaultLayout() ([]types.LayoutItem, error) {
	resp, err := r.client.GetDefaultLayout(context.Background(), &emptypb.Empty{})
	if err != nil {
		return nil, err
	}
	result := make([]types.LayoutItem, 0, len(resp.GetItems()))
	for _, item := range resp.GetItems() {
		result = append(result, protoToLayoutItem(item))
	}
	return result, nil
}

func (r *ResourcePluginClient) SetLayout(_ string, _ []types.LayoutItem) error {
	panic("not implemented")
}

// ============================== Connection ============================== //

func (r *ResourcePluginClient) StartConnection(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) (pkgtypes.ConnectionStatus, error) {
	conn, err := r.client.StartConnection(ctx.Context, &proto.ConnectionRequest{
		Id: connectionID,
	})
	if err != nil {
		return pkgtypes.ConnectionStatus{}, err
	}

	c := protoToConnection(conn.GetConnection())

	return pkgtypes.ConnectionStatus{
		Connection: &c,
		Status:     protoToConnStatus(conn.GetStatus()),
		Error:      conn.GetError(),
		Details:    conn.GetDetails(),
	}, nil
}

func (r *ResourcePluginClient) StopConnection(
	ctx *pkgtypes.PluginContext,
	connectionID string,
) (pkgtypes.Connection, error) {
	conn, err := r.client.StopConnection(ctx.Context, &proto.ConnectionRequest{
		Id: connectionID,
	})
	if err != nil {
		return pkgtypes.Connection{}, err
	}
	return protoToConnection(conn), nil
}

func (r *ResourcePluginClient) LoadConnections(
	ctx *pkgtypes.PluginContext,
) ([]pkgtypes.Connection, error) {
	connections, err := r.client.LoadConnections(ctx.Context, &emptypb.Empty{})
	if err != nil {
		return nil, err
	}
	returned := connections.GetConnections()

	result := make([]pkgtypes.Connection, 0, len(returned))
	for _, conn := range returned {
		result = append(result, protoToConnection(conn))
	}

	return result, nil
}

func (r *ResourcePluginClient) ListConnections(
	ctx *pkgtypes.PluginContext,
) ([]pkgtypes.Connection, error) {
	connections, err := r.client.ListConnections(ctx.Context, &emptypb.Empty{})
	if err != nil {
		return nil, err
	}
	returned := connections.GetConnections()
	result := make([]pkgtypes.Connection, 0, len(returned))
	for _, conn := range returned {
		result = append(result, protoToConnection(conn))
	}
	return result, nil
}

func (r *ResourcePluginClient) GetConnection(
	ctx *pkgtypes.PluginContext,
	id string,
) (pkgtypes.Connection, error) {
	conn, err := r.client.GetConnection(ctx.Context, &proto.ConnectionRequest{
		Id: id,
	})
	if err != nil {
		return pkgtypes.Connection{}, err
	}
	return protoToConnection(conn), nil
}

func (r *ResourcePluginClient) GetConnectionNamespaces(
	ctx *pkgtypes.PluginContext,
	id string,
) ([]string, error) {
	resp, err := r.client.GetConnectionNamespaces(ctx.Context, &proto.ConnectionRequest{
		Id: id,
	})
	if err != nil {
		return nil, err
	}
	return resp.GetNamespaces(), nil
}

func (r *ResourcePluginClient) UpdateConnection(
	ctx *pkgtypes.PluginContext,
	conn pkgtypes.Connection,
) (pkgtypes.Connection, error) {
	labels, err := structpb.NewStruct(conn.Labels)
	if err != nil {
		return pkgtypes.Connection{}, err
	}

	resp, err := r.client.UpdateConnection(ctx.Context, &proto.UpdateConnectionRequest{
		Id:          conn.ID,
		Name:        wrapperspb.String(conn.Name),
		Description: wrapperspb.String(conn.Description),
		Avatar:      wrapperspb.String(conn.Avatar),
		Labels:      labels,
	})
	if err != nil {
		return pkgtypes.Connection{}, err
	}

	return protoToConnection(resp), nil
}

func (r *ResourcePluginClient) DeleteConnection(
	ctx *pkgtypes.PluginContext,
	id string,
) error {
	_, err := r.client.DeleteConnection(ctx.Context, &proto.ConnectionRequest{
		Id: id,
	})
	return err
}
