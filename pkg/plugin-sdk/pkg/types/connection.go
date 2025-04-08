package types

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

const (
	ConnectionDefaultExpiryTime = time.Hour * 24
)

// prevent collisions in context values.
type connectionCtxKey struct{}

type ConnectionContext Connection

// Connection holds the current state (and configuration data) for an
// connection target for a plugin (e.g. a Kubernetes cluster, a cloud role, etc)
//
// This will be passed within the PluginContext so that it may be used across all requests,
// and data here not within the sensitiveStore will be exposed to the user in the UI for the
// plugin.
type Connection struct {
	// LastRefresh is the time when the auth context was last refreshed
	// +optional
	LastRefresh time.Time `json:"last_refresh"`

	// Data is an optional map of arbitrary data that can be used to store additional information about the connection,
	// such as credential file locations, etc.
	//
	// This data is exposed to the user in the UI under the settings panel for the namespace. If the data is sensitive,
	// it should be stored in the SensitiveData field.
	// +optional
	Data map[string]interface{} `json:"data"`

	// SensitiveData is an optional map of arbitrary data that can be used to store additional information about the
	// connection. This information is not exposed to the client in the UI, and can be used to store information that is
	// is only necessary within the plugin context, such as credentials necessary to create a client.
	// +optional
	sensitiveData map[string]interface{} `json:"-"`

	// Labels is a map of arbitrary key-value pairs that can be used to store additional information about the connection.
	// Users will likely use and modify these labels to help organize and categorize their connections.
	Labels map[string]interface{} `json:"labels"`

	// ID is the unique identifier for the connection that makes sense to the plugin implementation.
	// +required
	ID string `json:"id"`

	// UID is an autogenerated unique identifier for the connection that the IDE will use to identify and track.
	UID string `json:"uid"`

	// Name is the readable name of the connection. Editable by the user.
	// +required
	Name string `json:"name"`

	// Description is an optional description of the connection. This is primarily for the user to customize
	// the visual representation of the connection.
	// +optional
	Description string `json:"description"`

	// Avatar is an optional image that can be used to represent the connection. This is primarily for the user to customize
	// the visual representation of the connection in the UI.
	// +optional
	Avatar string `json:"avatar"`

	// ExpiryTime is the amount of time before the connection expires.
	// +optional
	ExpiryTime time.Duration `json:"expiry_time"`
}

func (c *Connection) GetSensitiveData() map[string]interface{} {
	return c.sensitiveData
}

func (c *Connection) SetSensitiveData(data map[string]interface{}) {
	c.sensitiveData = data
}

func (c *Connection) SetSensitiveDataKey(key string, value interface{}) {
	c.sensitiveData[key] = value
}

func (c *Connection) GetSensitiveDataKey(key string) (interface{}, bool) {
	val, ok := c.sensitiveData[key]
	return val, ok
}

func (c *Connection) GetData() map[string]interface{} {
	return c.Data
}

func (c *Connection) SetData(data map[string]interface{}) {
	c.Data = data
}

func (c *Connection) GetDataKey(key string) (interface{}, bool) {
	val, ok := c.Data[key]
	return val, ok
}

func (c *Connection) SetDataKey(key string, value interface{}) {
	c.Data[key] = value
}

// IsAuthed returns whether the auth context is authenticated or not.
func (c *Connection) IsAuthed() bool {
	return c.ExpiryTime > 0 && time.Now().Before(c.LastRefresh.Add(c.ExpiryTime))
}

type ConnectionOpts struct {
	// Data is an optional map of arbitrary data that can be used to store additional information about the namespace.
	Data map[string]interface{}

	// SensitiveData is an optional map of arbitrary data that can be used to store additional information about the
	SensitiveData map[string]interface{}

	// Labels is a map of arbitrary key-value pairs that can be used to store additional information about the namespace.
	Labels map[string]interface{}

	// ID is the unique identifier for the authorization context that makes sense to the
	ID string

	// UID is an autogenerated unique identifier for the authorization context that the IDE.
	// will use to identify the authorization context.
	UID string

	// Name is the readable name of the namespace.
	Name string

	// Description is an optional description of the namespace. This is primarily for the user to customize
	Description string

	// Avatar is an optional image that can be used to represent the namespace. This is primarily for the user to customize
	Avatar string

	// ExpiryTime is the amount of time before the auth context expires
	ExpiryTime time.Duration
}

func NewConnection(opts ConnectionOpts) (*Connection, error) {
	if opts.ID == "" {
		return nil, errors.New("ID is required when creating an authorization context")
	}
	if opts.Name == "" {
		opts.ID = opts.Name
	}
	if opts.UID == "" {
		opts.UID = uuid.New().String()
	}
	if opts.Data == nil {
		opts.Data = make(map[string]interface{})
	}
	if opts.Labels == nil {
		opts.Labels = make(map[string]interface{})
	}
	if opts.SensitiveData == nil {
		opts.SensitiveData = make(map[string]interface{})
	}
	if opts.ExpiryTime == 0 {
		// default to 24 hours
		opts.ExpiryTime = ConnectionDefaultExpiryTime
	}

	return &Connection{
		ID:            opts.ID,
		UID:           opts.UID,
		Name:          opts.Name,
		Description:   opts.Description,
		Avatar:        opts.Avatar,
		Data:          opts.Data,
		sensitiveData: opts.SensitiveData,
		ExpiryTime:    opts.ExpiryTime,
		Labels:        opts.Labels,
	}, nil
}

func ConnectionFromContext(ctx context.Context) *Connection {
	if ctx == nil {
		return nil
	}
	if c, ok := ctx.Value(connectionCtxKey{}).(*Connection); ok {
		return c
	}
	return nil
}

func WithConnection(ctx context.Context, c *Connection) context.Context {
	return context.WithValue(ctx, connectionCtxKey{}, c)
}

type ConnectionStatusCode string

const (
	ConnectionStatusUnknown               ConnectionStatusCode = "UNKNOWN"
	ConnectionStatusConnected             ConnectionStatusCode = "CONNECTED"
	ConnectionStatusDisconnected          ConnectionStatusCode = "DISCONNECTED"
	ConnectionStatusPending               ConnectionStatusCode = "PENDING"
	ConnectionStatusFailed                ConnectionStatusCode = "FAILED"
	ConnectionStatusError                 ConnectionStatusCode = "ERROR"
	ConnectionStatusUnauthorized          ConnectionStatusCode = "UNAUTHORIZED"
	ConnectionStatusForbidden             ConnectionStatusCode = "FORBIDDEN"
	ConnectionStatusBadRequest            ConnectionStatusCode = "BAD_REQUEST"
	ConnectionStatusNotFound              ConnectionStatusCode = "NOT_FOUND"
	ConnectionStatusTimeout               ConnectionStatusCode = "TIMEOUT"
	ConnectionStatusUnavailable           ConnectionStatusCode = "UNAVAILABLE"
	ConnectionStatusRequestEntityTooLarge ConnectionStatusCode = "REQUEST_ENTITY_TOO_LARGE"
)

type ConnectionStatus struct {
	// Connection is the connection that the status is for.
	Connection *Connection `json:"connection"`
	// StatusCode is the status code of the connection status.
	Status ConnectionStatusCode `json:"status"`
	// Error is the error that occurred when checking the connection status.
	Error string `json:"error"`
	// Message is a human readable message that describes the status.
	Details string `json:"details"`
}

// AllConnectionStatusCodes is a list of all setting types. Necessary for Wails
// to bind the enums.
//
//nolint:gochecknoglobals // this is a necessary for enum binding
var AllConnectionStatusCodes = []struct {
	Value  ConnectionStatusCode
	TSName string
}{
	{ConnectionStatusUnknown, "UNKNOWN"},
	{ConnectionStatusConnected, "CONNECTED"},
	{ConnectionStatusDisconnected, "DISCONNECTED"},
	{ConnectionStatusPending, "PENDING"},
	{ConnectionStatusFailed, "FAILED"},
	{ConnectionStatusError, "ERROR"},
	{ConnectionStatusUnauthorized, "UNAUTHORIZED"},
	{ConnectionStatusForbidden, "FORBIDDEN"},
	{ConnectionStatusBadRequest, "BAD_REQUEST"},
	{ConnectionStatusNotFound, "NOT_FOUND"},
	{ConnectionStatusTimeout, "TIMEOUT"},
	{ConnectionStatusUnavailable, "UNAVAILABLE"},
	{ConnectionStatusRequestEntityTooLarge, "REQUEST_ENTITY_TOO_LARGE"},
}
