package sso

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/ssooidc"
)

// CachedToken represents an AWS SSO token stored in ~/.aws/sso/cache/.
// The format is compatible with the AWS CLI's token cache.
type CachedToken struct {
	StartURL                string `json:"startUrl"`
	Region                  string `json:"region"`
	AccessToken             string `json:"accessToken"`
	ExpiresAt               string `json:"expiresAt"`
	ClientID                string `json:"clientId,omitempty"`
	ClientSecret            string `json:"clientSecret,omitempty"`
	RefreshToken            string `json:"refreshToken,omitempty"`
	RegistrationExpiresAt   string `json:"registrationExpiresAt,omitempty"`
}

// DeviceAuth holds the state of an in-progress device authorization flow.
type DeviceAuth struct {
	ClientID     string
	ClientSecret string
	DeviceCode   string
	UserCode     string
	VerificationURI         string
	VerificationURIComplete string
	ExpiresAt    time.Time
	Interval     int32
	Region       string
	StartURL     string
	SessionName  string
}

// tokenCacheDir returns the path to ~/.aws/sso/cache/.
func tokenCacheDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("unable to determine home directory: %w", err)
	}
	return filepath.Join(home, ".aws", "sso", "cache"), nil
}

// cacheKeyForSession returns the SHA1 hash of the session name, matching
// the AWS CLI's cache key convention.
func cacheKeyForSession(sessionName string) string {
	h := sha1.Sum([]byte(sessionName))
	return hex.EncodeToString(h[:])
}

// LoadCachedToken reads a cached SSO token from ~/.aws/sso/cache/<sha1>.json.
func LoadCachedToken(sessionName string) (*CachedToken, error) {
	dir, err := tokenCacheDir()
	if err != nil {
		return nil, err
	}

	key := cacheKeyForSession(sessionName)
	path := filepath.Join(dir, key+".json")

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("unable to read token cache %s: %w", path, err)
	}

	var token CachedToken
	if err := json.Unmarshal(data, &token); err != nil {
		return nil, fmt.Errorf("unable to parse token cache %s: %w", path, err)
	}

	return &token, nil
}

// SaveCachedToken writes a token to ~/.aws/sso/cache/<sha1>.json in the
// AWS CLI-compatible format.
func SaveCachedToken(sessionName string, token *CachedToken) error {
	dir, err := tokenCacheDir()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("unable to create cache directory: %w", err)
	}

	key := cacheKeyForSession(sessionName)
	path := filepath.Join(dir, key+".json")

	data, err := json.MarshalIndent(token, "", "  ")
	if err != nil {
		return fmt.Errorf("unable to marshal token: %w", err)
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("unable to write token cache: %w", err)
	}

	return nil
}

// IsTokenValid returns true if the token's ExpiresAt is in the future.
func IsTokenValid(token *CachedToken) bool {
	if token == nil || token.AccessToken == "" || token.ExpiresAt == "" {
		return false
	}
	expires, err := time.Parse(time.RFC3339, token.ExpiresAt)
	if err != nil {
		return false
	}
	return time.Now().Before(expires)
}

// RefreshToken attempts to refresh an SSO token using the refresh_token grant.
// Returns nil if no refresh token is available.
func RefreshToken(ctx context.Context, region string, token *CachedToken) (*CachedToken, error) {
	if token.RefreshToken == "" || token.ClientID == "" || token.ClientSecret == "" {
		return nil, fmt.Errorf("token does not have refresh credentials")
	}

	client := ssooidc.New(ssooidc.Options{Region: region})

	grantType := "refresh_token"
	result, err := client.CreateToken(ctx, &ssooidc.CreateTokenInput{
		ClientId:     &token.ClientID,
		ClientSecret: &token.ClientSecret,
		GrantType:    &grantType,
		RefreshToken: &token.RefreshToken,
	})
	if err != nil {
		return nil, fmt.Errorf("refresh token failed: %w", err)
	}

	expiresAt := time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)

	refreshed := &CachedToken{
		StartURL:              token.StartURL,
		Region:                token.Region,
		AccessToken:           *result.AccessToken,
		ExpiresAt:             expiresAt.UTC().Format(time.RFC3339),
		ClientID:              token.ClientID,
		ClientSecret:          token.ClientSecret,
		RegistrationExpiresAt: token.RegistrationExpiresAt,
	}
	if result.RefreshToken != nil {
		refreshed.RefreshToken = *result.RefreshToken
	} else {
		refreshed.RefreshToken = token.RefreshToken
	}

	return refreshed, nil
}

// RegisterClient registers a new OIDC client with the SSO service.
// The registration is valid for approximately 90 days.
func RegisterClient(ctx context.Context, region string) (clientID, clientSecret string, err error) {
	client := ssooidc.New(ssooidc.Options{Region: region})

	clientName := "omniview-aws-plugin"
	clientType := "public"
	result, err := client.RegisterClient(ctx, &ssooidc.RegisterClientInput{
		ClientName: &clientName,
		ClientType: &clientType,
	})
	if err != nil {
		return "", "", fmt.Errorf("register client failed: %w", err)
	}

	return *result.ClientId, *result.ClientSecret, nil
}

// StartDeviceAuthorization begins the device authorization flow.
// Returns a DeviceAuth with the verification URIs and user code.
func StartDeviceAuthorization(
	ctx context.Context,
	region, clientID, clientSecret, startURL, sessionName string,
) (*DeviceAuth, error) {
	client := ssooidc.New(ssooidc.Options{Region: region})

	result, err := client.StartDeviceAuthorization(ctx, &ssooidc.StartDeviceAuthorizationInput{
		ClientId:     &clientID,
		ClientSecret: &clientSecret,
		StartUrl:     &startURL,
	})
	if err != nil {
		return nil, fmt.Errorf("start device authorization failed: %w", err)
	}

	expiresAt := time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)
	interval := result.Interval
	if interval == 0 {
		interval = 5
	}

	auth := &DeviceAuth{
		ClientID:                clientID,
		ClientSecret:            clientSecret,
		DeviceCode:              *result.DeviceCode,
		UserCode:                *result.UserCode,
		VerificationURI:         *result.VerificationUri,
		VerificationURIComplete: *result.VerificationUriComplete,
		ExpiresAt:               expiresAt,
		Interval:                interval,
		Region:                  region,
		StartURL:                startURL,
		SessionName:             sessionName,
	}

	return auth, nil
}

// PollForToken makes a single CreateToken call to check if the user has
// completed the device authorization. It does NOT loop — the caller decides
// when to call this (typically triggered by a user clicking "I've Logged In").
//
// Returns the token on success, or an error. If the error message contains
// "AuthorizationPendingException", the user has not yet completed the flow.
func PollForToken(ctx context.Context, auth *DeviceAuth) (*CachedToken, error) {
	if time.Now().After(auth.ExpiresAt) {
		return nil, fmt.Errorf("device authorization has expired")
	}

	client := ssooidc.New(ssooidc.Options{Region: auth.Region})

	grantType := "urn:ietf:params:oauth:grant-type:device_code"
	result, err := client.CreateToken(ctx, &ssooidc.CreateTokenInput{
		ClientId:     &auth.ClientID,
		ClientSecret: &auth.ClientSecret,
		GrantType:    &grantType,
		DeviceCode:   &auth.DeviceCode,
	})
	if err != nil {
		return nil, err
	}

	expiresAt := time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)

	token := &CachedToken{
		StartURL:    auth.StartURL,
		Region:      auth.Region,
		AccessToken: *result.AccessToken,
		ExpiresAt:   expiresAt.UTC().Format(time.RFC3339),
		ClientID:    auth.ClientID,
		ClientSecret: auth.ClientSecret,
	}
	if result.RefreshToken != nil {
		token.RefreshToken = *result.RefreshToken
	}

	return token, nil
}
