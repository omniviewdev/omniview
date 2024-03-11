package plugin

import (
	"context"

	"github.com/omniviewdev/plugin/pkg/resource/types"
	"github.com/omniviewdev/plugin/proto"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
)

// ResourcePluginClient is the real client implementation for ResourcePlugin.
type ResourcePluginClient struct {
	client proto.ResourcePluginClient
}

//	func (r *ResourcePluginClient) RegisterPreGetHook(req types.PreHook[types.GetInput]) error {
//		resp := struct{}{}
//		if err := r.client.Call("Plugin.RegisterPreGetHook", &req, &resp); err != nil {
//			panic(err)
//		}
//		return nil
//	}
//
//	func (r *ResourcePluginClient) RegisterPreListHook(req types.PreHook[types.ListInput]) error {
//		resp := struct{}{}
//		if err := r.client.Call("Plugin.RegisterPreListHook", &req, &resp); err != nil {
//			panic(err)
//		}
//		return nil
//	}
//
//	func (r *ResourcePluginClient) RegisterPreFindHook(req types.PreHook[types.FindInput]) error {
//		resp := struct{}{}
//		if err := r.client.Call("Plugin.RegisterPreFindHook", &req, &resp); err != nil {
//			panic(err)
//		}
//		return nil
//	}
//
//	func (r *ResourcePluginClient) RegisterPreCreateHook(req types.PreHook[types.CreateInput]) error {
//		resp := struct{}{}
//		if err := r.client.Call("Plugin.RegisterPreCreateHook", &req, &resp); err != nil {
//			panic(err)
//		}
//		return nil
//	}
//
//	func (r *ResourcePluginClient) RegisterPreUpdateHook(req types.PreHook[types.UpdateInput]) error {
//		resp := struct{}{}
//		if err := r.client.Call("Plugin.RegisterPreUpdateHook", &req, &resp); err != nil {
//			panic(err)
//		}
//		return nil
//	}
//
//	func (r *ResourcePluginClient) RegisterPreDeleteHook(req types.PreHook[types.DeleteInput]) error {
//		resp := struct{}{}
//		if err := r.client.Call("Plugin.RegisterPreDeleteHook", &req, &resp); err != nil {
//			panic(err)
//		}
//		return nil
//	}
//
//	func (r *ResourcePluginClient) RegisterPostGetHook(req types.PostHook[types.GetResult]) error {
//		resp := struct{}{}
//		if err := r.client.Call("Plugin.RegisterPostGetHook", &req, &resp); err != nil {
//			panic(err)
//		}
//		return nil
//	}
//
//	func (r *ResourcePluginClient) RegisterPostListHook(req types.PostHook[types.ListResult]) error {
//		resp := struct{}{}
//		if err := r.client.Call("Plugin.RegisterPostListHook", &req, &resp); err != nil {
//			panic(err)
//		}
//		return nil
//	}
//
//	func (r *ResourcePluginClient) RegisterPostFindHook(req types.PostHook[types.FindResult]) error {
//		resp := struct{}{}
//		if err := r.client.Call("Plugin.RegisterPostFindHook", &req, &resp); err != nil {
//			panic(err)
//		}
//		return nil
//	}
//
// func (r *ResourcePluginClient) RegisterPostCreateHook(
//
//	req types.PostHook[types.CreateResult],
//
//	) error {
//		resp := struct{}{}
//		if err := r.client.Call("Plugin.RegisterPostCreateHook", &req, &resp); err != nil {
//			panic(err)
//		}
//		return nil
//	}
//
// func (r *ResourcePluginClient) RegisterPostUpdateHook(
//
//	req types.PostHook[types.UpdateResult],
//
//	) error {
//		resp := struct{}{}
//		if err := r.client.Call("Plugin.RegisterPostUpdateHook", &req, &resp); err != nil {
//			panic(err)
//		}
//		return nil
//	}
//
// func (r *ResourcePluginClient) RegisterPostDeleteHook(
//
//	req types.PostHook[types.DeleteResult],
//
//	) error {
//		resp := struct{}{}
//		if err := r.client.Call("Plugin.RegisterPostDeleteHook", &req, &resp); err != nil {
//			panic(err)
//		}
//		return nil
//	}
func (r *ResourcePluginClient) Get(
	key string,
	contextID string,
	input types.GetInput,
) (*types.GetResult, error) {
	resp, err := r.client.Get(context.Background(), &proto.GetRequest{
		Key:       key,
		Context:   contextID,
		Id:        input.ID,
		Namespace: input.PartitionID,
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
	key string,
	contextID string,
	input types.ListInput,
) (*types.ListResult, error) {
	resp, err := r.client.List(context.Background(), &proto.ListRequest{
		Key:        key,
		Context:    contextID,
		Namespaces: input.PartitionIDs,
	})
	if err != nil {
		return nil, err
	}

	data := resp.GetData()
	result := &types.ListResult{
		Result:  make([]map[string]interface{}, 0, len(data)),
		Success: resp.GetSuccess(),
	}

	for _, data := range data {
		result.Result = append(result.Result, data.AsMap())
	}

	return result, nil
}

func (r *ResourcePluginClient) Find(
	key string,
	contextID string,
	input types.FindInput,
) (*types.FindResult, error) {
	resp, err := r.client.Find(context.Background(), &proto.FindRequest{
		Key:        key,
		Context:    contextID,
		Namespaces: input.PartitionIDs,
	})
	if err != nil {
		return nil, err
	}

	data := resp.GetData()
	result := &types.FindResult{
		Result:  make([]map[string]interface{}, 0, len(data)),
		Success: resp.GetSuccess(),
	}
	for _, data := range data {
		result.Result = append(result.Result, data.AsMap())
	}

	return result, nil
}

func (r *ResourcePluginClient) Create(
	key string,
	contextID string,
	input types.CreateInput,
) (*types.CreateResult, error) {
	data, err := structpb.NewStruct(input.Input)
	if err != nil {
		return nil, err
	}

	resp, err := r.client.Create(context.Background(), &proto.CreateRequest{
		Key:       key,
		Context:   contextID,
		Namespace: input.PartitionID,
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
	key string,
	contextID string,
	input types.UpdateInput,
) (*types.UpdateResult, error) {
	data, err := structpb.NewStruct(input.Input)
	if err != nil {
		return nil, err
	}

	resp, err := r.client.Update(context.Background(), &proto.UpdateRequest{
		Key:       key,
		Context:   contextID,
		Id:        input.ID,
		Namespace: input.PartitionID,
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
	key string,
	contextID string,
	input types.DeleteInput,
) (*types.DeleteResult, error) {
	resp, err := r.client.Delete(context.Background(), &proto.DeleteRequest{
		Key:       key,
		Context:   contextID,
		Id:        input.ID,
		Namespace: input.PartitionID,
	})
	if err != nil {
		return nil, err
	}

	return &types.DeleteResult{
		Result:  resp.GetData().AsMap(),
		Success: resp.GetSuccess(),
	}, nil
}

func (r *ResourcePluginClient) StartContextInformer(
	key string,
	contextID string,
) error {
	_, err := r.client.StartContextInformer(
		context.Background(),
		&proto.StartContextInformerRequest{
			Key:     key,
			Context: contextID,
		},
	)
	return err
}

func (r *ResourcePluginClient) StopContextInformer(
	key string,
	contextID string,
) error {
	_, err := r.client.StopContextInformer(
		context.Background(),
		&proto.StopContextInformerRequest{
			Key:     key,
			Context: contextID,
		},
	)
	return err
}

// ListenForEvents listens for events from the resource provider
// and pipes them back to the event subsystem, stopping when stopCh is closed.
// This method is blocking, and should be run as part of the resourcer
// controller's event loop.
func (r *ResourcePluginClient) ListenForEvents(
	ctx context.Context,
	addStream chan types.InformerAddPayload,
	updateStream chan types.InformerUpdatePayload,
	deleteStream chan types.InformerDeletePayload,
) error {
	stream, err := r.client.ListenForEvents(context.Background(), &emptypb.Empty{})
	if err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
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
					Key:       msg.GetKey(),
					Context:   msg.GetContext(),
					ID:        add.GetId(),
					Namespace: add.GetNamespace(),
					Data:      add.GetData().AsMap(),
				}
			case *proto.InformerEvent_Update:
				update := msg.GetUpdate()
				updateStream <- types.InformerUpdatePayload{
					Key:       msg.GetKey(),
					Context:   msg.GetContext(),
					ID:        update.GetId(),
					Namespace: update.GetNamespace(),
					OldData:   update.GetOldData().AsMap(),
					NewData:   update.GetNewData().AsMap(),
				}
			case *proto.InformerEvent_Delete:
				del := msg.GetDelete()
				deleteStream <- types.InformerDeletePayload{
					Key:       msg.GetKey(),
					Context:   msg.GetContext(),
					ID:        del.GetId(),
					Namespace: del.GetNamespace(),
				}
			}
		}
	}
}
