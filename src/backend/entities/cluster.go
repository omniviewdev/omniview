// Package entities contains the entities for the application. The cluster entity is responsible for representing the
// cluster object in the application. The cluster context entity is responsible for representing the cluster context object
// in the application.
package entities

import "gorm.io/gorm"

// Context is a kubeconfig context that represents a cluster in the application.
type Context struct {
	gorm.Model

	// Name is the name of the context.
	ID string `json:"name"`

	// Version is the version of the cluster in the context.
	Version string `json:"version"`

	// Description is a description of the context.
	Description string `json:"description"`

	// Icon is the path to the icon for the context.
	Icon string `json:"icon"`

	// Kubeconfig is the path to the kubeconfig file.
	Kubeconfig string `json:"kubeconfig"`

	// Distribution is the distribution of the cluster in the context.
	Distribution string `json:"distribution"`

	// Cloud is the cloud provider of the cluster in the context.
	Cloud string `json:"cloud"`

	// Region is the region of the cluster in the context.
	Region string `json:"region"`

	// DefaultNamespace is the default namespace for the context.
	DefaultNamespace string `json:"default_namespace"`
}
