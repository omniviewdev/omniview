package kubeauth

import (
	"context"
	"encoding/base64"

	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/aws/smithy-go/middleware"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

const (
	tokenPrefix    = "k8s-aws-v1."
	expiresParam   = "X-Amz-Expires"
	expiresValue   = "60"
	k8sAWSIDHeader = "x-k8s-aws-id"
)

func getEKSToken(ctx context.Context, client *sts.Client, clusterName string) (string, error) {
	presign := sts.NewPresignClient(client)
	req, err := presign.PresignGetCallerIdentity(
		ctx,
		&sts.GetCallerIdentityInput{},
		func(opts *sts.PresignOptions) {
			opts.ClientOptions = append(
				opts.ClientOptions,
				sts.WithAPIOptions(addEKSHeader(clusterName)),
			)
		},
	)
	if err != nil {
		return "", err
	}
	return tokenPrefix + base64.RawURLEncoding.EncodeToString([]byte(req.URL)), nil
}

func addEKSHeader(cluster string) func(stack *middleware.Stack) error {
	return func(stack *middleware.Stack) error {
		return stack.Build.Add(middleware.BuildMiddlewareFunc("AddEKSHeader", func(
			ctx context.Context, in middleware.BuildInput, next middleware.BuildHandler,
		) (middleware.BuildOutput, middleware.Metadata, error) {
			switch req := in.Request.(type) {
			case *smithyhttp.Request:
				q := req.URL.Query()
				q.Add(expiresParam, expiresValue)
				req.URL.RawQuery = q.Encode()
				req.Header.Add(k8sAWSIDHeader, cluster)
			}
			return next.HandleBuild(ctx, in)
		}), middleware.Before)
	}
}
