#ifndef OMNIVIEW_PROCESSINFO_NATIVE_H
#define OMNIVIEW_PROCESSINFO_NATIVE_H
#include <stdint.h>
typedef struct {
    int64_t windowID;
    const char *error;
} OmniviewProcessWindow;
OmniviewProcessWindow omniviewObserveProcessWindow(void *handle, int expectedPID);
#endif
