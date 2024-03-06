package types

// ResourceMeta contains information about the categorization of a resource
// within a specific plugin. This information is used to categorize resources
// within the IDE and provide a consistent interface for plugins and the core
// IDE to interact with resources of different types. Coming from different plugins.
//
// Each resource plugin must implement the resource manager interface, which uses the
// ResourceMeta to determine which resourcer to use for a given resource.
// As such, you should use the ResourceMeta to categorize resources in a way that
// both makes sense to the manager, as well as to other plugin developers who
// may want to use your plugin.
type ResourceMeta struct {
	// Group is the group of the resource. This is required for all resources.
	//
	// Some examples for groups include:
	// - Kubernetes Plugin: "core", "apps", "batch", "extensions"
	// - AWS Plugin: "ec2", "s3", "rds"
	// - GCP Plugin: "compute", "storage", "sql"
	// - Azure Plugin: "compute", "storage", "sql"
	Group string

	// Version is the version of the resource. This is required for all resources.
	// If the resource does not have a version, use "v1".
	//
	// Some examples for versions include:
	// - Kubernetes Plugin: "v1", "v1beta1", "v1beta2"
	// - AWS Plugin: "2012-12-01", "2016-11-15"
	Version string

	// Kind is the kind of the resource. This is required for all resources.
	//
	// Some examples for kinds include:
	// - Kubernetes Plugin: "Pod", "Service", "Deployment"
	// - AWS Plugin: "EC2Instance", "S3Bucket", "RDSInstance"
	// - GCP Plugin: "ComputeEngineInstance", "StorageBucket", "SQLInstance"
	// - Azure Plugin: "VirtualMachine", "StorageAccount", "SQLDatabase"
	Kind string

	// Description is a human-readable description of the resource. This is required for all resources.
	//
	// Some examples for descriptions include:
	// - Kubernetes Plugin: "A pod represents a set of running containers in your cluster"
	// - AWS Plugin: "An EC2 instance is a virtual server in the AWS cloud"
	// - GCP Plugin: "A Compute Engine instance is a virtual machine that runs on Google's infrastructure"
	// - Azure Plugin: "A virtual machine is a computer that runs on Microsoft's infrastructure"
	Description string

	// Category is the category of the resource. This is optional, and if not provided, the category will
	// be set to "Uncategorized". It is highly recommended to provide a category for your resources, so that
	// they can be easily found by other plugin developers.
	//
	// Some examples for categories include:
	// - Kubernetes Plugin: "Workloads", "Networking", "Storage"
	// - AWS Plugin: "Compute", "Storage", "Database"
	// - GCP Plugin: "Compute", "Storage", "Database"
	// - Azure Plugin: "Compute", "Storage", "Database"
	Category string
}

// String returns the string representation of the ResourceMeta
// in the format "group::version::kind"
// For example, "core::v1::Pod" or "ec2::2012-12-01::EC2Instance"
func (r ResourceMeta) String() string {
	return r.Group + "::" + r.Version + "::" + r.Kind
}

// GetKind returns the kind of the resource
func (r ResourceMeta) GetKind() string {
	return r.Kind
}

// GetGroup returns the group of the resource
// For example, "core" or "ec2"
func (r ResourceMeta) GetGroup() string {
	return r.Group
}

// GetVersion returns the version of the resource
// For example, "v1" or "2012-12-01"
func (r ResourceMeta) GetVersion() string {
	return r.Version
}

// GetDescription returns the description of the resource
func (r ResourceMeta) GetDescription() string {
	return r.Description
}

// GetCategory returns the category of the resource
func (r ResourceMeta) GetCategory() string {
	if r.Category == "" {
		return "Uncategorized"
	}
	return r.Category
}
