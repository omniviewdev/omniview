package resource

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

//nolint:gochecknoglobals // this is a map of resources to their GVK
var ResourceGroups = []types.ResourceGroup{
	{
		ID:   "admissionregistration",
		Name: "Admission Registration",
		Icon: "LuTicket",
	},
	{
		ID:   "core",
		Name: "Core",
		Icon: "LuBox",
	},
	{
		ID:   "apps",
		Name: "Apps",
		Icon: "LuBoxes",
	},
	{
		ID:   "batch",
		Name: "Batch",
		Icon: "LuGroup",
	},
	{
		ID:   "autoscaling",
		Name: "Autoscaling",
		Icon: "LuGauge",
	},
	{
		ID:   "networking",
		Name: "Networking",
		Icon: "LuNetwork",
	},
	{
		ID:   "rbac",
		Name: "Access Control",
		Icon: "LuShield",
	},
	{
		ID:   "storage",
		Name: "Storage",
		Icon: "LuHardDrive",
	},
	{
		ID:   "discovery",
		Name: "Discovery",
		Icon: "LuCompass",
	},
	{
		ID:   "policy",
		Name: "Policy",
		Icon: "LuClipboardList",
	},
	{
		ID:   "authentication",
		Name: "Authentication",
		Icon: "LuKey",
	},
	{
		ID:   "authorization",
		Name: "Authorization",
		Icon: "LuShieldCheck",
	},
	{
		ID:   "scheduling",
		Name: "Scheduling",
		Icon: "LuCalendar",
	},
	{
		ID:   "node",
		Name: "Node",
		Icon: "LuServer",
	},
	{
		ID:   "certificates",
		Name: "Certificates",
		Icon: "LuFileBadge2",
	},
	{
		ID:   "resource",
		Name: "Resource",
		Icon: "LuFileBadge",
	},
	{
		ID:   "coordination",
		Name: "Coordination",
		Icon: "LuHeartHandshake",
	},
	{
		ID:   "flowcontrol",
		Name: "Flow Control",
		Icon: "LuWorkflow",
	},
	{
		ID:   "events",
		Name: "Events",
		Icon: "LuCloudLightning",
	},
	{
		ID:   "apiserverinternal",
		Name: "API Server Internal",
		Icon: "LuServerCog",
	},
}
