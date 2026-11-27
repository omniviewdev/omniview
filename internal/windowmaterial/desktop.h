#ifndef OMNIVIEW_WINDOW_MATERIAL_H
#define OMNIVIEW_WINDOW_MATERIAL_H

#include <stdbool.h>
#include <stdint.h>

typedef enum { OVOpaque, OVTranslucent, OVGlass, OVInPage } OVMaterial;
typedef enum { OVSupported, OVAccessibility, OVUnsupported, OVNoCompositor, OVWebViewUnavailable } OVMaterialReason;
typedef struct {
    OVMaterial effective;
    OVMaterialReason reason;
    bool glassAvailable;
} OVMaterialResult;

// All entry points, including the notification callback, run on the native UI thread.
OVMaterialResult ovApplyMaterial(void *window, OVMaterial requested, bool clear, bool highContrast);
void *ovObserveMaterial(void *window, uintptr_t handle);
void ovStopObservingMaterial(void *observer);
void ovMaterialEnvironmentChanged(uintptr_t handle);

#endif
