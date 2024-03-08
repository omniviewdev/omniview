package controllers

import "github.com/infraview/plugin/internal"

type FilesystemPluginController interface {
	internal.BasePluginController[interface{}]
}
