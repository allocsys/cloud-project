package com.vertexhash.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The page calls hide() once its own globe is on screen (components/native-splash.js); the native start screen fades out. */
@CapacitorPlugin(name = "NativeSplash")
public class NativeSplashPlugin extends Plugin {
    @PluginMethod
    public void hide(final PluginCall call) {
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                SphereView.fadeOut();
                call.resolve();
            }
        });
    }
}
