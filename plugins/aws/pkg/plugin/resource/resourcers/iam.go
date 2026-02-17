package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/iam"
	iamtypes "github.com/aws/aws-sdk-go-v2/service/iam/types"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== IAM User =====

// ListIAMUsers lists all IAM users (global resource).
func ListIAMUsers(ctx context.Context, client *clients.Client) ([]map[string]interface{}, error) {
	svc := iam.NewFromConfig(client.Config)
	results := make([]map[string]interface{}, 0)

	paginator := iam.NewListUsersPaginator(svc, &iam.ListUsersInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list IAM users: %w", err)
		}
		for _, user := range page.Users {
			m, err := StructToMap(user)
			if err != nil {
				return nil, fmt.Errorf("failed to convert IAM user to map: %w", err)
			}
			results = append(results, m)
		}
	}

	return results, nil
}

// GetIAMUser gets a single IAM user by username.
func GetIAMUser(ctx context.Context, client *clients.Client, id string) (map[string]interface{}, error) {
	svc := iam.NewFromConfig(client.Config)

	result, err := svc.GetUser(ctx, &iam.GetUserInput{
		UserName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get IAM user %s: %w", id, err)
	}

	m, err := StructToMap(result.User)
	if err != nil {
		return nil, fmt.Errorf("failed to convert IAM user to map: %w", err)
	}

	return m, nil
}

// ===== IAM Role =====

// ListIAMRoles lists all IAM roles (global resource).
func ListIAMRoles(ctx context.Context, client *clients.Client) ([]map[string]interface{}, error) {
	svc := iam.NewFromConfig(client.Config)
	results := make([]map[string]interface{}, 0)

	paginator := iam.NewListRolesPaginator(svc, &iam.ListRolesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list IAM roles: %w", err)
		}
		for _, role := range page.Roles {
			m, err := StructToMap(role)
			if err != nil {
				return nil, fmt.Errorf("failed to convert IAM role to map: %w", err)
			}
			results = append(results, m)
		}
	}

	return results, nil
}

// GetIAMRole gets a single IAM role by name.
func GetIAMRole(ctx context.Context, client *clients.Client, id string) (map[string]interface{}, error) {
	svc := iam.NewFromConfig(client.Config)

	result, err := svc.GetRole(ctx, &iam.GetRoleInput{
		RoleName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get IAM role %s: %w", id, err)
	}

	m, err := StructToMap(result.Role)
	if err != nil {
		return nil, fmt.Errorf("failed to convert IAM role to map: %w", err)
	}

	return m, nil
}

// ===== IAM Policy =====

// ListIAMPolicies lists all customer-managed IAM policies (global resource).
func ListIAMPolicies(ctx context.Context, client *clients.Client) ([]map[string]interface{}, error) {
	svc := iam.NewFromConfig(client.Config)
	results := make([]map[string]interface{}, 0)

	paginator := iam.NewListPoliciesPaginator(svc, &iam.ListPoliciesInput{
		Scope: iamtypes.PolicyScopeTypeLocal,
	})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list IAM policies: %w", err)
		}
		for _, policy := range page.Policies {
			m, err := StructToMap(policy)
			if err != nil {
				return nil, fmt.Errorf("failed to convert IAM policy to map: %w", err)
			}
			results = append(results, m)
		}
	}

	return results, nil
}

// GetIAMPolicy gets a single IAM policy by ARN.
func GetIAMPolicy(ctx context.Context, client *clients.Client, id string) (map[string]interface{}, error) {
	svc := iam.NewFromConfig(client.Config)

	result, err := svc.GetPolicy(ctx, &iam.GetPolicyInput{
		PolicyArn: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get IAM policy %s: %w", id, err)
	}

	m, err := StructToMap(result.Policy)
	if err != nil {
		return nil, fmt.Errorf("failed to convert IAM policy to map: %w", err)
	}

	return m, nil
}

// ===== IAM Group =====

// ListIAMGroups lists all IAM groups (global resource).
func ListIAMGroups(ctx context.Context, client *clients.Client) ([]map[string]interface{}, error) {
	svc := iam.NewFromConfig(client.Config)
	results := make([]map[string]interface{}, 0)

	paginator := iam.NewListGroupsPaginator(svc, &iam.ListGroupsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list IAM groups: %w", err)
		}
		for _, group := range page.Groups {
			m, err := StructToMap(group)
			if err != nil {
				return nil, fmt.Errorf("failed to convert IAM group to map: %w", err)
			}
			results = append(results, m)
		}
	}

	return results, nil
}

// GetIAMGroup gets a single IAM group by name.
func GetIAMGroup(ctx context.Context, client *clients.Client, id string) (map[string]interface{}, error) {
	svc := iam.NewFromConfig(client.Config)

	result, err := svc.GetGroup(ctx, &iam.GetGroupInput{
		GroupName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get IAM group %s: %w", id, err)
	}

	m, err := StructToMap(result.Group)
	if err != nil {
		return nil, fmt.Errorf("failed to convert IAM group to map: %w", err)
	}

	return m, nil
}

// ===== IAM Instance Profile =====

// ListIAMInstanceProfiles lists all IAM instance profiles (global resource).
func ListIAMInstanceProfiles(ctx context.Context, client *clients.Client) ([]map[string]interface{}, error) {
	svc := iam.NewFromConfig(client.Config)
	results := make([]map[string]interface{}, 0)

	paginator := iam.NewListInstanceProfilesPaginator(svc, &iam.ListInstanceProfilesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list IAM instance profiles: %w", err)
		}
		for _, profile := range page.InstanceProfiles {
			m, err := StructToMap(profile)
			if err != nil {
				return nil, fmt.Errorf("failed to convert IAM instance profile to map: %w", err)
			}
			results = append(results, m)
		}
	}

	return results, nil
}

// GetIAMInstanceProfile gets a single IAM instance profile by name.
func GetIAMInstanceProfile(ctx context.Context, client *clients.Client, id string) (map[string]interface{}, error) {
	svc := iam.NewFromConfig(client.Config)

	result, err := svc.GetInstanceProfile(ctx, &iam.GetInstanceProfileInput{
		InstanceProfileName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get IAM instance profile %s: %w", id, err)
	}

	m, err := StructToMap(result.InstanceProfile)
	if err != nil {
		return nil, fmt.Errorf("failed to convert IAM instance profile to map: %w", err)
	}

	return m, nil
}
