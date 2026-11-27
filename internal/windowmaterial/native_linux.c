//go:build ui_next && linux && !android && !server && cgo && !purego && !gtk3

#include <gtk/gtk.h>
#include <webkit/webkit.h>
#include "desktop.h"

typedef struct {
    GdkDisplay *display;
    GtkSettings *settings;
    GtkCssProvider *provider;
    uintptr_t handle;
    gboolean transparency;
    gboolean highContrast;
} MaterialObserver;

static gboolean transparentDisplay(GdkDisplay *display) {
    return gdk_display_is_rgba(display) && gdk_display_is_composited(display);
}

static gboolean highContrast(GtkSettings *settings) {
    // gtk-interface-contrast exists from GTK 4.20. Read the named property
    // when available without requiring a newer GTK to build or run Omniview.
    GParamSpec *spec = g_object_class_find_property(G_OBJECT_GET_CLASS(settings), "gtk-interface-contrast");
    if (spec && G_IS_PARAM_SPEC_ENUM(spec)) {
        int value = 0;
        g_object_get(settings, "gtk-interface-contrast", &value, NULL);
        GEnumValue *contrast = g_enum_get_value(G_PARAM_SPEC_ENUM(spec)->enum_class, value);
        if (contrast && g_str_equal(contrast->value_nick, "more")) return TRUE;
    }
    char *theme = NULL;
    g_object_get(settings, "gtk-theme-name", &theme, NULL);
    gboolean high = theme && g_ascii_strncasecmp(theme, "HighContrast", 12) == 0;
    g_free(theme);
    return high;
}

static void environmentChanged(GObject *source, GParamSpec *spec, gpointer data) {
    MaterialObserver *observer = data;
    gboolean transparency = transparentDisplay(observer->display);
    gboolean high = highContrast(observer->settings);
    if (observer->transparency == transparency && observer->highContrast == high) return;
    observer->transparency = transparency;
    observer->highContrast = high;
    ovMaterialEnvironmentChanged(observer->handle);
}

void *ovObserveMaterial(void *pointer, uintptr_t handle) {
    MaterialObserver *observer = g_new0(MaterialObserver, 1);
    observer->handle = handle;
    observer->display = g_object_ref(gtk_widget_get_display(GTK_WIDGET(pointer)));
    observer->settings = g_object_ref(gtk_settings_get_for_display(observer->display));
    observer->transparency = transparentDisplay(observer->display);
    observer->highContrast = highContrast(observer->settings);
    observer->provider = gtk_css_provider_new();
    // Target only enrolled windows. Do not change the decoration, children,
    // menus or shadow. The solid colour matches the host's startup backing.
    const char *css = "window.ov-material { background-color: #0d1117; background-image: none; }"
                      "window.ov-material.ov-material-clear { background-color: transparent; }";
#if GTK_CHECK_VERSION(4, 12, 0)
    gtk_css_provider_load_from_string(observer->provider, css);
#else
    gtk_css_provider_load_from_data(observer->provider, css, -1);
#endif
    gtk_style_context_add_provider_for_display(observer->display, GTK_STYLE_PROVIDER(observer->provider), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_signal_connect(observer->display, "notify::composited", G_CALLBACK(environmentChanged), observer);
    g_signal_connect(observer->display, "notify::rgba", G_CALLBACK(environmentChanged), observer);
    g_signal_connect(observer->settings, "notify::gtk-theme-name", G_CALLBACK(environmentChanged), observer);
    if (g_object_class_find_property(G_OBJECT_GET_CLASS(observer->settings), "gtk-interface-contrast")) {
        g_signal_connect(observer->settings, "notify::gtk-interface-contrast", G_CALLBACK(environmentChanged), observer);
    }
    return observer;
}

void ovStopObservingMaterial(void *pointer) {
    MaterialObserver *observer = pointer;
    if (!observer) return;
    g_signal_handlers_disconnect_by_data(observer->display, observer);
    g_signal_handlers_disconnect_by_data(observer->settings, observer);
    gtk_style_context_remove_provider_for_display(observer->display, GTK_STYLE_PROVIDER(observer->provider));
    g_object_unref(observer->provider);
    g_object_unref(observer->settings);
    g_object_unref(observer->display);
    g_free(observer);
}

// Wails GTK4 puts WebKit beside the optional menubar in the window's box.
// Never clear an unknown widget or claim desktop transparency without WebKit alpha.
static gboolean hasClearWebView(GtkWindow *window) {
    GtkWidget *box = gtk_window_get_child(window);
    if (!box) return FALSE;
    for (GtkWidget *child = gtk_widget_get_first_child(box); child; child = gtk_widget_get_next_sibling(child)) {
        if (WEBKIT_IS_WEB_VIEW(child)) {
            GdkRGBA color;
            webkit_web_view_get_background_color(WEBKIT_WEB_VIEW(child), &color);
            return color.alpha == 0;
        }
    }
    return FALSE;
}

OVMaterialResult ovApplyMaterial(void *pointer, OVMaterial requested, bool clear, bool forceOpaque) {
    GtkWidget *window = GTK_WIDGET(pointer);
    GdkDisplay *display = gtk_widget_get_display(window);
    OVMaterialResult result = { OVOpaque, OVSupported, false };
    if (forceOpaque || highContrast(gtk_settings_get_for_display(display))) {
        result.reason = OVAccessibility;
    } else if (requested != OVOpaque) {
        if (!transparentDisplay(display)) {
            result.effective = OVInPage;
            result.reason = OVNoCompositor;
        } else if (!hasClearWebView(GTK_WINDOW(window))) {
            result.effective = OVInPage;
            result.reason = OVWebViewUnavailable;
        } else {
            result.effective = OVTranslucent; // transparency, not compositor-specific blur
            result.reason = requested == OVGlass ? OVUnsupported : OVSupported;
        }
    }
    gtk_widget_add_css_class(window, "ov-material");
    if (result.effective == OVTranslucent) gtk_widget_add_css_class(window, "ov-material-clear");
    else gtk_widget_remove_css_class(window, "ov-material-clear");
    return result;
}
