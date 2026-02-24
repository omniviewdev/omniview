package resourcers

import (
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

// KubernetesPatternResourcer provides a fallback resourcer for arbitrary Kubernetes resources
// that don't have a dedicated static resourcer. It constructs API paths dynamically from the
// ResourceMeta parameter and is registered as a wildcard pattern resourcer.
type KubernetesPatternResourcer struct {
	sync.RWMutex
	// Logger
	log *zap.SugaredLogger
}

// NewKubernetesPatternResourcer creates a new instance of KubernetesPatternResourcer for interacting
// with arbitrary resources in a Kubernetes cluster.
func NewKubernetesPatternResourcer(
	logger *zap.SugaredLogger,
) pkgtypes.Resourcer[clients.ClientSet] {
	// Create a new instance of the service
	service := KubernetesPatternResourcer{
		RWMutex: sync.RWMutex{},
		log:     logger.With("service", "PatternResourcerService"),
	}

	return &service
}

func parseList(list *unstructured.UnstructuredList) ([]map[string]interface{}, error) {
	result := make([]map[string]interface{}, 0, len(list.Items))
	for _, r := range list.Items {
		obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&r)
		if err != nil {
			return nil, err
		}
		result = append(result, obj)
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

// resourceName returns the pluralized, lowercase resource name from a ResourceMeta Kind.
func resourceName(meta pkgtypes.ResourceMeta) string {
	return flect.Pluralize(strings.ToLower(meta.Kind))
}

// gvrFromMeta constructs a GroupVersionResource from ResourceMeta, using the
// same pluralization that Get/List/Find use so that read and write paths
// operate on the same Kubernetes API resource.
func gvrFromMeta(meta pkgtypes.ResourceMeta) schema.GroupVersionResource {
	return schema.GroupVersionResource{
		Group:    meta.Group,
		Version:  meta.Version,
		Resource: resourceName(meta),
	}
}

// apiBasePath returns the REST API base path for the given group and version.
// Core API resources (group="") use /api/v1, while named groups use /apis/{group}/{version}.
func apiBasePath(group, version string) string {
	if group == "" {
		return fmt.Sprintf("/api/%s", version)
	}
	return fmt.Sprintf("/apis/%s/%s", group, version)
}

// ============================ ACTION METHODS ============================ //.

// Get returns a resource, given a resource meta.
func (s *KubernetesPatternResourcer) Get(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	meta pkgtypes.ResourceMeta,
	input pkgtypes.GetInput,
) (*pkgtypes.GetResult, error) {
	base := apiBasePath(meta.Group, meta.Version)
	resource := resourceName(meta)

	var abspath string
	if input.Namespace != "" {
		abspath = fmt.Sprintf("%s/namespaces/%s/%s/%s", base, input.Namespace, resource, input.ID)
	} else {
		abspath = fmt.Sprintf("%s/%s/%s", base, resource, input.ID)
	}

	log.Println("abspath: ", abspath)

	result := client.
		Clientset.
		RESTClient().
		Get().
		AbsPath(abspath).
		Do(ctx.Context)

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
func (s *KubernetesPatternResourcer) List(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	meta pkgtypes.ResourceMeta,
	_ pkgtypes.ListInput,
) (*pkgtypes.ListResult, error) {
	base := apiBasePath(meta.Group, meta.Version)
	resource := resourceName(meta)

	result := client.
		Clientset.
		RESTClient().
		Get().
		AbsPath(fmt.Sprintf("%s/%s", base, resource)).
		Do(ctx.Context)

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
func (s *KubernetesPatternResourcer) Find(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	meta pkgtypes.ResourceMeta,
	_ pkgtypes.FindInput,
) (*pkgtypes.FindResult, error) {
	base := apiBasePath(meta.Group, meta.Version)
	resource := resourceName(meta)

	result := client.
		Clientset.
		RESTClient().
		Get().
		AbsPath(fmt.Sprintf("%s/%s", base, resource)).
		Do(ctx.Context)

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
func (s *KubernetesPatternResourcer) Create(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	meta pkgtypes.ResourceMeta,
	input pkgtypes.CreateInput,
) (*pkgtypes.CreateResult, error) {
	result := new(pkgtypes.CreateResult)
	lister := client.DynamicClient.Resource(gvrFromMeta(meta)).Namespace(input.Namespace)
	object := &unstructured.Unstructured{
		Object: input.Input,
	}
	created, err := lister.Create(ctx.Context, object, v1.CreateOptions{})
	if err != nil {
		return nil, err
	}
	result.Success = true
	result.Result = created.Object
	return result, nil
}

func (s *KubernetesPatternResourcer) Update(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	meta pkgtypes.ResourceMeta,
	input pkgtypes.UpdateInput,
) (*pkgtypes.UpdateResult, error) {
	result := new(pkgtypes.UpdateResult)
	// first get the resource
	lister := client.DynamicClient.Resource(gvrFromMeta(meta)).Namespace(input.Namespace)
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
	result.Success = true
	result.Result = updated.Object
	return result, nil
}

func (s *KubernetesPatternResourcer) Delete(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	meta pkgtypes.ResourceMeta,
	input pkgtypes.DeleteInput,
) (*pkgtypes.DeleteResult, error) {
	result := new(pkgtypes.DeleteResult)
	lister := client.DynamicClient.Resource(gvrFromMeta(meta)).Namespace(input.Namespace)

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

	result.Success = true
	return result, nil
}
