package controllers

import "github.com/infraview/plugin/internal"

type MetricPluginController interface {
	internal.BasePluginController[interface{}]
}
