package clients

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sts"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Client is the core AWS client that holds the base configuration and
// available regions. Service-specific clients are created on demand from
// this base configuration with the appropriate region override.
type Client struct {
	// Config is the base AWS configuration with credentials loaded.
	Config aws.Config
	// Regions is the list of enabled AWS regions for this connection.
	Regions []string
	// AccountID is the AWS account ID for this connection.
	AccountID string
}

// CreateClient creates a new AWS client from the plugin context.
func CreateClient(ctx *types.PluginContext) (*Client, error) {
	if ctx.Connection == nil {
		return nil, fmt.Errorf("connection context is required")
	}

	profileName := ctx.Connection.ID

	// Load AWS config using the profile from the connection
	cfg, err := config.LoadDefaultConfig(
		context.Background(),
		config.WithSharedConfigProfile(profileName),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config for profile %s: %w", profileName, err)
	}

	// Get account ID via STS
	stsClient := sts.NewFromConfig(cfg)
	identity, err := stsClient.GetCallerIdentity(context.Background(), &sts.GetCallerIdentityInput{})

	accountID := ""
	if err == nil && identity.Account != nil {
		accountID = *identity.Account
	}

	return &Client{
		Config:    cfg,
		Regions:   DefaultRegions(),
		AccountID: accountID,
	}, nil
}

// ConfigForRegion returns a copy of the base AWS config with the region set.
func (c *Client) ConfigForRegion(region string) aws.Config {
	cfg := c.Config.Copy()
	cfg.Region = region
	return cfg
}
