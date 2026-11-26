package com.vertexhash.app;

import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(NativeSplashPlugin.class);
        super.onCreate(savedInstanceState);
        // Start screen: a turning globe over the page until the page says it is ready (never longer than 8 seconds).
        WebView web = getBridge().getWebView();
        ViewGroup root = (ViewGroup) findViewById(android.R.id.content);
        SphereView sphere = new SphereView(this, web);
        root.addView(sphere, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        sphere.postDelayed(new Runnable() {
            @Override
            public void run() {
                SphereView.fadeOut();
            }
        }, 8000);
    }
}
