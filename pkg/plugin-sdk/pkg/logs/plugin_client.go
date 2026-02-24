package logs

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"

	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

type PluginClient struct {
	client proto.LogPluginClient
}

var _ Provider = (*PluginClient)(nil)

func (c *PluginClient) GetSupportedResources(ctx *types.PluginContext) []Handler {
	resp, err := c.client.GetSupportedResources(
		types.WithPluginContext(context.Background(), ctx),
		&emptypb.Empty{},
	)
	if err != nil {
		return nil
	}
	handlers := resp.GetHandlers()

	result := make([]Handler, 0, len(handlers))
	for _, h := range handlers {
		result = append(result, HandlerFromProto(h))
	}
	return result
}

func (c *PluginClient) CreateSession(
	ctx *types.PluginContext,
	opts CreateSessionOptions,
) (*LogSession, error) {
	data, err := structpb.NewStruct(opts.ResourceData)
	if err != nil {
		return nil, fmt.Errorf("failed to convert resource data: %w", err)
	}

	resp, err := c.client.CreateSession(
		types.WithPluginContext(context.Background(), ctx),
		&proto.CreateLogSessionRequest{
			ResourceKey:  opts.ResourceKey,
			ResourceId:   opts.ResourceID,
			ResourceData: data,
			Options:      opts.Options.ToProto(),
		},
	)
	if err != nil {
		return nil, err
	}
	return LogSessionFromProto(resp.GetSession()), nil
}

func (c *PluginClient) GetSession(
	ctx *types.PluginContext,
	sessionID string,
) (*LogSession, error) {
	resp, err := c.client.GetSession(
		types.WithPluginContext(context.Background(), ctx),
		&proto.LogSessionByIdRequest{SessionId: sessionID},
	)
	if err != nil {
		return nil, err
	}
	return LogSessionFromProto(resp.GetSession()), nil
}

func (c *PluginClient) ListSessions(ctx *types.PluginContext) ([]*LogSession, error) {
	resp, err := c.client.ListSessions(
		types.WithPluginContext(context.Background(), ctx),
		&emptypb.Empty{},
	)
	if err != nil {
		return nil, err
	}
	protos := resp.GetSessions()
	sessions := make([]*LogSession, 0, len(protos))
	for _, s := range protos {
		sessions = append(sessions, LogSessionFromProto(s))
	}
	return sessions, nil
}

func (c *PluginClient) CloseSession(ctx *types.PluginContext, sessionID string) error {
	_, err := c.client.CloseSession(
		types.WithPluginContext(context.Background(), ctx),
		&proto.LogSessionByIdRequest{SessionId: sessionID},
	)
	return err
}

func (c *PluginClient) UpdateSessionOptions(
	ctx *types.PluginContext,
	sessionID string,
	opts LogSessionOptions,
) (*LogSession, error) {
	resp, err := c.client.UpdateSessionOptions(
		types.WithPluginContext(context.Background(), ctx),
		&proto.UpdateLogSessionOptionsRequest{
			SessionId: sessionID,
			Options:   opts.ToProto(),
		},
	)
	if err != nil {
		return nil, err
	}
	return LogSessionFromProto(resp.GetSession()), nil
}

func (c *PluginClient) Stream(
	ctx context.Context,
	in chan StreamInput,
) (chan StreamOutput, error) {
	stream, err := c.client.Stream(ctx)
	if err != nil {
		return nil, err
	}

	out := make(chan StreamOutput)

	// sender
	go func() {
		defer close(out)
		for i := range in {
			if err := stream.Send(i.ToProto()); err != nil {
				log.Printf("failed to send log stream input: %v", err)
				return
			}
		}
		if err := stream.CloseSend(); err != nil {
			log.Printf("failed to close send log stream: %v", err)
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
				log.Printf("failed to receive log stream output: %v", err)
				return
			}

			output := StreamOutput{
				SessionID: resp.GetSessionId(),
			}

			switch payload := resp.GetPayload().(type) {
			case *proto.LogStreamOutput_Line:
				line := LogLineFromProto(payload.Line)
				output.Line = &line
			case *proto.LogStreamOutput_Event:
				event := LogStreamEventFromProto(payload.Event)
				output.Event = &event
			}

			out <- output
		}
	}()

	return out, nil
}
