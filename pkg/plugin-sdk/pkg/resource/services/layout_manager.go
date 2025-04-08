package services

import (
	"fmt"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
)

type LayoutManager interface {
	GetLayout(layoutID string) ([]types.LayoutItem, error)
	SetLayout(layoutID string, layout []types.LayoutItem) error
	GetDefaultLayout() ([]types.LayoutItem, error)
	GenerateLayoutFromMetas(metas []types.ResourceMeta)
}

// concrete implementation of LayoutManager.
type manager struct {
	layouts       map[string][]types.LayoutItem
	defaultLayout string
}

func NewLayoutManager(opts *types.LayoutOpts) LayoutManager {
	m := &manager{}
	if opts == nil {
		return m
	}

	if opts.Layouts != nil {
		m.layouts = opts.Layouts
	}
	if opts.DefaultLayout != "" {
		m.defaultLayout = opts.DefaultLayout
	}

	return m
}

func (m *manager) GetLayout(layoutID string) ([]types.LayoutItem, error) {
	layout, ok := m.layouts[layoutID]
	if !ok {
		return nil, fmt.Errorf("layout %s does not exist", layoutID)
	}
	return layout, nil
}

func (m *manager) GetDefaultLayout() ([]types.LayoutItem, error) {
	return m.GetLayout(m.defaultLayout)
}

func (m *manager) SetLayout(layoutID string, layout []types.LayoutItem) error {
	m.layouts[layoutID] = layout
	return nil
}

// GenerateLayoutFromMetas generates a default list for the UI from the given metas
// by grouping them by group and kind.
func (m *manager) GenerateLayoutFromMetas(metas []types.ResourceMeta) {
	items := generateItemsFromMetas(metas)
	m.layouts["default"] = items
	m.defaultLayout = "default"
}

func generateItemsFromMetas(metas []types.ResourceMeta) []types.LayoutItem {
	items := make([]types.LayoutItem, 0, len(metas))

	for _, meta := range metas {
		found := false
		// make sure a layout item exists for the group
		for idx, item := range items {
			if item.ID == meta.GetGroup() {
				found = true
				items[idx].Items = append(items[idx].Items, types.LayoutItem{
					ID:          meta.String(),
					Label:       meta.Kind,
					Description: meta.Description,
				})
				break
			}
		}

		if !found {
			items = append(items, types.LayoutItem{
				ID:    meta.GetGroup(),
				Label: meta.GetGroup(),
				Items: []types.LayoutItem{},
			})
		}
	}

	return items
}
