package types

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

const (
	DefaultExpiryTime = time.Hour * 24
)

// AuthContext holds the current state (and configuration data) for an
// authenticatable target for a plugin (e.g. a Kubernetes cluster, a cloud role, etc)
//
// This will be passed within the PluginContext so that it may be used across all requests,
// and data here not within the sensitiveStore will be exposed to the user in the UI for the
// plugin.
type AuthorizationContext struct {
	// LastRefresh is the time when the auth context was last refreshed
	// +optional
	LastRefresh time.Time `json:"last_refresh"`

	// Data is an optional map of arbitrary data that can be used to store additional information about the namespace.
	// This is data that should be used to store additional information about the namespace, such as credential file
	// locations, or other information that is necessary to create a client for the namespace.
	//
	// This data is exposed to the user in the UI under the settings panel for the namespace. If the data is sensitive,
	// it should be stored in the SensitiveData field.
	// +optional
	Data map[string]interface{} `json:"data"`

	// SensitiveData is an optional map of arbitrary data that can be used to store additional information about the
	// namespace. This information is not exposed to the client in the UI, and can be used to store information that is
	// is only necessary within the plugin context, such as credentials necessary to create a client.
	// +optional
	sensitiveData map[string]interface{} `json:"-"`

	// Labels is a map of arbitrary key-value pairs that can be used to store additional information about the namespace.
	// Users will likely use and modify these labels to help organize and categorize their authorization contexts.
	Labels map[string]string `json:"labels"`

	// ID is the unique identifier for the authorization context that makes sense to the
	// plugin implementation.
	// +required
	ID string `json:"id"`

	// UID is an autogenerated unique identifier for the authorization context that the IDE
	// will use to identify the authorization context.
	UID string `json:"uid"`

	// Name is the readable name of the namespace.
	// +required
	Name string `json:"name"`

	// Description is an optional description of the namespace. This is primarily for the user to customize
	// the visual representation of the namespace.
	// +optional
	Description string `json:"description"`

	// Avatar is an optional image that can be used to represent the namespace. This is primarily for the user to customize
	// the visual representation of the namespace.
	// +optional
	Avatar string `json:"avatar"`

	// ExpiryTime is the amount of time before the auth context expires
	// +optional
	ExpiryTime time.Duration `json:"expiry_time"`
}

func (c *AuthorizationContext) GetSensitiveData() map[string]interface{} {
	return c.sensitiveData
}

func (c *AuthorizationContext) SetSensitiveData(data map[string]interface{}) {
	c.sensitiveData = data
}

func (c *AuthorizationContext) SetSensitiveDataKey(key string, value interface{}) {
	c.sensitiveData[key] = value
}

func (c *AuthorizationContext) GetSensitiveDataKey(key string) (interface{}, bool) {
	val, ok := c.sensitiveData[key]
	return val, ok
}

func (c *AuthorizationContext) GetData() map[string]interface{} {
	return c.Data
}

func (c *AuthorizationContext) SetData(data map[string]interface{}) {
	c.Data = data
}

func (c *AuthorizationContext) GetDataKey(key string) (interface{}, bool) {
	val, ok := c.Data[key]
	return val, ok
}

func (c *AuthorizationContext) SetDataKey(key string, value interface{}) {
	c.Data[key] = value
}

// IsAuthed returns whether the auth context is authenticated or not.
func (c *AuthorizationContext) IsAuthed() bool {
	return c.ExpiryTime > 0 && time.Now().Before(c.LastRefresh.Add(c.ExpiryTime))
}

type AuthContextOpts struct {
	// Data is an optional map of arbitrary data that can be used to store additional information about the namespace.
	Data map[string]interface{}

	// SensitiveData is an optional map of arbitrary data that can be used to store additional information about the
	SensitiveData map[string]interface{}

	// Labels is a map of arbitrary key-value pairs that can be used to store additional information about the namespace.
	Labels map[string]string

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

func NewAuthContext(opts AuthContextOpts) (*AuthorizationContext, error) {
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
		opts.Labels = make(map[string]string)
	}
	if opts.SensitiveData == nil {
		opts.SensitiveData = make(map[string]interface{})
	}
	if opts.ExpiryTime == 0 {
		// default to 24 hours
		opts.ExpiryTime = DefaultExpiryTime
	}

	return &AuthorizationContext{
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