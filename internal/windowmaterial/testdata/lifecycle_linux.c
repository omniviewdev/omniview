#include <assert.h>
#include <gtk/gtk.h>
#include <webkit/webkit.h>
#include "../desktop.h"

static int notifications;
void ovMaterialEnvironmentChanged(uintptr_t handle) { assert(handle == 1); notifications++; }

int main(void) {
    if (!gtk_init_check()) return 77;
    GtkWidget *window = gtk_window_new();
    GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    GtkWidget *web = webkit_web_view_new();
    gtk_window_set_child(GTK_WINDOW(window), box);
    gtk_box_append(GTK_BOX(box), web);
    GdkRGBA color = {0};
    webkit_web_view_set_background_color(WEBKIT_WEB_VIEW(web), &color);
    GdkDisplay *display = gtk_widget_get_display(window);
    gboolean compositor = gdk_display_is_rgba(display) && gdk_display_is_composited(display);
    gboolean decorated = gtk_window_get_decorated(GTK_WINDOW(window));
    void *observer = ovObserveMaterial(window, 1);

    OVMaterialResult solid = ovApplyMaterial(window, OVOpaque, false, false);
    assert(solid.effective == OVOpaque && !gtk_widget_has_css_class(window, "ov-material-clear"));
    OVMaterialResult glass = ovApplyMaterial(window, OVGlass, true, false);
    assert(!glass.glassAvailable);
    if (solid.reason == OVAccessibility) {
        assert(glass.effective == OVOpaque && glass.reason == OVAccessibility);
    } else if (compositor) {
        assert(glass.effective == OVTranslucent && gtk_widget_has_css_class(window, "ov-material-clear"));
        color.alpha = 1;
        webkit_web_view_set_background_color(WEBKIT_WEB_VIEW(web), &color);
        OVMaterialResult failed = ovApplyMaterial(window, OVTranslucent, false, false);
        assert(failed.effective == OVInPage && failed.reason == OVWebViewUnavailable);
    } else {
        assert(glass.effective == OVInPage && glass.reason == OVNoCompositor);
    }
    OVMaterialResult forced = ovApplyMaterial(window, OVGlass, true, true);
    assert(forced.effective == OVOpaque && forced.reason == OVAccessibility);
    assert(!gtk_widget_has_css_class(window, "ov-material-clear"));
    assert(gtk_widget_get_parent(web) == box && gtk_window_get_child(GTK_WINDOW(window)) == box);
    assert(gtk_window_get_decorated(GTK_WINDOW(window)) == decorated);
    GtkSettings *settings = gtk_settings_get_for_display(display);
    // GtkSettings overrides are process-local. Don't change the desktop's setting.
    if (solid.reason != OVAccessibility) {
        g_object_set(settings, "gtk-theme-name", "HighContrast", NULL);
        assert(notifications == 1);
        assert(ovApplyMaterial(window, OVTranslucent, false, false).reason == OVAccessibility);
    }
    ovStopObservingMaterial(observer);
    int stopped = notifications;
    g_object_set(settings, "gtk-theme-name", "Adwaita", NULL);
    assert(notifications == stopped);
    gtk_window_destroy(GTK_WINDOW(window));
    return 0;
}
