// Package kubeconfiginfo provides utilities to inspect the kubeconfig file and list context information.
package clusters

import (
	"fmt"
	"os"
	"strings"

	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/client-go/util/homedir"
)

type ClusterInfos struct {
	Clusters map[string]*ClusterInfo `json:"clusters"`
}

// ClusterInfo holds information about a cluster in the kubeconfig.
type ClusterInfo struct {
	// Name is the name of the cluster.
	Name string `json:"name"`
	// Version is the version of the cluster.
	Version string `json:"version"`
	// Description is a description of the cluster.
	Description string `json:"description"`
	// Icon is the icon of the cluster.
	Icon string `json:"icon"`
	// Kubeconfig is the path to the kubeconfig file.
	Kubeconfig string `json:"kubeconfig"`
	// Distribution is the distribution of the cluster.
	Distribution string `json:"distribution"`
	// Cloud is the cloud provider of the cluster.
	Cloud string `json:"cloud"`
	// Region is the region of the cluster.
	Region string `json:"region"`
	// Contexts is the list of contexts for the cluster.
	Contexts []ClusterContext `json:"contexts"`
}

type ClusterContext struct {
	// Name is the name of the context.
	Name string `json:"name"`
	// User is the user of the context.
	User string `json:"user"`
}

func (c *ClusterInfo) AddCloudInfoFromContext(info *api.Cluster) {
	if info == nil {
		return
	}
	// parse the server url to get the cloud provider and region
	// for example, if the server url is https://gke-cluster-1.us-central1-a.c.my-project.internal
	// then the cloud provider is GKE, the region is us-central1-a, and the distribution is GKE
	// if the server url is https://3l4j34hg0wh4q34gw.gr7.us-gov-east-1.eks.amazonaws.com then the cloud provider is EKS,
	// the region is us-gov-east-1, and the distribution is eks
	if strings.Contains(info.Server, "eks.amazonaws.com") {
		c.Cloud = "AWS"
		c.Distribution = "eks"
		c.Region = strings.Split(info.Server, ".")[2]
		return
	}
	if strings.Contains(info.CertificateAuthority, ".minikube") {
		c.Cloud = "Local"
		c.Distribution = "minikube"
		c.Region = "local"
		return
	}
	if strings.Contains(info.Server, "gke") {
		c.Cloud = "GCP"
		c.Distribution = "gke"
		return
	}

	// if nothing else matches, assume it's a generic kubernetes cluster
	c.Cloud = ""
	c.Distribution = "k8s"
	c.Region = ""
}

// ListKubeConfigContexts lists the context names and basic information from the kubeconfig.
func ListKubeConfigContexts(kubeconfigPath string) (ClusterInfos, error) {
	if kubeconfigPath == "" {
		if home := homedir.HomeDir(); home != "" {
			kubeconfigPath = os.Getenv("KUBECONFIG")
			if kubeconfigPath == "" {
				kubeconfigPath = home + "/.kube/config"
			}
		} else {
			return ClusterInfos{}, fmt.Errorf("cannot find kubeconfig path")
		}
	}

	// Load the kubeconfig file.
	config, err := clientcmd.LoadFromFile(kubeconfigPath)
	if err != nil {
		return ClusterInfos{}, fmt.Errorf("failed to load kubeconfig: %v", err)
	}

	clusters := make(map[string]*ClusterInfo)

	for name, context := range config.Contexts {
		// for each context, build out a cluster info object. each cluster should have a list of contexts,
		// and we should be able to select a context to use for the cluster.
		clusterInfo, clusterExists := config.Clusters[context.Cluster]
		userInfo, userExists := config.AuthInfos[context.AuthInfo]

		if clusterExists && userExists {
			var cluster *ClusterInfo
			var ok bool

			// if the cluster isn't in the map, initialize it
			if cluster, ok = clusters[context.Cluster]; !ok {
				// if inside home, replace home with ~
				// readableKubeconfigPath := strings.Replace(kubeconfigPath, homedir.HomeDir(), "~", 1)
				cluster = &ClusterInfo{
					Name:        name,
					Version:     "",
					Description: "",
					Icon:        "https://www.weka.io/wp-content/uploads/files/2020/08/kubernetes-icon-white.png",
					Kubeconfig:  kubeconfigPath,
					Contexts:    []ClusterContext{},
				}

				cluster.AddCloudInfoFromContext(clusterInfo)
				clusters[context.Cluster] = cluster
			}

			// add the context to the cluster
			cluster.Contexts = append(cluster.Contexts, ClusterContext{
				Name: context.Cluster,
				User: userInfo.Username,
			})
		}
	}

	return ClusterInfos{
		Clusters: clusters,
	}, nil
}

// GetClusters gets the list of clusters from the kubeconfig file.
func GetClusters(kubeconfig string) (ClusterInfos, error) {
	if kubeconfig == "" {
		kubeconfig = "/Users/joshuapare/.kube/config"
	}
	return ListKubeConfigContexts("")
}
