package resource

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	resourcetypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/utils"
)

const (
	// Estimated size of a the number of contexts in a kubeconfig.
	EstimatedContexts = 10
)

// LoadConnectionsFunc loads the available connections for the plugin.
func LoadConnectionsFunc(ctx *types.PluginContext) ([]types.Connection, error) {
	log.Println("Loading connections")

	// Get the kubeconfigs from the settings provider
	kubeconfigs, settingsErr := ctx.PluginConfig.GetStringSlice("kubeconfigs")
	if settingsErr != nil {
		log.Printf("failed to get kubeconfigs from settings: %v", settingsErr)
		return nil, fmt.Errorf("failed to get kubeconfigs from settings: %w", settingsErr)
	}

	// let's make a guestimate of the number of connections we might have
	connections := make([]types.Connection, 0, len(kubeconfigs)*EstimatedContexts)
	for _, kubeconfigPath := range kubeconfigs {
		kubeconfigConnections, err := connectionsFromKubeconfig(kubeconfigPath)
		if err != nil {
			// continue for now
			continue
		}
		connections = append(connections, kubeconfigConnections...)
	}

	sort.Slice(connections, func(i, j int) bool {
		return connections[i].Name < connections[j].Name
	})

	return connections, nil
}

// WatchConnectionsFunc watches kubeconfig files for changes and emits a refreshed
// list of connections whenever they change (write/create/rename/remove).
func WatchConnectionsFunc(ctx *types.PluginContext) (chan []types.Connection, error) {
	log.Println("Watching connections")

	// Load the configured kubeconfig paths up-front
	kubeconfigs, settingsErr := ctx.PluginConfig.GetStringSlice("kubeconfigs")
	if settingsErr != nil {
		log.Printf("failed to get kubeconfigs from settings: %v", settingsErr)
		return nil, fmt.Errorf("failed to get kubeconfigs from settings: %w", settingsErr)
	}

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create fsnotify watcher: %w", err)
	}

	// Channel to deliver full lists to the UI
	out := make(chan []types.Connection, 1)

	// Track which paths we’ve successfully added to avoid duplicates and to re-add after rotations
	type watchSet struct {
		mu    sync.Mutex
		files map[string]struct{}
		dirs  map[string]struct{}
	}
	ws := &watchSet{
		files: make(map[string]struct{}),
		dirs:  make(map[string]struct{}),
	}

	addWatch := func(path string) {
		ws.mu.Lock()
		defer ws.mu.Unlock()

		expandedPath, err := utils.ExpandTilde(path)
		if err != nil {
			// ignore for now
		}

		// Watch parent dir to catch file replacement/creation
		dir := filepath.Dir(expandedPath)
		if _, ok := ws.dirs[dir]; !ok {
			if err := w.Add(dir); err != nil {
				log.Printf("watch add (dir) %q failed: %v", dir, err)
			} else {
				ws.dirs[dir] = struct{}{}
			}
		}

		// Also watch the file itself when possible (fsnotify allows it and helps with CHMOD/WRITE)
		if _, ok := ws.files[expandedPath]; !ok {
			if err := w.Add(expandedPath); err != nil {
				// It might not exist yet—directory watch will pick up when it is created.
				log.Printf(
					"watch add (file) %q failed: %v (will rely on dir watch)",
					expandedPath,
					err,
				)
			} else {
				ws.files[path] = struct{}{}
			}
		}
	}

	// Initialize watches
	for _, p := range kubeconfigs {
		addWatch(p)
	}

	// Helper to refresh and push
	pushRefresh := func() {
		conns, err := LoadConnectionsFunc(ctx)
		if err != nil {
			// We still want to surface something; log and skip push if completely failed
			log.Printf("LoadConnectionsFunc failed during refresh: %v", err)
			return
		}
		// Non-blocking send with “latest wins” behavior
		select {
		case out <- conns:
			// sent
		default:
			// channel full; drop stale value then send latest
			select {
			case <-out:
			default:
			}
			select {
			case out <- conns:
			default:
			}
		}
	}

	// Send initial list
	pushRefresh()

	// Debounce timer for bursty events (atomic replaces, etc.)
	const debounce = 250 * time.Millisecond
	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		<-timer.C
	}

	// Kick off the watch loop
	go func(c context.Context) {
		defer func() {
			_ = w.Close()
			close(out)
		}()

		// guard to coalesce events
		trigger := func() {
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(debounce)
		}

		for {
			select {
			case <-c.Done():
				return

			case ev := <-w.Events:
				// If the event is on a parent dir, ev.Name will be the affected file path.
				// If it references one of our kubeconfigs (or its parent dir changes),
				// we’ll re-add the file watch in case it was replaced, then trigger.
				// We treat Write/Create/Rename/Remove/Chmod as triggers.
				_ = ev // avoid unused in case of future refine
				// Try re-adding watch for any configured file that now exists
				for _, p := range kubeconfigs {
					// If the event happened in the parent dir of p, we might need to (re-)add p
					if filepath.Dir(p) == filepath.Dir(ev.Name) || p == ev.Name {
						addWatch(p)
					}
				}
				switch {
				case ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename|fsnotify.Chmod) != 0:
					trigger()
				}

			case err := <-w.Errors:
				log.Printf("fsnotify error: %v", err)

			case <-timer.C:
				// Debounced refresh
				pushRefresh()
			}
		}
	}(ctx.Context)

	return out, nil
}

// LoadConnectionNamespacesFunc loads the available namespaces for the connection.
func LoadConnectionNamespacesFunc(
	ctx *types.PluginContext,
	client *clients.ClientSet,
) ([]string, error) {
	lister := client.DynamicInformerFactory.
		ForResource(corev1.SchemeGroupVersion.WithResource("namespaces")).
		Lister()

	resources, err := lister.List(labels.Everything())
	if err != nil {
		return nil, err
	}

	namespaces := make([]string, 0, len(resources))

	for _, r := range resources {
		var obj map[string]interface{}
		obj, err = runtime.DefaultUnstructuredConverter.ToUnstructured(r)
		if err != nil {
			return nil, err
		}
		res := unstructured.Unstructured{Object: obj}
		namespaces = append(namespaces, res.GetName())
	}

	return namespaces, nil
}

// CheckConnectionFunc checks the connection to the cluster, using the discovery client.
func CheckConnectionFunc(
	_ *types.PluginContext,
	conn *types.Connection,
	client *clients.ClientSet,
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

	result := types.ConnectionStatus{
		Connection: conn,
		Status:     types.ConnectionStatusUnknown,
	}

	// our check is simply if we can get all the server groups
	groups, err := client.DiscoveryClient.ServerGroups()
	if err != nil {
		switch {
		case k8serrors.IsUnauthorized(err):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Unauthorized"
			result.Details = "You are not currently authorized to access this connection. Please check your credentials and try again."
		case k8serrors.IsForbidden(err):
			result.Status = types.ConnectionStatusForbidden
			result.Error = "Forbidden"
			result.Details = "You are forbidden from accessing this connection. Please check your permissions and try again."
		// common cases for unauthorized AWS session credentials
		case strings.Contains(err.Error(), "getting credentials: exec: executable aws failed with exit code 255"):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Unauthorized"
			result.Details = "You are not currently authorized to access this connection. Please check your AWS credentials and try again."
		case strings.Contains(err.Error(), "executable aws-iam-authenticator failed with exit code 1"):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Unauthorized"
			result.Details = "You are not currently authorized to access this connection. Please check your AWS credentials and try again."
		case strings.Contains(err.Error(), "no such host"):
			result.Status = types.ConnectionStatusNotFound
			result.Error = "Not Found"
			result.Details = "The host was not found. Please check the host and try again."
		case strings.Contains(err.Error(), "connection refused"):
			result.Status = types.ConnectionStatusError
			result.Error = "Connection Refused"
			result.Details = "The connection was refused. Please check the host and try again."
		case strings.Contains(err.Error(), "certificate signed by unknown authority"):
			result.Status = types.ConnectionStatusError
			result.Error = "Unknown Authority"
			result.Details = "The certificate for this connection was signed by an unknown authority. Please check the certificate and try again."
		case strings.Contains(err.Error(), "certificate has expired"):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Certificate Expired"
			result.Details = "The certificate for this connection has expired. Please check/refresh the certificate and try again."
		default:
			result.Status = types.ConnectionStatusError
			result.Error = "Error"
			result.Details = fmt.Sprintf("Error checking connection: %v", err)
		}

		return result, nil
	}

	// Enrich connection data with cluster metadata (best-effort)
	enrichConnectionData(conn, client, groups)

	// wait for an informer cache sync so that we don't get a bunch of empty resources
	result.Status = types.ConnectionStatusConnected
	result.Details = "Connection is valid"
	return result, nil
}

// enrichConnectionData populates conn.Data with cluster metadata discovered on
// successful connection. This data is persisted by the backend controller and
// available to the UI even when the cluster is not currently connected.
func enrichConnectionData(
	conn *types.Connection,
	client *clients.ClientSet,
	groups *metav1.APIGroupList,
) {
	if conn.Data == nil {
		conn.Data = make(map[string]interface{})
	}

	// Server URL from the resolved REST config
	if client.RESTConfig != nil && client.RESTConfig.Host != "" {
		conn.Data["server_url"] = client.RESTConfig.Host
	}

	// API group count from already-fetched ServerGroups
	if groups != nil {
		conn.Data["api_groups"] = len(groups.Groups)
	}

	// Kubernetes version and platform
	if info, verErr := client.DiscoveryClient.ServerVersion(); verErr == nil && info != nil {
		conn.Data["k8s_version"] = info.GitVersion
		conn.Data["k8s_platform"] = info.Platform
	}

	// Node count (best-effort — may fail with restricted RBAC)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if nodeList, nodeErr := client.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{}); nodeErr == nil {
		conn.Data["node_count"] = len(nodeList.Items)
	}

	conn.Data["last_checked"] = time.Now().UTC().Format(time.RFC3339)
}

func connectionsFromKubeconfig(kubeconfigPath string) ([]types.Connection, error) {
	// if the path has a ~ in it, expand it to the home directory
	kubeconfigPath, err := utils.ExpandTilde(kubeconfigPath)
	if err != nil {
		return nil, err
	}

	// Load the kubeconfig file to get the configuration.
	config, err := clientcmd.LoadFromFile(kubeconfigPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load kubeconfig from path %s: %w", kubeconfigPath, err)
	}

	connections := make([]types.Connection, 0, len(config.Contexts))

	for contextName, context := range config.Contexts {
		labels := map[string]interface{}{
			"kubeconfig": utils.DeexpandTilde(kubeconfigPath),
			"cluster":    context.Cluster,
			"user":       context.AuthInfo,
		}
		enrichConnectionLabels(labels, config, context)

		connections = append(connections, types.Connection{
			ID:          contextName,
			Name:        contextName,
			Description: "",
			Avatar:      "",
			Labels:      labels,
			Data: map[string]interface{}{
				"kubeconfig": kubeconfigPath,
				"cluster":    context.Cluster,
				"namespace":  context.Namespace,
				"user":       context.AuthInfo,
			},
		})
	}

	return connections, nil
}

// enrichConnectionLabels extracts cloud metadata from kubeconfig into connection labels
// so they can be used for dynamic grouping, filtering, and display in the frontend.
func enrichConnectionLabels(
	labels map[string]interface{},
	config *clientcmdapi.Config,
	context *clientcmdapi.Context,
) {
	if cluster := config.Clusters[context.Cluster]; cluster != nil {
		labels["server"] = cluster.Server
	}

	authInfo := config.AuthInfos[context.AuthInfo]
	if authInfo == nil || authInfo.Exec == nil {
		labels["auth_method"] = "default"
		return
	}

	switch {
	case kubeauth.IsEKSAuth(authInfo):
		labels["auth_method"] = "eks"
		enrichEKSLabels(labels, authInfo)
	case kubeauth.IsGCPAuth(authInfo):
		labels["auth_method"] = "gke"
		enrichGKELabels(labels, authInfo)
	case kubeauth.IsAKSAuth(authInfo):
		labels["auth_method"] = "aks"
		enrichAKSLabels(labels, authInfo)
	default:
		labels["auth_method"] = authInfo.Exec.Command
	}
}

// enrichEKSLabels extracts region, account, profile, and role from EKS auth config.
func enrichEKSLabels(labels map[string]interface{}, authInfo *clientcmdapi.AuthInfo) {
	var region, profile, roleArn string

	// Parse args for both aws CLI and aws-iam-authenticator
	for i := 0; i < len(authInfo.Exec.Args)-1; i++ {
		switch authInfo.Exec.Args[i] {
		case "--region":
			region = authInfo.Exec.Args[i+1]
		case "--role-arn", "--role", "-r":
			roleArn = authInfo.Exec.Args[i+1]
		}
	}

	// Parse env vars
	for _, entry := range authInfo.Exec.Env {
		switch entry.Name {
		case "AWS_PROFILE":
			profile = entry.Value
		case "AWS_REGION":
			if region == "" {
				region = entry.Value
			}
		case "AWS_DEFAULT_REGION":
			if region == "" {
				region = entry.Value
			}
		}
	}

	if region != "" {
		labels["region"] = region
	}
	if profile != "" {
		labels["profile"] = profile
	}
	if roleArn != "" {
		labels["role"] = roleArn
		// Extract account ID from ARN: arn:aws:iam::ACCOUNT_ID:...
		if parts := strings.SplitN(roleArn, ":", 6); len(parts) >= 5 {
			labels["account"] = parts[4]
		}
	}
}

// enrichGKELabels extracts project, zone/region from GKE gcloud exec config.
func enrichGKELabels(labels map[string]interface{}, authInfo *clientcmdapi.AuthInfo) {
	for i := 0; i < len(authInfo.Exec.Args)-1; i++ {
		switch authInfo.Exec.Args[i] {
		case "--project":
			labels["project"] = authInfo.Exec.Args[i+1]
		case "--zone":
			labels["zone"] = authInfo.Exec.Args[i+1]
		case "--region":
			labels["region"] = authInfo.Exec.Args[i+1]
		}
	}

	// Check env vars as fallback
	for _, entry := range authInfo.Exec.Env {
		if entry.Name == "CLOUDSDK_CORE_PROJECT" {
			if _, ok := labels["project"]; !ok {
				labels["project"] = entry.Value
			}
		}
	}
}

// enrichAKSLabels extracts subscription and resource group from Azure CLI exec config.
func enrichAKSLabels(labels map[string]interface{}, authInfo *clientcmdapi.AuthInfo) {
	for i := 0; i < len(authInfo.Exec.Args)-1; i++ {
		switch authInfo.Exec.Args[i] {
		case "--subscription":
			labels["subscription"] = authInfo.Exec.Args[i+1]
		case "--resource-group":
			labels["resource_group"] = authInfo.Exec.Args[i+1]
		}
	}
}

func processGroupVersion(gv string) (string, string) {
	parts := strings.Split(gv, "/")

	if len(parts) == 1 {
		return "core", parts[0]
	}

	group := parts[0]
	version := parts[1]

	if strings.HasSuffix(group, ".k8s.io") {
		// if group ends in .k8s.io, remove it
		group = strings.TrimSuffix(group, ".k8s.io")

		// if group still has dots, remove them except in our weird cases
		if strings.Contains(group, ".") {
			// split by dot, and combine in reverse order without dot
			parts := strings.Split(group, ".")

			if strings.HasPrefix(group, "internal.") {
				group = ""
				for i := len(parts) - 1; i >= 0; i-- {
					group += parts[i]
				}
			} else {
				// take the first part of the group
				group = parts[0]
			}
		}
	}

	return group, version
}

func DiscoveryFunc(
	ctx *types.PluginContext,
	client *clients.DiscoveryClient,
) ([]resourcetypes.ResourceMeta, error) {
	// TODO: not sure if we wnat preferred or not, but I could see a use case for getting all supported
	groups, err := client.DiscoveryClient.ServerPreferredResources()
	if err != nil {
		return nil, err
	}

	// guestimate about 5 resources per group
	response := make([]resourcetypes.ResourceMeta, 0, len(groups)*5)

	for _, grouplist := range groups {
		group, version := processGroupVersion(grouplist.GroupVersion)

		for _, resource := range grouplist.APIResources {
			response = append(response, resourcetypes.ResourceMeta{
				Group:   group,
				Version: version,
				Kind:    resource.Kind,
			})
		}
	}

	return response, nil
}
