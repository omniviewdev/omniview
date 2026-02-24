package metric

import (
	"context"
	"errors"
	"io"
	"log"

	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

type PluginClient struct {
	client proto.MetricPluginClient
}

var _ Provider = (*PluginClient)(nil)

func (c *PluginClient) GetSupportedResources(ctx *types.PluginContext) (*ProviderInfo, []Handler) {
	resp, err := c.client.GetSupportedResources(
		types.WithPluginContext(context.Background(), ctx),
		&emptypb.Empty{},
	)
	if err != nil {
		return nil, nil
	}

	info := ProviderInfoFromProto(resp.GetProvider())
	protoHandlers := resp.GetHandlers()
	handlers := make([]Handler, 0, len(protoHandlers))
	for _, h := range protoHandlers {
		handlers = append(handlers, HandlerFromProto(h))
	}
	return &info, handlers
}

func (c *PluginClient) Query(
	ctx *types.PluginContext,
	req QueryRequest,
) (*QueryResponse, error) {
	var resourceData *structpb.Struct
	if req.ResourceData != nil {
		var err error
		resourceData, err = structpb.NewStruct(req.ResourceData)
		if err != nil {
			return nil, err
		}
	}

	protoReq := &proto.QueryMetricsRequest{
		ResourceKey:       req.ResourceKey,
		ResourceId:        req.ResourceID,
		ResourceNamespace: req.ResourceNamespace,
		ResourceData:      resourceData,
		MetricIds:         req.MetricIDs,
		Shape:             req.Shape.ToProto(),
		Params:            req.Params,
	}
	if !req.StartTime.IsZero() {
		protoReq.StartTime = timestamppb.New(req.StartTime)
	}
	if !req.EndTime.IsZero() {
		protoReq.EndTime = timestamppb.New(req.EndTime)
	}
	if req.Step > 0 {
		protoReq.Step = durationpb.New(req.Step)
	}

	resp, err := c.client.Query(
		types.WithPluginContext(context.Background(), ctx),
		protoReq,
	)
	if err != nil {
		return nil, err
	}

	return QueryResponseFromProto(resp), nil
}

func (c *PluginClient) StreamMetrics(
	ctx context.Context,
	in chan StreamInput,
) (chan StreamOutput, error) {
	stream, err := c.client.StreamMetrics(ctx)
	if err != nil {
		return nil, err
	}

	out := make(chan StreamOutput)

	// sender
	go func() {
		defer close(out)
		for i := range in {
			if err := stream.Send(streamInputToProto(i)); err != nil {
				log.Printf("failed to send metric stream input: %v", err)
				return
			}
		}
		if err := stream.CloseSend(); err != nil {
			log.Printf("failed to close send metric stream: %v", err)
		}
	}()

	// receiver
	go func() {
		for {
			resp, err := stream.Recv()
			if errors.Is(err, io.EOF) {
				return
			}
			if err != nil {
				log.Printf("failed to receive metric stream output: %v", err)
				return
			}

			results := make([]MetricResult, 0, len(resp.GetResults()))
			for _, r := range resp.GetResults() {
				results = append(results, MetricResultFromProto(r))
			}

			var ts = resp.GetTimestamp().AsTime()

			out <- StreamOutput{
				SubscriptionID: resp.GetSubscriptionId(),
				Results:        results,
				Timestamp:      ts,
				Error:          resp.GetError(),
			}
		}
	}()

	return out, nil
}
