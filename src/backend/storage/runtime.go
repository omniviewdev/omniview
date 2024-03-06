// package storage informs the factory for creating storage. the kubernetes factory is responsible for setting up the necessary
// storage for interacting with the API server.
// The runtime storage package sets up and initializes global storage that is necessary for working against data used in the active
// runtime environment, including live clients, informers, and other runtime-specific objects.
package storage

import (
	"errors"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
)

type RuntimeStorage struct {
	// Clusters is a per-cluster storage object that contains all the necessary informers and clients for interacting with the
	// API server for a given cluster.
	Clusters map[string]*ClusterRuntimeStorage
}

type ClusterRuntimeStorage struct {
	// Client is the client for interacting with the API server for a given cluster.
	Client dynamic.Interface

	// ClusterInformer is the informer for non-namespaced objects in the cluster.
	ClusterInformer dynamicinformer.DynamicSharedInformerFactory

	// NamespaceInformers is a map of informers for namespaced objects in the cluster, keyed by namespace.
	// This is used to reduce the number of informers that are running at any given time, and to reduce the number of
	// informers that are started and stopped as namespaces are added and removed.
	NamespaceInformers map[string]dynamicinformer.DynamicSharedInformerFactory

	// stopCh is used to start/stop informers
	stopCh chan struct{} // Used to start/stop informers
}

func NewRuntimeStorage() *RuntimeStorage {
	return &RuntimeStorage{
		Clusters: make(map[string]*ClusterRuntimeStorage),
	}
}

// InitializeCluster initializes the cluster storage for a given cluster. It adds the client for the cluster, as well as the
// informers for the cluster and all it's namespaces. This method should be called once for each cluster that the application is
// working with.
func (rs *RuntimeStorage) InitializeCluster(cluster string, client dynamic.Interface, clusterInformer dynamicinformer.DynamicSharedInformerFactory) error {
	if rs.Clusters == nil {
		return errors.New("runtime storage not initialized")
	}
	if _, ok := rs.Clusters[cluster]; ok {
		return errors.New("cluster already exists")
	}
	rs.Clusters[cluster] = &ClusterRuntimeStorage{
		Client:             client,
		ClusterInformer:    clusterInformer,
		NamespaceInformers: make(map[string]dynamicinformer.DynamicSharedInformerFactory),
		stopCh:             make(chan struct{}),
	}
	return nil
}

// GetClusterInformer returns the cluster informer for a given cluster.
func (rs *RuntimeStorage) GetClusterInformer(cluster string) (dynamicinformer.DynamicSharedInformerFactory, error) {
	if rs.Clusters == nil {
		return nil, errors.New("runtime storage not initialized")
	}
	if _, ok := rs.Clusters[cluster]; !ok {
		return nil, errors.New("cluster does not exist")
	}
	return rs.Clusters[cluster].ClusterInformer, nil
}

// GetNamespaceInformer returns the namespace informer for a given namespace in a given cluster.
func (rs *RuntimeStorage) GetNamespaceInformer(cluster string, namespace string) (dynamicinformer.DynamicSharedInformerFactory, error) {
	if rs.Clusters == nil {
		return nil, errors.New("runtime storage not initialized")
	}
	if _, ok := rs.Clusters[cluster]; !ok {
		return nil, errors.New("cluster does not exist")
	}
	if _, ok := rs.Clusters[cluster].NamespaceInformers[namespace]; !ok {
		return nil, errors.New("namespace informer does not exist")
	}
	return rs.Clusters[cluster].NamespaceInformers[namespace], nil
}

// RemoveClusterInformer removes the cluster informer for a given cluster.
func (rs *RuntimeStorage) RemoveClusterInformer(cluster string) error {
	if rs.Clusters == nil {
		return errors.New("runtime storage not initialized")
	}
	if _, ok := rs.Clusters[cluster]; !ok {
		return errors.New("cluster does not exist")
	}
	delete(rs.Clusters, cluster)
	return nil
}

// RemoveNamespaceInformer removes the namespace informer for a given namespace in a given cluster.
func (rs *RuntimeStorage) RemoveNamespaceInformer(cluster string, namespace string) error {
	if rs.Clusters == nil {
		return errors.New("runtime storage not initialized")
	}
	if _, ok := rs.Clusters[cluster]; !ok {
		return errors.New("cluster does not exist")
	}
	if _, ok := rs.Clusters[cluster].NamespaceInformers[namespace]; !ok {
		return errors.New("namespace informer does not exist")
	}
	delete(rs.Clusters[cluster].NamespaceInformers, namespace)
	return nil
}
