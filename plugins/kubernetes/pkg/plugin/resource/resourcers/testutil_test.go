package resourcers

import (
	"context"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakedynamic "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/dynamic/dynamicinformer"
)

// testGVR is a standard GVR used across tests (core/v1/pods).
var testGVR = schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}

// newTestPod creates an unstructured Pod object for testing.
func newTestPod(name, namespace string) *unstructured.Unstructured {
	pod := &unstructured.Unstructured{}
	pod.SetGroupVersionKind(schema.GroupVersionKind{Group: "", Version: "v1", Kind: "Pod"})
	pod.SetName(name)
	pod.SetNamespace(namespace)
	return pod
}

// newTestPodWithLabels creates an unstructured Pod object with labels for testing.
func newTestPodWithLabels(name, namespace string, labels map[string]string) *unstructured.Unstructured {
	pod := newTestPod(name, namespace)
	pod.SetLabels(labels)
	return pod
}

// newFakeClientSet builds a clients.ClientSet with a fake dynamic client and informer factory.
// The informer is NOT started, so HasSynced() returns false — methods will use DynamicClient paths.
func newFakeClientSet(gvrToListKind map[schema.GroupVersionResource]string, objects ...runtime.Object) *clients.ClientSet {
	scheme := runtime.NewScheme()
	dynamicClient := fakedynamic.NewSimpleDynamicClientWithCustomListKinds(scheme, gvrToListKind, objects...)
	factory := dynamicinformer.NewDynamicSharedInformerFactory(dynamicClient, 0)

	return &clients.ClientSet{
		DynamicClient:          dynamicClient,
		DynamicInformerFactory: factory,
	}
}

// newSyncedClientSet builds a ClientSet, starts the informer for the given GVR, and waits
// for the cache to sync. After this, HasSynced() returns true — methods will use the Lister path.
func newSyncedClientSet(ctx context.Context, gvr schema.GroupVersionResource, gvrToListKind map[schema.GroupVersionResource]string, objects ...runtime.Object) *clients.ClientSet {
	cs := newFakeClientSet(gvrToListKind, objects...)
	// Trigger informer creation for the target GVR
	cs.DynamicInformerFactory.ForResource(gvr).Informer()
	cs.DynamicInformerFactory.Start(ctx.Done())
	cs.DynamicInformerFactory.WaitForCacheSync(ctx.Done())
	return cs
}

// testPluginContext creates a minimal PluginContext with a background context.
func testPluginContext() *types.PluginContext {
	return &types.PluginContext{
		Context: context.Background(),
	}
}

// testPluginContextWithCancel creates a PluginContext with a cancellable context.
func testPluginContextWithCancel(ctx context.Context) *types.PluginContext {
	return &types.PluginContext{
		Context: ctx,
	}
}

// defaultGVRListKinds returns the GVR-to-ListKind mapping for the standard test GVR (pods).
func defaultGVRListKinds() map[schema.GroupVersionResource]string {
	return map[schema.GroupVersionResource]string{
		testGVR: "PodList",
	}
}
