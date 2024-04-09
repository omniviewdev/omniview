package resourcers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/gobuffalo/flect"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"go.uber.org/zap"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"

	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// KubernetesDynamicResourcer provides a base implementation of the ResourceService interface.
// It manages the lifecycle of informers for a specific Kubernetes resource and handles context switching,
// ensuring that resource data is consistently up-to-date and accessible.
type KubernetesDynamicResourcer struct {
	sync.RWMutex
	// Logger
	log *zap.SugaredLogger
}

// NewKubernetesDynamicResourcer creates a new instance of KubernetesDynamicResourcer for interacting
// with informers and resources in a Kubernetes cluster.
func NewKubernetesDynamicResourcer(
	logger *zap.SugaredLogger,
) pkgtypes.DynamicResourcer[clients.ClientSet] {
	// Create a new instance of the service
	service := KubernetesDynamicResourcer{
		RWMutex: sync.RWMutex{},
		log:     logger.With("service", "DynamicResourcerService"),
	}

	return &service
}

func parseList(list *unstructured.UnstructuredList) (map[string]interface{}, error) {
	result := make(map[string]interface{})
	for _, r := range list.Items {
		var obj map[string]interface{}
		p := r
		obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&p)
		if err != nil {
			return nil, err
		}
		res := unstructured.Unstructured{Object: obj}
		result[res.GetName()] = obj
	}
	return result, nil
}

func parseSingleFromList(list *unstructured.UnstructuredList) (map[string]interface{}, error) {
	if len(list.Items) != 1 {
		b, err := json.MarshalIndent(list, "", "  ")
		if err != nil {
			fmt.Println("error:", err)
		}
		log.Println("Error parsing single from list: ", string(b))
		return nil, fmt.Errorf("expected one item in list, got %d", len(list.Items))
	}
	obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&list.Items[0])
	if err != nil {
		return nil, err
	}

	return obj, nil
}

// ============================ ACTION METHODS ============================ //.

// Get returns a resource, given a resource meta.
func (s *KubernetesDynamicResourcer) Get(
	_ *types.PluginContext,
	client *clients.ClientSet,
	meta pkgtypes.ResourceMeta,
	input pkgtypes.GetInput,
) (*pkgtypes.GetResult, error) {
	group := meta.Group
	version := meta.Version
	resource := flect.Pluralize(strings.ToLower(meta.Kind))

	var abspath string

	if input.Namespace != "" {
		abspath = fmt.Sprintf(
			"/apis/%s/%s/namespaces/%s/%s/%s",
			group,
			version,
			input.Namespace,
			resource,
			input.ID,
		)
	} else {
		abspath = fmt.Sprintf("/apis/%s/%s/%s/%s", group, version, resource, input.ID)
	}

	log.Println("abspath: ", abspath)

	result := client.
		Clientset.
		RESTClient().
		Get().
		AbsPath(abspath).
		Do(context.TODO())

	retBytes, err := result.Raw()
	if err != nil {
		log.Println("Error getting resource: ", err)
		return nil, err
	}
	uncastObj, err := runtime.Decode(unstructured.UnstructuredJSONScheme, retBytes)
	if err != nil {
		log.Println("Error getting resource: ", err)
		return nil, err
	}

	obj, ok := uncastObj.(*unstructured.Unstructured)
	if !ok {
		err = fmt.Errorf("expected unstructured.Unstructured, got %T", uncastObj)
		log.Println("Error getting resource: ", err)
		return nil, err
	}

	return &pkgtypes.GetResult{Success: true, Result: obj.Object}, nil
}

// List returns a map of resources for the provided cluster contexts.
func (s *KubernetesDynamicResourcer) List(
	_ *types.PluginContext,
	client *clients.ClientSet,
	meta pkgtypes.ResourceMeta,
	_ pkgtypes.ListInput,
) (*pkgtypes.ListResult, error) {
	group := meta.Group
	version := meta.Version
	resource := flect.Pluralize(strings.ToLower(meta.Kind))

	result := client.
		Clientset.
		RESTClient().
		Get().
		AbsPath(fmt.Sprintf("/apis/%s/%s/%s", group, version, resource)).
		Do(context.TODO())

	retBytes, err := result.Raw()
	if err != nil {
		log.Println("Error listing resources: ", err)
		return nil, err
	}
	uncastObj, err := runtime.Decode(unstructured.UnstructuredJSONScheme, retBytes)
	if err != nil {
		log.Println("Error listing resources: ", err)
		return nil, err
	}

	resources, ok := uncastObj.(*unstructured.UnstructuredList)
	if ok {
		resultObj, err := parseList(resources)
		if err != nil {
			log.Println("Error listing resources: ", err)
			return nil, err
		}
		return &pkgtypes.ListResult{Success: true, Result: resultObj}, nil
	}

	resources, err = uncastObj.(*unstructured.Unstructured).ToList()
	if err != nil {
		log.Println("Error listing resources: ", err)
		return nil, err
	}
	resultObj, err := parseList(resources)
	if err != nil {
		log.Println("Error listing resources: ", err)
		return nil, err
	}

	return &pkgtypes.ListResult{Success: true, Result: resultObj}, nil
}

// Find returns a resource by name and namespace.
// TODO - implement, for now this just does list
func (s *KubernetesDynamicResourcer) Find(
	_ *types.PluginContext,
	client *clients.ClientSet,
	meta pkgtypes.ResourceMeta,
	_ pkgtypes.FindInput,
) (*pkgtypes.FindResult, error) {
	group := meta.Group
	version := meta.Version
	resource := flect.Pluralize(strings.ToLower(meta.Kind))

	result := client.
		Clientset.
		RESTClient().
		Get().
		AbsPath(fmt.Sprintf("/apis/%s/%s/%s", group, version, resource)).
		Do(context.TODO())

	retBytes, err := result.Raw()
	if err != nil {
		log.Println("Error listing resources: ", err)
		return nil, err
	}
	uncastObj, err := runtime.Decode(unstructured.UnstructuredJSONScheme, retBytes)
	if err != nil {
		log.Println("Error listing resources: ", err)
		return nil, err
	}

	resources, ok := uncastObj.(*unstructured.UnstructuredList)
	if ok {
		resultObj, err := parseList(resources)
		if err != nil {
			log.Println("Error listing resources: ", err)
			return nil, err
		}
		return &pkgtypes.FindResult{Success: true, Result: resultObj}, nil
	}

	resources, err = uncastObj.(*unstructured.Unstructured).ToList()
	if err != nil {
		log.Println("Error listing resources: ", err)
		return nil, err
	}
	resultObj, err := parseList(resources)
	if err != nil {
		log.Println("Error listing resources: ", err)
		return nil, err
	}

	return &pkgtypes.FindResult{Success: true, Result: resultObj}, nil
}

// Create creates a new resource in the given resource namespace.
func (s *KubernetesDynamicResourcer) Create(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	meta pkgtypes.ResourceMeta,
	input pkgtypes.CreateInput,
) (*pkgtypes.CreateResult, error) {
	result := new(pkgtypes.CreateResult)
	gvr := schema.GroupVersionResource{
		Group:    meta.Group,
		Version:  meta.Version,
		Resource: meta.Kind,
	}
	lister := client.DynamicClient.Resource(gvr).Namespace(input.Namespace)
	object := &unstructured.Unstructured{
		Object: input.Input,
	}
	created, err := lister.Create(ctx.Context, object, v1.CreateOptions{})
	if err != nil {
		return nil, err
	}
	result.Result = created.Object
	return result, nil
}

func (s *KubernetesDynamicResourcer) Update(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	meta pkgtypes.ResourceMeta,
	input pkgtypes.UpdateInput,
) (*pkgtypes.UpdateResult, error) {
	result := new(pkgtypes.UpdateResult)
	gvr := schema.GroupVersionResource{
		Group:    meta.Group,
		Version:  meta.Version,
		Resource: meta.Kind,
	}
	// first get the resource
	lister := client.DynamicClient.Resource(gvr).Namespace(input.Namespace)
	resource, err := lister.Get(ctx.Context, input.ID, v1.GetOptions{})
	if err != nil {
		return nil, err
	}

	// update and resubmit
	resource.Object = input.Input
	updated, err := lister.Update(ctx.Context, resource, v1.UpdateOptions{})
	if err != nil {
		return nil, err
	}
	result.Result = updated.Object
	return result, nil
}

func (s *KubernetesDynamicResourcer) Delete(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	meta pkgtypes.ResourceMeta,
	input pkgtypes.DeleteInput,
) (*pkgtypes.DeleteResult, error) {
	result := new(pkgtypes.DeleteResult)

	gvr := schema.GroupVersionResource{
		Group:    meta.Group,
		Version:  meta.Version,
		Resource: meta.Kind,
	}
	lister := client.DynamicClient.Resource(gvr).Namespace(input.Namespace)

	// first, get the resource for the delete so we can return back to the client
	resource, err := lister.Get(ctx.Context, input.ID, v1.GetOptions{})
	if err != nil {
		return nil, err
	}
	result.Result = resource.Object

	// delete the resource
	if err = lister.Delete(ctx.Context, input.ID, v1.DeleteOptions{}); err != nil {
		return nil, err
	}

	return result, nil
}
