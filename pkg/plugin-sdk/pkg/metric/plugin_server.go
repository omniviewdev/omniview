package metric

import (
	"context"
	"errors"
	"io"
	"log"

	"github.com/hashicorp/go-hclog"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

type PluginServer struct {
	log  hclog.Logger
	Impl Provider
}

func (s *PluginServer) GetSupportedResources(
	ctx context.Context,
	_ *emptypb.Empty,
) (*proto.GetSupportedMetricResourcesResponse, error) {
	info, handlers := s.Impl.GetSupportedResources(types.PluginContextFromContext(ctx))

	protoHandlers := make([]*proto.MetricHandler, 0, len(handlers))
	for i := range handlers {
		protoHandlers = append(protoHandlers, handlers[i].ToProto())
	}

	return &proto.GetSupportedMetricResourcesResponse{
		Provider: info.ToProto(),
		Handlers: protoHandlers,
	}, nil
}

func (s *PluginServer) Query(
	ctx context.Context,
	in *proto.QueryMetricsRequest,
) (*proto.QueryMetricsResponse, error) {
	if in == nil {
		return nil, status.Errorf(codes.InvalidArgument, "request is nil")
	}

	req := QueryRequest{
		ResourceKey:       in.GetResourceKey(),
		ResourceID:        in.GetResourceId(),
		ResourceNamespace: in.GetResourceNamespace(),
		ResourceData:      in.GetResourceData().AsMap(),
		MetricIDs:         in.GetMetricIds(),
		Shape:             MetricShapeFromProto(in.GetShape()),
		Params:            in.GetParams(),
	}
	if in.GetStartTime() != nil {
		req.StartTime = in.GetStartTime().AsTime()
	}
	if in.GetEndTime() != nil {
		req.EndTime = in.GetEndTime().AsTime()
	}
	if in.GetStep() != nil {
		req.Step = in.GetStep().AsDuration()
	}

	resp, err := s.Impl.Query(types.PluginContextFromContext(ctx), req)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to query metrics: %v", err)
	}

	return resp.ToProto(), nil
}

func (s *PluginServer) StreamMetrics(stream proto.MetricPlugin_StreamMetricsServer) error {
	ctx, cancel := context.WithCancel(stream.Context())
	defer cancel()

	multiplexer := make(chan StreamInput)
	out, err := s.Impl.StreamMetrics(ctx, multiplexer)
	if err != nil {
		return err
	}

	// handle the output
	go s.handleOut(ctx, out, stream)

	// handle the input
	for {
		var in *proto.MetricStreamInput
		in, err = stream.Recv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			log.Printf("failed to receive metric stream: %v", err)
			continue
		}
		multiplexer <- streamInputFromProto(in)
	}
}

func (s *PluginServer) handleOut(
	ctx context.Context,
	out <-chan StreamOutput,
	stream proto.MetricPlugin_StreamMetricsServer,
) {
	for {
		select {
		case <-ctx.Done():
			return
		case output := <-out:
			results := make([]*proto.MetricResult, 0, len(output.Results))
			for i := range output.Results {
				results = append(results, output.Results[i].ToProto())
			}

			msg := &proto.MetricStreamOutput{
				SubscriptionId: output.SubscriptionID,
				Results:        results,
				Timestamp:      timestamppb.New(output.Timestamp),
				Error:          output.Error,
			}

			if err := stream.Send(msg); err != nil {
				if ctx.Err() == context.Canceled {
					return
				}
			}
		}
	}
}

func streamInputFromProto(p *proto.MetricStreamInput) StreamInput {
	si := StreamInput{
		SubscriptionID:    p.GetSubscriptionId(),
		Command:           MetricStreamCommandFromProto(p.GetCommand()),
		ResourceKey:       p.GetResourceKey(),
		ResourceID:        p.GetResourceId(),
		ResourceNamespace: p.GetResourceNamespace(),
		MetricIDs:         p.GetMetricIds(),
	}
	if p.GetResourceData() != nil {
		si.ResourceData = p.GetResourceData().AsMap()
	}
	if p.GetInterval() != nil {
		si.Interval = p.GetInterval().AsDuration()
	}
	return si
}

func streamInputToProto(si StreamInput) *proto.MetricStreamInput {
	p := &proto.MetricStreamInput{
		SubscriptionId:    si.SubscriptionID,
		Command:           si.Command.ToProto(),
		ResourceKey:       si.ResourceKey,
		ResourceId:        si.ResourceID,
		ResourceNamespace: si.ResourceNamespace,
		MetricIds:         si.MetricIDs,
		Interval:          durationpb.New(si.Interval),
	}
	if si.ResourceData != nil {
		data, err := structpb.NewStruct(si.ResourceData)
		if err == nil {
			p.ResourceData = data
		}
	}
	return p
}
