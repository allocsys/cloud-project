package com.vertexhash.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Updates the app from the site's update list (/api/app-update).
 * The page calls: info() the installed version, download() starts (or resumes) in the background,
 * status() shows the progress, install() opens the Android installer.
 * Partial downloads: a stopped download keeps its .part file and goes on from there (HTTP Range).
 * Differential update: when a patch is offered and it fits the installed app, only the patch is downloaded
 * and applied; if anything does not match, the full file is downloaded instead.
 * Android itself only accepts the new app when it is signed with the same key as the installed one.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final Object LOCK = new Object();
    private static String state = "idle"; // idle, busy, ready, error
    private static long done = 0;
    private static long total = 0;

    @PluginMethod
    public void info(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
            JSObject o = new JSObject();
            o.put("code", code);
            o.put("name", pi.versionName);
            call.resolve(o);
        } catch (Exception e) {
            call.reject("info failed");
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        Integer code = call.getInt("code");
        JSObject o = new JSObject();
        synchronized (LOCK) {
            String s = state;
            // After a restart of the app the verified file may already be there.
            if (!"busy".equals(s) && code != null && finalFile(code).exists()) s = "ready";
            o.put("state", s);
            o.put("done", done);
            o.put("total", total);
        }
        call.resolve(o);
    }

    @PluginMethod
    public void download(final PluginCall call) {
        final Integer code = call.getInt("code");
        final String apkUrl = call.getString("apkUrl");
        final Integer apkSize = call.getInt("apkSize");
        final String apkSha = call.getString("apkSha");
        if (code == null || apkUrl == null || apkSize == null || apkSha == null || !apkUrl.startsWith("https://")) {
            call.reject("bad request");
            return;
        }
        final String patchUrl = call.getString("patchUrl");
        final Integer patchSize = call.getInt("patchSize");
        final String patchSha = call.getString("patchSha");
        final String patchBase = call.getString("patchBase");
        synchronized (LOCK) {
            if ("busy".equals(state)) {
                call.resolve();
                return;
            }
            state = "busy";
            done = 0;
            total = apkSize;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                String result = "error";
                try {
                    File dir = updatesDir();
                    cleanup(dir, code);
                    File out = finalFile(code);
                    boolean ok = false;
                    if (patchUrl != null && patchSize != null && patchSha != null && patchBase != null && patchUrl.startsWith("https://")) {
                        try {
                            ok = viaPatch(dir, code, out, apkSize, apkSha, patchUrl, patchSize, patchSha, patchBase);
                        } catch (Exception e) {
                            ok = false;
                        }
                    }
                    if (!ok) {
                        synchronized (LOCK) {
                            total = apkSize;
                            done = 0;
                        }
                        fetch(apkUrl, out, apkSize, apkSha);
                    }
                    result = "ready";
                } catch (Exception e) {
                    result = "error";
                }
                synchronized (LOCK) {
                    state = result;
                }
            }
        }).start();
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        Integer code = call.getInt("code");
        if (code == null || !finalFile(code).exists()) {
            call.reject("no file");
            return;
        }
        Context ctx = getContext();
        try {
            if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(s);
                JSObject o = new JSObject();
                o.put("needsPermission", true);
                call.resolve(o);
                return;
            }
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", finalFile(code));
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("install failed");
        }
    }

    private File updatesDir() {
        File d = new File(getContext().getCacheDir(), "updates");
        d.mkdirs();
        return d;
    }

    private File finalFile(int code) {
        return new File(updatesDir(), "vertexhash-" + code + ".apk");
    }

    // Keeps only the files of this update (an older half download or a finished older one is not needed).
    private void cleanup(File dir, int code) {
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            String n = f.getName();
            if (!n.startsWith("vertexhash-" + code + ".") && !n.startsWith("patch-" + code + ".")) f.delete();
        }
    }

    private boolean viaPatch(File dir, int code, File out, int apkSize, String apkSha, String patchUrl, int patchSize, String patchSha, String patchBase) throws Exception {
        File base = new File(getContext().getApplicationInfo().sourceDir);
        if (!patchBase.equalsIgnoreCase(sha256(base))) return false; // the installed app is not the one the patch was made from
        synchronized (LOCK) {
            total = patchSize;
            done = 0;
        }
        File patch = new File(dir, "patch-" + code + ".vxp");
        fetch(patchUrl, patch, patchSize, patchSha);
        File tmp = new File(dir, "vertexhash-" + code + ".apk.new");
        VxPatch.apply(base, patch, tmp);
        if (tmp.length() != apkSize || !apkSha.equalsIgnoreCase(sha256(tmp))) {
            tmp.delete();
            return false;
        }
        if (!tmp.renameTo(out)) {
            tmp.delete();
            return false;
        }
        patch.delete();
        return true;
    }

    // Downloads url into dest (size and sha256 must match). A stopped download is kept as dest.part and resumed.
    private void fetch(String url, File dest, long size, String sha) throws IOException {
        if (dest.exists() && dest.length() == size && sha.equalsIgnoreCase(sha256(dest))) return;
        File part = new File(dest.getPath() + ".part");
        int fails = 0;
        while (true) {
            long have = part.exists() ? part.length() : 0;
            if (have > size) {
                part.delete();
                have = 0;
            }
            if (have == size) break;
            synchronized (LOCK) {
                done = have;
            }
            try {
                copy(url, part, have, size);
            } catch (IOException e) {
                fails++;
                if (fails >= 4) throw e;
                try {
                    Thread.sleep(1500L * fails);
                } catch (InterruptedException ie) {
                    throw new IOException("stopped");
                }
            }
        }
        if (!sha.equalsIgnoreCase(sha256(part))) {
            part.delete();
            throw new IOException("hash differs");
        }
        if (dest.exists()) dest.delete();
        if (!part.renameTo(dest)) throw new IOException("rename failed");
    }

    private void copy(String url, File part, long from, long size) throws IOException {
        HttpURLConnection c = open(url, from);
        try {
            int rc = c.getResponseCode();
            boolean append = rc == 206;
            if (rc == 416) {
                part.delete();
                throw new IOException("range refused");
            }
            if (rc != 200 && rc != 206) throw new IOException("http " + rc);
            long pos = append ? from : 0; // a plain 200 sends everything again: start over
            InputStream in = c.getInputStream();
            FileOutputStream out = new FileOutputStream(part, append);
            try {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    pos += n;
                    synchronized (LOCK) {
                        done = pos;
                    }
                }
            } finally {
                out.close();
                in.close();
            }
            if (pos < size) throw new IOException("cut short");
        } finally {
            c.disconnect();
        }
    }

    // Opens url with a Range header, following redirects by hand (GitHub sends the file from another host), https only.
    private HttpURLConnection open(String url, long from) throws IOException {
        for (int hop = 0; hop < 5; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setRequestProperty("User-Agent", "VertexhashApp");
            c.setRequestProperty("Accept-Encoding", "identity");
            if (from > 0) c.setRequestProperty("Range", "bytes=" + from + "-");
            int rc = c.getResponseCode();
            if (rc == 301 || rc == 302 || rc == 303 || rc == 307 || rc == 308) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IOException("bad redirect");
                url = new URL(new URL(url), loc).toString();
                if (!url.startsWith("https://")) throw new IOException("not https");
                continue;
            }
            return c;
        }
        throw new IOException("too many redirects");
    }

    private static String sha256(File f) throws IOException {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            InputStream in = new FileInputStream(f);
            try {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            } finally {
                in.close();
            }
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException("no sha256");
        }
    }
}
