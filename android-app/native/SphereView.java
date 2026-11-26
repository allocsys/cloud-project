package com.vertexhash.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.View;
import android.view.ViewGroup;

/**
 * The start screen: the same turning gold globe the site's welcome screen draws (components/Splash.js, startOrb),
 * painted natively so there is no blank page while the site loads. Same size, same place, same tilt. The turn comes
 * from the wall clock on both sides, so when the page's globe takes over it is at the same angle.
 */
public class SphereView extends View {
    private static final int N = 520;
    private static final double TAU = Math.PI * 2;
    private static SphereView current;

    private final double[] px = new double[N];
    private final double[] py = new double[N];
    private final double[] pz = new double[N];
    private final double[] ox = new double[N];
    private final double[] oy = new double[N];
    private final double[] oz = new double[N];
    private final double[] ow = new double[N];
    private final int[] order = new int[N];
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final View ref;
    private final float dp;
    private final int[] a = new int[2];
    private final int[] b = new int[2];
    private boolean gone;

    public SphereView(Context c, View ref) {
        super(c);
        this.ref = ref;
        this.dp = c.getResources().getDisplayMetrics().density;
        double ga = Math.PI * (3 - Math.sqrt(5));
        for (int i = 0; i < N; i++) {
            double y = 1 - (2 * (i + 0.5)) / N;
            double r = Math.sqrt(1 - y * y);
            px[i] = Math.cos(ga * i) * r;
            py[i] = y;
            pz[i] = Math.sin(ga * i) * r;
            order[i] = i;
        }
        current = this;
    }

    /** Fades the start screen out and removes it. Safe to call more than once. */
    public static void fadeOut() {
        SphereView v = current;
        if (v != null) v.fade();
    }

    private void fade() {
        if (gone) return;
        gone = true;
        animate().alpha(0f).setDuration(350).withEndAction(new Runnable() {
            @Override
            public void run() {
                ViewGroup p = (ViewGroup) getParent();
                if (p != null) p.removeView(SphereView.this);
                if (current == SphereView.this) current = null;
            }
        }).start();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        canvas.drawColor(0xFF0B0F1A);
        double clock = System.currentTimeMillis() / 1000.0;
        double rot = (clock * 0.7) % TAU;
        double scan = (clock * 1.1) % TAU;
        double tilt = 0.38;
        double ct = Math.cos(tilt);
        double st = Math.sin(tilt);
        double cr = Math.cos(rot);
        double sr = Math.sin(rot);
        for (int i = 0; i < N; i++) {
            double x = px[i] * cr + pz[i] * sr;
            double z = -px[i] * sr + pz[i] * cr;
            double lon = Math.atan2(pz[i], px[i]);
            double d = Math.abs(((lon + rot - scan + Math.PI * 3) % TAU) - Math.PI);
            d = Math.PI - d;
            ox[i] = x;
            oy[i] = py[i] * ct - z * st;
            oz[i] = py[i] * st + z * ct;
            ow[i] = Math.max(0, 1 - d / 0.22);
        }
        // Far dots first (insertion sort: the order barely changes from one frame to the next).
        for (int i = 1; i < N; i++) {
            int k = order[i];
            double zk = oz[k];
            int j = i - 1;
            while (j >= 0 && oz[order[j]] > zk) {
                order[j + 1] = order[j];
                j--;
            }
            order[j + 1] = k;
        }
        // Centre: the middle of the page, 12 dp up (the site puts its globe at 50% height minus 12px).
        ref.getLocationInWindow(a);
        getLocationInWindow(b);
        float cx = a[0] - b[0] + ref.getWidth() / 2f;
        float cy = a[1] - b[1] + ref.getHeight() / 2f - 12 * dp;
        float rad = 52 * dp;
        for (int n = 0; n < N; n++) {
            int i = order[n];
            double dep = (oz[i] + 1) / 2;
            double lt = Math.min(1, 0.15 + 0.55 * dep + ow[i] * 0.7);
            double al = Math.min(1, 0.12 + 0.6 * dep + ow[i] * 0.35);
            int r = (int) Math.round(199 + (255 - 199) * lt);
            int g = (int) Math.round(127 + (210 - 127) * lt);
            int bl = (int) Math.round(10 + (122 - 10) * lt);
            paint.setColor(Color.argb((int) Math.round(al * 255), r, g, bl));
            float dot = (float) ((0.7 + 1.6 * dep + ow[i] * 1.1) * 0.5) * dp;
            canvas.drawCircle(cx + (float) ox[i] * rad, cy - (float) oy[i] * rad, dot, paint);
        }
        if (!gone) postInvalidateOnAnimation();
    }
}
