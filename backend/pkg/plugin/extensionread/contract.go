package extensionread

import "context"

// Binding identifies the exact read decision and both running installations.
// It carries no operation, row schema, provider or root authority.
type Binding struct {
	Point                 string `json:"point"`
	Offer                 string `json:"offer"`
	OwnerPin              string `json:"ownerPin"`
	OwnerGeneration       string `json:"ownerGeneration"`
	ContributorPin        string `json:"contributorPin"`
	ContributorGeneration string `json:"contributorGeneration"`
	Read                  string `json:"read"`
	Continuity            string `json:"continuity"`
}

// Contract is native metadata from the verified point owner. Row is read-only;
// the broker must not mutate it or publish it to the renderer.
type Contract struct {
	Operation       string
	Row             map[string]string
	OwnerLife       context.Context
	ContributorLife context.Context
}
