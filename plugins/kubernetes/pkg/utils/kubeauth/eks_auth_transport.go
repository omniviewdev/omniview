package kubeauth

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

type eksAuthTransport struct {
	ClusterName string
	RoleARN     string
	Profile     string
	Region      string

	mu        sync.Mutex
	token     string
	expiresAt time.Time

	Base http.RoundTripper
}

// builds the sts client for making the call to AWS to get the token
func (e *eksAuthTransport) getStsClient(ctx context.Context) (*sts.Client, error) {
	if e.ClusterName == "" {
		return nil, fmt.Errorf("cluster name is required")
	}

	opts := []func(*config.LoadOptions) error{}
	if e.Profile != "" {
		opts = append(
			opts,
			config.WithSharedConfigProfile(e.Profile),
		)
	}
	if e.Region != "" {
		opts = append(opts, config.WithRegion(e.Region))
	}

	// Lazy init STS client
	cfg, err := config.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		awsErr := fmt.Errorf("error loading aws config: %w", err)
		log.Print(awsErr)
		return nil, awsErr
	}

	client := sts.NewFromConfig(cfg)
	if e.RoleARN != "" {
		creds := stscreds.NewAssumeRoleProvider(client, e.RoleARN)
		cfg.Credentials = aws.NewCredentialsCache(creds)
		client = sts.NewFromConfig(cfg)
	}

	return client, err
}

func (e *eksAuthTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	ctx := req.Context()

	client, err := e.getStsClient(ctx)
	if err != nil {
		return nil, err
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	// prevent unnecessary calls to sts to get tokens, tokens are set to a known 15 minutes:
	if time.Now().After(e.expiresAt) {
		log.Printf("token is expired, generating new token")

		token, err := getEKSToken(ctx, client, e.ClusterName)
		if err != nil {
			eksErr := fmt.Errorf("failed to generate EKS token: %w", err)
			log.Print(eksErr.Error())
			return nil, eksErr
		}

		log.Printf("successfully generated new eks token")

		e.token = token
		e.expiresAt = time.Now().Add(time.Minute * 14)
	}

	req2 := req.Clone(ctx)
	req2.Header.Set("Authorization", "Bearer "+e.token)

	resp, err := e.base().RoundTrip(req2)
	if err != nil {
		log.Printf("error in round tripper: %s", err.Error())
		log.Printf("got response: %v", resp)
	}

	return resp, err
}

func (e *eksAuthTransport) base() http.RoundTripper {
	if e.Base != nil {
		return e.Base
	}
	return http.DefaultTransport
}
