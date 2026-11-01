#ifndef OMNIVIEW_UIINSPECTION_NATIVE_H
#define OMNIVIEW_UIINSPECTION_NATIVE_H

#include <stdbool.h>

typedef struct {
    bool supported;
    bool enabled;
    char *application;
    char *target;
    char *error;
} OmniviewInspectionStatus;

OmniviewInspectionStatus omniviewInspectWindow(void *window, bool apply, bool enabled);
void omniviewFreeInspectionStatus(OmniviewInspectionStatus status);

#endif
