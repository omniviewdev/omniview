package resource

// The below types are used as part of the generics system in the plugin-sdk. You should
// change them to match the types you are using in your plugin.

// Client is the client used to perform CRUD operations on resources.
type Client interface{}

// DiscoveryClient is the client used to perform discovery operations on resources.
type DiscoveryClient interface{}

// Informer is the entity that watches for changes on resources.
type Informer interface{}
