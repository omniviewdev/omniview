package resource

import (
	"context"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"

	"gopkg.in/ini.v1"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/sso"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// pendingSSO tracks in-progress SSO device authorization flows.
var pendingSSO = sso.NewPendingFlows()

// LoadConnectionsFunc loads the available AWS connections from profiles.
func LoadConnectionsFunc(_ *types.PluginContext) ([]types.Connection, error) {
	log.Println("Loading AWS connections")
	connections, err := profileLoader()
	if err != nil {
		return nil, err
	}

	sort.Slice(connections, func(i, j int) bool {
		return connections[i].Name < connections[j].Name
	})

	return connections, nil
}

// LoadConnectionNamespacesFunc returns the list of AWS regions as namespaces.
// This enables region-based filtering in the IDE similar to Kubernetes namespace filtering.
func LoadConnectionNamespacesFunc(
	_ *types.PluginContext,
	client *clients.Client,
) ([]string, error) {
	return client.Regions, nil
}

// isSSO returns true if the connection was tagged as an SSO profile.
func isSSO(conn *types.Connection) bool {
	if conn.Labels == nil {
		return false
	}
	t, ok := conn.Labels["type"]
	return ok && t == "sso"
}

// CheckConnectionFunc validates an AWS connection by calling STS GetCallerIdentity.
// For SSO profiles, it implements a two-phase device authorization flow:
//
//	Phase 1: On expired token, registers an OIDC client and starts device
//	         authorization. Returns UNAUTHORIZED with verification URL in conn.Data.
//	Phase 2: On retry (pending flow exists), polls for the token. If the user
//	         completed browser auth, saves the token and falls through to STS check.
func CheckConnectionFunc(
	_ *types.PluginContext,
	conn *types.Connection,
	client *clients.Client,
) (types.ConnectionStatus, error) {
	if conn == nil {
		return types.ConnectionStatus{
			Connection: conn,
			Status:     types.ConnectionStatusError,
			Details:    "No connection was provided to check",
			Error:      "connection is required",
		}, nil
	}
	if client == nil {
		return types.ConnectionStatus{
			Connection: conn,
			Status:     types.ConnectionStatusError,
			Details:    "No client was provided to check the connection",
			Error:      "client is required",
		}, nil
	}

	ctx := context.Background()

	// Phase 2: If there's a pending SSO device auth, try to complete it.
	if pending := pendingSSO.Get(conn.ID); pending != nil {
		token, err := sso.PollForToken(ctx, pending)
		if err != nil {
			errMsg := err.Error()
			if strings.Contains(errMsg, "AuthorizationPendingException") {
				// User hasn't completed browser auth yet — return PENDING
				if conn.Data == nil {
					conn.Data = make(map[string]interface{})
				}
				conn.Data["sso_verification_uri_complete"] = pending.VerificationURIComplete
				conn.Data["sso_user_code"] = pending.UserCode
				conn.Data["sso_device_auth_expires_at"] = pending.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z")
				return types.ConnectionStatus{
					Connection: conn,
					Status:     types.ConnectionStatusPending,
					Error:      "SSO Authorization Pending",
					Details:    "Waiting for browser authorization to complete.",
				}, nil
			}
			// Device auth expired or other error — clear and fall through to re-initiate
			pendingSSO.Delete(conn.ID)
		} else {
			// Token acquired — save and reload config
			pendingSSO.Delete(conn.ID)
			if err := sso.SaveCachedToken(pending.SessionName, token); err != nil {
				log.Printf("Warning: failed to save SSO token cache: %v", err)
			}
			// Reload the AWS config so the SDK picks up the new token
			cfg, err := config.LoadDefaultConfig(ctx, config.WithSharedConfigProfile(conn.ID))
			if err != nil {
				return types.ConnectionStatus{
					Connection: conn,
					Status:     types.ConnectionStatusError,
					Error:      "Config Reload Failed",
					Details:    fmt.Sprintf("SSO token acquired but failed to reload config: %v", err),
				}, nil
			}
			client.Config = cfg
			// Fall through to STS check below
		}
	}

	// STS identity check
	result := types.ConnectionStatus{
		Connection: conn,
		Status:     types.ConnectionStatusUnknown,
	}

	stsClient := sts.NewFromConfig(client.Config)
	identity, err := stsClient.GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		errMsg := err.Error()
		switch {
		case (strings.Contains(errMsg, "ExpiredToken") ||
			strings.Contains(errMsg, "ExpiredTokenException") ||
			strings.Contains(errMsg, "UnauthorizedException")) && isSSO(conn):
			// SSO token expired — try refresh or initiate device auth
			return handleSSOExpired(ctx, conn)

		case strings.Contains(errMsg, "ExpiredToken"),
			strings.Contains(errMsg, "ExpiredTokenException"):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Token Expired"
			result.Details = "Your AWS session token has expired. Please refresh your credentials and try again."
		case strings.Contains(errMsg, "InvalidClientTokenId"),
			strings.Contains(errMsg, "SignatureDoesNotMatch"):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Invalid Credentials"
			result.Details = "Your AWS credentials are invalid. Please check your access key and secret key."
		case strings.Contains(errMsg, "AccessDenied"),
			strings.Contains(errMsg, "AccessDeniedException"):
			result.Status = types.ConnectionStatusForbidden
			result.Error = "Access Denied"
			result.Details = "You do not have permission to access this AWS account."
		case strings.Contains(errMsg, "no such host"),
			strings.Contains(errMsg, "connection refused"):
			result.Status = types.ConnectionStatusError
			result.Error = "Connection Failed"
			result.Details = "Unable to reach AWS. Please check your network connection."
		default:
			result.Status = types.ConnectionStatusError
			result.Error = "Error"
			result.Details = fmt.Sprintf("Error checking connection: %v", err)
		}
		return result, nil
	}

	result.Status = types.ConnectionStatusConnected
	result.Details = fmt.Sprintf("Connected to AWS account %s", *identity.Account)
	return result, nil
}

// handleSSOExpired attempts to refresh or re-initiate SSO authentication.
func handleSSOExpired(ctx context.Context, conn *types.Connection) (types.ConnectionStatus, error) {
	// Determine the SSO session name and region from connection data/labels
	sessionName := getConnStr(conn, "sso_session")
	startURL := getConnStr(conn, "sso_start_url")
	region := getConnStr(conn, "sso_region")

	if startURL == "" {
		return types.ConnectionStatus{
			Connection: conn,
			Status:     types.ConnectionStatusUnauthorized,
			Error:      "SSO Configuration Missing",
			Details:    "SSO start URL not found in connection configuration.",
		}, nil
	}

	// Use the sso_session name if available, otherwise use startURL as the cache key
	cacheKey := sessionName
	if cacheKey == "" {
		cacheKey = startURL
	}

	// Try refreshing with existing cached token
	cached, err := sso.LoadCachedToken(cacheKey)
	if err == nil && cached.RefreshToken != "" {
		refreshed, err := sso.RefreshToken(ctx, region, cached)
		if err == nil {
			if err := sso.SaveCachedToken(cacheKey, refreshed); err != nil {
				log.Printf("Warning: failed to save refreshed SSO token: %v", err)
			}
			return types.ConnectionStatus{
				Connection: conn,
				Status:     types.ConnectionStatusConnected,
				Details:    "SSO token refreshed successfully.",
			}, nil
		}
		log.Printf("SSO token refresh failed for %s, initiating device auth: %v", conn.ID, err)
	}

	// Initiate device authorization flow
	clientID, clientSecret, err := sso.RegisterClient(ctx, region)
	if err != nil {
		return types.ConnectionStatus{
			Connection: conn,
			Status:     types.ConnectionStatusError,
			Error:      "SSO Registration Failed",
			Details:    fmt.Sprintf("Failed to register OIDC client: %v", err),
		}, nil
	}

	auth, err := sso.StartDeviceAuthorization(ctx, region, clientID, clientSecret, startURL, cacheKey)
	if err != nil {
		return types.ConnectionStatus{
			Connection: conn,
			Status:     types.ConnectionStatusError,
			Error:      "SSO Device Auth Failed",
			Details:    fmt.Sprintf("Failed to start device authorization: %v", err),
		}, nil
	}

	// Store pending flow so Phase 2 can complete it
	pendingSSO.Set(conn.ID, auth)

	// Set verification data on the connection for the UI
	if conn.Data == nil {
		conn.Data = make(map[string]interface{})
	}
	conn.Data["sso_verification_uri_complete"] = auth.VerificationURIComplete
	conn.Data["sso_user_code"] = auth.UserCode
	conn.Data["sso_device_auth_expires_at"] = auth.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z")

	return types.ConnectionStatus{
		Connection: conn,
		Status:     types.ConnectionStatusUnauthorized,
		Error:      "SSO Login Required",
		Details:    "Complete the SSO login in your browser.",
	}, nil
}

// getConnStr retrieves a string value from conn.Data first, then conn.Labels.
func getConnStr(conn *types.Connection, key string) string {
	if conn.Data != nil {
		if v, ok := conn.Data[key]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
	}
	if conn.Labels != nil {
		if v, ok := conn.Labels[key]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
	}
	return ""
}

// profileLoader loads AWS profiles from the config file.
func profileLoader() ([]types.Connection, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	configPath := homeDir + "/.aws/config"

	var connections []types.Connection

	cfg, err := ini.Load(configPath)
	if err != nil {
		return nil, err
	}

	// Pre-scan for [sso-session <name>] sections
	ssoSessions := make(map[string]*ini.Section)
	for _, section := range cfg.Sections() {
		name := section.Name()
		if strings.HasPrefix(name, "sso-session ") {
			sessionName := strings.TrimPrefix(name, "sso-session ")
			ssoSessions[sessionName] = section
		}
	}

	for _, section := range cfg.Sections() {
		name := section.Name()

		// Skip sso-session sections (already parsed above)
		if strings.HasPrefix(name, "sso-session ") {
			continue
		}

		// Handle [default] section
		if name == "default" {
			conn := types.Connection{
				ID:     "default",
				Name:   "default",
				Labels: make(map[string]interface{}),
				Data:   make(map[string]interface{}),
			}
			enrichProfileConnection(&conn, section, ssoSessions)
			connections = append(connections, conn)
			continue
		}

		// Handle [profile name] sections
		if strings.HasPrefix(name, "profile ") {
			name = strings.TrimPrefix(name, "profile ")
			conn := types.Connection{
				ID:     name,
				Name:   name,
				Labels: make(map[string]interface{}),
				Data:   make(map[string]interface{}),
			}
			enrichProfileConnection(&conn, section, ssoSessions)
			connections = append(connections, conn)
		}
	}

	return connections, nil
}

func enrichProfileConnection(conn *types.Connection, section *ini.Section, ssoSessions map[string]*ini.Section) {
	if section.HasKey("region") {
		conn.Labels["region"] = section.Key("region").String()
	}

	if section.HasKey("sso_session") {
		// New-style SSO config: profile references a [sso-session <name>] section
		sessionName := section.Key("sso_session").String()
		conn.Labels["type"] = "sso"
		conn.Data["sso_session"] = sessionName

		if section.HasKey("sso_account_id") {
			conn.Labels["account_id"] = section.Key("sso_account_id").String()
			conn.Data["sso_account_id"] = section.Key("sso_account_id").String()
		}
		if section.HasKey("sso_role_name") {
			conn.Labels["role"] = section.Key("sso_role_name").String()
			conn.Data["sso_role_name"] = section.Key("sso_role_name").String()
		}

		// Pull start URL and region from the referenced sso-session
		if sess, ok := ssoSessions[sessionName]; ok {
			if sess.HasKey("sso_start_url") {
				conn.Data["sso_start_url"] = sess.Key("sso_start_url").String()
			}
			if sess.HasKey("sso_region") {
				conn.Labels["sso_region"] = sess.Key("sso_region").String()
				conn.Data["sso_region"] = sess.Key("sso_region").String()
			}
			if sess.HasKey("sso_registration_scopes") {
				conn.Data["sso_registration_scopes"] = sess.Key("sso_registration_scopes").String()
			}
		}
	} else if section.HasKey("sso_start_url") {
		// Legacy inline SSO config
		conn.Labels["type"] = "sso"
		conn.Labels["account_id"] = section.Key("sso_account_id").String()
		conn.Labels["role"] = section.Key("sso_role_name").String()
		conn.Data["sso_start_url"] = section.Key("sso_start_url").String()
		conn.Data["sso_account_id"] = section.Key("sso_account_id").String()
		conn.Data["sso_role_name"] = section.Key("sso_role_name").String()
		if section.HasKey("sso_region") {
			conn.Labels["sso_region"] = section.Key("sso_region").String()
			conn.Data["sso_region"] = section.Key("sso_region").String()
		}
	} else if section.HasKey("role_arn") {
		conn.Labels["type"] = "assume-role"
		conn.Labels["role_arn"] = section.Key("role_arn").String()
		if section.HasKey("source_profile") {
			conn.Labels["source_profile"] = section.Key("source_profile").String()
		}
	} else {
		conn.Labels["type"] = "credentials"
	}

	if section.HasKey("output") {
		conn.Data["output"] = section.Key("output").String()
	}
}
