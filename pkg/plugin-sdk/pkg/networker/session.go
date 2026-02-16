package networker

import (
	"log"
	"time"

	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/omniviewdev/plugin-sdk/proto"
)

type SessionState string

const (
	SessionStateActive  SessionState = "ACTIVE"
	SessionStatePaused  SessionState = "PAUSED"
	SessionStateStopped SessionState = "STOPPED"
	SessionStateFailed  SessionState = "FAILED"
)

func (s SessionState) String() string {
	return string(s)
}

func (s SessionState) ToProto() proto.PortForwardSession_SessionState {
	return proto.PortForwardSession_SessionState(
		proto.PortForwardSession_SessionState_value[s.String()],
	)
}

type PortForwardProtocol string

const (
	PortForwardProtocolTCP PortForwardProtocol = "TCP"
	PortForwardProtocolUDP PortForwardProtocol = "UDP"
)

func (p PortForwardProtocol) String() string {
	return string(p)
}

func (p PortForwardProtocol) ToProto() proto.PortForwardProtocol {
	return proto.PortForwardProtocol(
		proto.PortForwardProtocol_value[p.String()],
	)
}

type PortForwardConnectionType string

const (
	PortForwardConnectionTypeResource PortForwardConnectionType = "RESOURCE"
	PortForwardConnectionTypeStatic   PortForwardConnectionType = "STATIC"
)

func PortForwardProtocolFromProto(
	p proto.PortForwardProtocol,
) PortForwardProtocol {
	return PortForwardProtocol(p.String())
}

// ============================== PortForwardSession ============================== //

// PortForwardSession represents a session between a forwarding target and the host
// that initiated the session.
type PortForwardSession struct {
	CreatedAt      time.Time                    `json:"created_at"`
	UpdatedAt      time.Time                    `json:"updated_at"`
	Connection     any                          `json:"connection"`
	Labels         map[string]string            `json:"labels"`
	ID             string                       `json:"id"`
	Protocol       PortForwardProtocol          `json:"protocol"`
	State          SessionState                 `json:"state"`
	ConnectionType string                       `json:"connection_type"`
	Encryption     PortForwardSessionEncryption `json:"encryption"`
	LocalPort      int32                        `json:"local_port"`
	RemotePort     int32                        `json:"remote_port"`
}

func (s *PortForwardSession) ToProto() *proto.PortForwardSession {
	session := &proto.PortForwardSession{
		CreatedAt:  timestamppb.New(s.CreatedAt),
		UpdatedAt:  timestamppb.New(s.UpdatedAt),
		Labels:     s.Labels,
		Id:         s.ID,
		State:      s.State.ToProto(),
		Encryption: s.Encryption.ToProto(),
		LocalPort:  int32(s.LocalPort),
		RemotePort: int32(s.RemotePort),
	}

	switch c := s.Connection.(type) {
	case PortForwardResourceConnection:
		session.Connection = c.ToSessionProto()
	case PortForwardStaticConnection:
		session.Connection = c.ToSessionProto()
	}

	switch s.Protocol {
	case PortForwardProtocolTCP:
		session.Protocol = proto.PortForwardProtocol_TCP
	case PortForwardProtocolUDP:
		session.Protocol = proto.PortForwardProtocol_UDP
	}

	return session
}

// NewPortForwardSessionFromProto creates a PortForwardSession from a protobuf.
func NewPortForwardSessionFromProto(s *proto.PortForwardSession) *PortForwardSession {
	// switch on the connection type
	var connection interface{}
	var connectionType string
	switch s.GetConnection().(type) {
	case *proto.PortForwardSession_ResourceConnection:
		connection = PortForwardResourceConnectionFromProto(s.GetResourceConnection())
		connectionType = string(PortForwardConnectionTypeResource)
	case *proto.PortForwardSession_StaticConnection:
		connection = PortForwardStaticConnectionFromProto(s.GetStaticConnection())
		connectionType = string(PortForwardConnectionTypeStatic)
	}

	return &PortForwardSession{
		ID:             s.GetId(),
		CreatedAt:      s.GetCreatedAt().AsTime(),
		UpdatedAt:      s.GetUpdatedAt().AsTime(),
		Labels:         s.GetLabels(),
		State:          SessionState(s.GetState()),
		Encryption:     PortForwardSessionEncryptionFromProto(s.GetEncryption()),
		ConnectionType: connectionType,
		Connection:     connection,
		LocalPort:      s.GetLocalPort(),
		RemotePort:     s.GetRemotePort(),
	}
}

// ============================== PortForwardResourceConnection ============================== //

// PortForwardSessionConnectionOptions represents the options for a session connection.
type PortForwardResourceConnection struct {
	ResourceData map[string]interface{} `json:"resource_data"`
	ConnectionID string                 `json:"connection_id"`
	PluginID     string                 `json:"plugin_id"`
	ResourceID   string                 `json:"resource_id"`
	ResourceKey  string                 `json:"resource_key"`
}

func (c *PortForwardResourceConnection) ToProto() *proto.PortForwardResourceConnection {
	data, err := structpb.NewStruct(c.ResourceData)
	if err != nil {
		data, _ = structpb.NewStruct(map[string]interface{}{})
	}

	return &proto.PortForwardResourceConnection{
		ConnectionId: c.ConnectionID,
		PluginId:     c.PluginID,
		ResourceId:   c.ResourceID,
		ResourceKey:  c.ResourceKey,
		ResourceData: data,
	}
}

func (c *PortForwardResourceConnection) ToSessionProto() *proto.PortForwardSession_ResourceConnection {
	return &proto.PortForwardSession_ResourceConnection{
		ResourceConnection: c.ToProto(),
	}
}

func (c *PortForwardResourceConnection) ToSessionOptionsProto() *proto.PortForwardSessionOptions_ResourceConnection {
	return &proto.PortForwardSessionOptions_ResourceConnection{
		ResourceConnection: c.ToProto(),
	}
}

func PortForwardResourceConnectionFromProto(
	o *proto.PortForwardResourceConnection,
) PortForwardResourceConnection {
	return PortForwardResourceConnection{
		ConnectionID: o.GetConnectionId(),
		PluginID:     o.GetPluginId(),
		ResourceID:   o.GetResourceId(),
		ResourceKey:  o.GetResourceKey(),
		ResourceData: o.GetResourceData().AsMap(),
	}
}

func PortForwardResourceConnectionFromJson(o map[string]any) *PortForwardResourceConnection {
	conn := PortForwardResourceConnection{}

	if v, ok := o["connection_id"].(string); ok {
		conn.ConnectionID = v
	}
	if v, ok := o["plugin_id"].(string); ok {
		conn.PluginID = v
	}
	if v, ok := o["resource_id"].(string); ok {
		conn.ResourceID = v
	}
	if v, ok := o["resource_key"].(string); ok {
		conn.ResourceKey = v
	}
	if v, ok := o["resource_data"].(map[string]any); ok {
		conn.ResourceData = v
	}

	return &conn
}

// ============================== PortForwardStaticConnection ============================== //

type PortForwardStaticConnection struct {
	Address string `json:"address"`
}

func (c *PortForwardStaticConnection) ToProto() *proto.PortForwardStaticConnection {
	return &proto.PortForwardStaticConnection{
		Address: c.Address,
	}
}

func (c *PortForwardStaticConnection) ToSessionProto() *proto.PortForwardSession_StaticConnection {
	return &proto.PortForwardSession_StaticConnection{
		StaticConnection: c.ToProto(),
	}
}

func (c *PortForwardStaticConnection) ToSessionOptionsProto() *proto.PortForwardSessionOptions_StaticConnection {
	return &proto.PortForwardSessionOptions_StaticConnection{
		StaticConnection: c.ToProto(),
	}
}

func PortForwardStaticConnectionFromProto(
	o *proto.PortForwardStaticConnection,
) PortForwardStaticConnection {
	return PortForwardStaticConnection{
		Address: o.GetAddress(),
	}
}

// ============================== PortForwardSessionEncryption ============================== //

// PortForwardSessionEncryption represents the options for a session encryption
// configuration.
type PortForwardSessionEncryption struct {
	Algorithm string `json:"algorithm"`
	Key       string `json:"key"`
	Enabled   bool   `json:"enabled"`
}

func (o *PortForwardSessionEncryption) ToProto() *proto.PortForwardSessionEncryption {
	return &proto.PortForwardSessionEncryption{
		Enabled:   o.Enabled,
		Algorithm: o.Algorithm,
		Key:       o.Key,
	}
}

func PortForwardSessionEncryptionFromProto(
	o *proto.PortForwardSessionEncryption,
) PortForwardSessionEncryption {
	return PortForwardSessionEncryption{
		Enabled:   o.GetEnabled(),
		Algorithm: o.GetAlgorithm(),
		Key:       o.GetKey(),
	}
}

// ============================== PortForwardSessionOptions ============================== //

// PortForwardSessionOptions represents the options for creating a new forwarding
// session.
type PortForwardSessionOptions struct {
	Connection     interface{}                  `json:"connection"`
	Labels         map[string]string            `json:"labels"`
	Params         map[string]string            `json:"params"`
	Protocol       PortForwardProtocol          `json:"protocol"`
	ConnectionType PortForwardConnectionType    `json:"connection_type"`
	Encryption     PortForwardSessionEncryption `json:"encryption"`
	LocalPort      int32                        `json:"local_port"`
	RemotePort     int32                        `json:"remote_port"`
}

type ResourcePortForwardHandlerOpts struct {
	Resource PortForwardResourceConnection `json:"resource"`
	Options  PortForwardSessionOptions     `json:"options"`
}

type StaticPortForwardHandlerOpts struct {
	Static  PortForwardStaticConnection `json:"static"`
	Options PortForwardSessionOptions   `json:"options"`
}

func (o *PortForwardSessionOptions) ToProto() *proto.PortForwardSessionOptions {
	log.Printf("got options: %v\n", o)
	log.Printf("%T\n", o.Connection)

	opts := &proto.PortForwardSessionOptions{
		LocalPort:  o.LocalPort,
		RemotePort: o.RemotePort,
		Protocol:   o.Protocol.ToProto(),
		Labels:     o.Labels,
		Params:     o.Params,
		Encryption: o.Encryption.ToProto(),
	}

	switch o.ConnectionType {
	// case PortForwardResourceConnection:
	// 	opts.Connection = c.ToSessionOptionsProto()
	// case PortForwardStaticConnection:
	// 	opts.Connection = c.ToSessionOptionsProto()
	case PortForwardConnectionTypeResource:
		if v, ok := o.Connection.(map[string]any); ok {
			opts.Connection = PortForwardResourceConnectionFromJson(v).ToSessionOptionsProto()
		}
	}

	return opts
}

func NewPortForwardSessionOptionsFromProto(
	o *proto.PortForwardSessionOptions,
) *PortForwardSessionOptions {
	// switch on the connection type
	var connection interface{}
	var connectionType PortForwardConnectionType
	switch o.GetConnection().(type) {
	case *proto.PortForwardSessionOptions_ResourceConnection:
		connection = PortForwardResourceConnectionFromProto(o.GetResourceConnection())
		connectionType = PortForwardConnectionTypeResource
	case *proto.PortForwardSessionOptions_StaticConnection:
		connection = PortForwardStaticConnectionFromProto(o.GetStaticConnection())
		connectionType = PortForwardConnectionTypeStatic
	default:
		connectionType = PortForwardConnectionTypeResource
	}

	return &PortForwardSessionOptions{
		LocalPort:      o.GetLocalPort(),
		RemotePort:     o.GetRemotePort(),
		Protocol:       PortForwardProtocolFromProto(o.GetProtocol()),
		Labels:         o.GetLabels(),
		Params:         o.GetParams(),
		Encryption:     PortForwardSessionEncryptionFromProto(o.GetEncryption()),
		Connection:     connection,
		ConnectionType: connectionType,
	}
}

// ============================== FindPortForwardSessionRequest ============================== //

type FindPortForwardSessionRequest struct {
	ResourceID   string `json:"resource_id"`
	ConnectionID string `json:"connection_id"`
}

func (p FindPortForwardSessionRequest) ToProto() *proto.FindPortForwardSessionRequest {
	return &proto.FindPortForwardSessionRequest{
		ResourceId:   p.ResourceID,
		ConnectionId: p.ConnectionID,
	}
}

func NewFindPortForwardSessionRequestFromProto(
	p *proto.FindPortForwardSessionRequest,
) FindPortForwardSessionRequest {
	return FindPortForwardSessionRequest{
		ResourceID:   p.GetResourceId(),
		ConnectionID: p.GetConnectionId(),
	}
}
