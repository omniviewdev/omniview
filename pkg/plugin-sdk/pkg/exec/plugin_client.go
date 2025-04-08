package exec

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"

	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

type PluginClient struct {
	client proto.ExecPluginClient
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

func (c *PluginClient) GetSession(
	ctx *types.PluginContext,
	sessionID string,
) (*Session, error) {
	resp, err := c.client.GetSession(
		types.WithPluginContext(context.Background(), ctx),
		&proto.GetSessionRequest{Id: sessionID},
	)
	if err != nil {
		return nil, err
	}
	return NewSessionFromProto(resp.GetSession()), nil
}

func (c *PluginClient) ListSessions(ctx *types.PluginContext) ([]*Session, error) {
	resp, err := c.client.ListSessions(
		types.WithPluginContext(context.Background(), ctx),
		&emptypb.Empty{},
	)
	if err != nil {
		return nil, err
	}
	protos := resp.GetSessions()
	sessions := make([]*Session, 0, len(protos))
	for _, s := range protos {
		sessions = append(sessions, NewSessionFromProto(s))
	}
	return sessions, nil
}

func (c *PluginClient) CreateSession(
	ctx *types.PluginContext,
	opts SessionOptions,
) (*Session, error) {
	resp, err := c.client.CreateSession(
		types.WithPluginContext(context.Background(), ctx),
		opts.ToProto(),
	)
	if err != nil {
		return nil, err
	}
	return NewSessionFromProto(resp.GetSession()), nil
}

func (c *PluginClient) AttachSession(
	ctx *types.PluginContext,
	sessionID string,
) (*Session, []byte, error) {
	resp, err := c.client.AttachSession(
		types.WithPluginContext(context.Background(), ctx),
		&proto.AttachSessionRequest{Id: sessionID},
	)
	if err != nil {
		return nil, nil, err
	}
	return NewSessionFromProto(resp.GetSession()), resp.GetBuffer(), nil
}

func (c *PluginClient) DetachSession(
	ctx *types.PluginContext,
	sessionID string,
) (*Session, error) {
	resp, err := c.client.DetachSession(
		types.WithPluginContext(context.Background(), ctx),
		&proto.AttachSessionRequest{Id: sessionID},
	)
	if err != nil {
		return nil, err
	}
	return NewSessionFromProto(resp.GetSession()), nil
}

func (c *PluginClient) CloseSession(ctx *types.PluginContext, sessionID string) error {
	_, err := c.client.CloseSession(
		types.WithPluginContext(context.Background(), ctx),
		&proto.CloseSessionRequest{Id: sessionID},
	)
	return err
}

func (c *PluginClient) ResizeSession(
	ctx *types.PluginContext,
	sessionID string,
	cols, rows int32,
) error {
	_, err := c.client.ResizeSession(
		types.WithPluginContext(context.Background(), ctx),
		&proto.ResizeSessionRequest{Id: sessionID, Cols: cols, Rows: rows},
	)
	return err
}

func (c *PluginClient) Stream(
	ctx context.Context,
	in chan StreamInput,
) (chan StreamOutput, error) {
	stream, err := c.client.Stream(ctx)
	if err != nil {
		return nil, err
	}

	log.Println("STREAMING")

	out := make(chan StreamOutput)

	// sender
	go func() {
		defer close(out)
		for i := range in {
			if err = stream.Send(i.ToProto()); err != nil {
				log.Println(fmt.Printf("failed to send stream input: %v", err))
				return
			}
		}
		if err = stream.CloseSend(); err != nil {
			log.Printf("failed to close send stream: %v", err)
		}
	}()

	// receiver
	go func() {
		for {
			var resp *proto.StreamOutput
			resp, err = stream.Recv()
			if errors.Is(err, io.EOF) {
				return // End of stream
			}
			if err != nil {
				log.Printf("failed to receive stream output: %v", err)
				return
			}
			out <- NewStreamOutputFromProto(resp)
		}
	}()
	return out, nil
}
