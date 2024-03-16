package plugin

import "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"

// Clients is a struct that contains all the clients for the plugin system. Clients
// here are exposed to the UI and to the other plugin systems.
type Clients struct {
	Resource resource.Client `json:"resource"`
}

func NewClients(resourceClient resource.Client) *Clients {
	return &Clients{
		Resource: resourceClient,
	}
}
